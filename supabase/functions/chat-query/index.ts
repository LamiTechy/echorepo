// supabase/functions/chat-query/index.ts
// Accepts a user question, retrieves relevant code chunks via RAG,
// and streams a grounded GPT-4o response back to the client.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { embedText, chatStream } from "../_shared/utils.ts";

// ============================================================
// Types
// ============================================================

interface ChatQueryRequest {
  repoId: string;
  sessionId: string;
  question: string;
}

interface MatchedDocument {
  id: string;
  repo_id: string;
  file_path: string;
  chunk_index: number;
  content: string;
  metadata: {
    language: string;
    startLine: number;
    endLine: number;
  };
  similarity: number;
}

// ============================================================
// Main handler
// ============================================================

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Methods": "POST",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY")!;
  const HF_API_KEY = Deno.env.get("HF_API_KEY")!;

  // ── Authenticate the calling user via their JWT ──
  const authHeader = req.headers.get("authorization") ?? "";
  const userToken = authHeader.replace("Bearer ", "");

  // Service client for DB writes (bypasses RLS)
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  // User client to verify identity and enforce RLS on reads
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  });

  let body: ChatQueryRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { repoId, sessionId, question } = body;
  if (!repoId || !sessionId || !question?.trim()) {
    return new Response("Missing required fields", { status: 400 });
  }

  // ── Verify the user owns the chat session ──
  const { data: session, error: sessionErr } = await userClient
    .from("chat_sessions")
    .select("id, repo_id")
    .eq("id", sessionId)
    .eq("repo_id", repoId)
    .single();

  if (sessionErr || !session) {
    return new Response("Session not found or access denied", { status: 403 });
  }

  // ── Embed the user question ──
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedText(question, HF_API_KEY);
  } catch (err) {
    console.error("Embedding error:", err);
    return new Response("Embedding failed", { status: 502 });
  }

  // ── Similarity search via RPC ──
  const { data: matches, error: matchErr } = await serviceClient.rpc(
    "match_documents",
    {
      query_embedding: queryEmbedding,
      repo_id_filter: repoId,
      match_count: 8,
      min_similarity: 0.15,
    }
  );

  if (matchErr) {
    console.error("Match error:", matchErr);
    return new Response("Search failed", { status: 502 });
  }

  const chunks: MatchedDocument[] = matches ?? [];

  // ── Build grounded prompt ──
  const contextBlock = chunks
    .map(
      (c) =>
        `\`\`\`${c.metadata.language} title="${c.file_path}" lines="${c.metadata.startLine}-${c.metadata.endLine}"\n${c.content}\n\`\`\``
    )
    .join("\n\n");

  const systemPrompt = `You are EchoRepo, an expert AI assistant that helps developers understand a codebase.
Answer questions using ONLY the provided code context. 
If the answer isn't in the context, say so clearly — do not hallucinate.
When referencing code, cite the file path and line numbers.
Format your response in Markdown.`;

  const userMessage = chunks.length > 0
    ? `Here is relevant code context:\n\n${contextBlock}\n\n---\n\nQuestion: ${question}`
    : `No relevant code was found for this query.\n\nQuestion: ${question}`;

  // ── Persist user message ──
  const { data: userMsg } = await serviceClient
    .from("chat_messages")
    .insert({
      session_id: sessionId,
      role: "user",
      content: question,
    })
    .select("id")
    .single();

  // ── Stream GPT-4o response ──
  let openAIRes: Response;
  try {
    openAIRes = await chatStream(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      GROQ_API_KEY
    );
  } catch (err) {
    console.error("OpenAI stream error:", err);
    return new Response("AI service unavailable", { status: 502 });
  }

  if (!openAIRes.ok) {
    return new Response("OpenAI error", { status: 502 });
  }

  // ── Transform stream: collect full response, then persist, while forwarding SSE ──
  // We use a TransformStream to intercept chunks and accumulate the full reply.
  let fullAssistantContent = "";

  const sourceInfo = chunks.map((c) => ({
    doc_id: c.id,
    file_path: c.file_path,
    chunk_index: c.chunk_index,
    similarity: Math.round(c.similarity * 100) / 100,
  }));

  // Send source_chunks as a special first SSE event before the content stream
  const sourcesEvent = `data: ${JSON.stringify({ type: "sources", sources: sourceInfo })}\n\n`;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Write sources event first
  writer.write(encoder.encode(sourcesEvent));

  // Pipe OpenAI stream while accumulating content
  (async () => {
    const reader = openAIRes.body!.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        // Accumulate content from SSE deltas
        for (const line of text.split("\n")) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const json = JSON.parse(line.slice(6));
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) fullAssistantContent += delta;
            } catch { /* non-JSON line */ }
          }
        }
        await writer.write(value);
      }
    } finally {
      await writer.close();
      // Persist assistant message after stream completes
      if (fullAssistantContent) {
        await serviceClient.from("chat_messages").insert({
          session_id: sessionId,
          role: "assistant",
          content: fullAssistantContent,
          source_chunks: sourceInfo,
        });
      }
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
