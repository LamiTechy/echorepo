// src/lib/supabase.ts
import { createBrowserClient } from "@supabase/ssr";
import type { ChatMessage, ChatSession, Repository, SourceChunk } from "./types";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// ============================================================
// Typed API helpers
// ============================================================

export async function getRepositories(): Promise<Repository[]> {
  const sb = createClient();
  const { data, error } = await sb
    .from("repositories")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Repository[];
}

export async function getOrCreateSession(
  repoId: string,
  title?: string
): Promise<ChatSession> {
  const sb = createClient();
  const { data: user } = await sb.auth.getUser();
  if (!user.user) throw new Error("Not authenticated");

  // Reuse the most recent session for this repo
  const { data: existing } = await sb
    .from("chat_sessions")
    .select("*")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing as ChatSession;

  const { data, error } = await sb
    .from("chat_sessions")
    .insert({ repo_id: repoId, user_id: user.user.id, title: title ?? null })
    .select()
    .single();
  if (error) throw error;
  return data as ChatSession;
}

export async function getSessionMessages(
  sessionId: string
): Promise<ChatMessage[]> {
  const sb = createClient();
  const { data, error } = await sb
    .from("chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ChatMessage[];
}

// ============================================================
// Stream chat response from Edge Function
// ============================================================

export interface StreamChatOptions {
  repoId: string;
  sessionId: string;
  question: string;
  onSources: (sources: SourceChunk[]) => void;
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

export async function streamChat(opts: StreamChatOptions): Promise<void> {
  const sb = createClient();
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/chat-query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        repoId: opts.repoId,
        sessionId: opts.sessionId,
        question: opts.question,
      }),
    }
  );

  if (!res.ok) {
    opts.onError(new Error(`Chat query failed: ${res.status}`));
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") {
        opts.onDone();
        return;
      }
      try {
        const json = JSON.parse(data);
        if (json.type === "sources") {
          opts.onSources(json.sources as SourceChunk[]);
        } else {
          const token = json.choices?.[0]?.delta?.content;
          if (token) opts.onToken(token);
        }
      } catch { /* non-JSON line */ }
    }
  }

  opts.onDone();
}