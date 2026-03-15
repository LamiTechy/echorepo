// supabase/functions/github-webhook/index.ts
// Handles GitHub `push` and `pull_request` webhook events.
// Deployed as a Supabase Edge Function (Deno runtime).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifyWebhookSignature,
  shouldIgnoreFile,
  chunkFileContent,
  embedBatch,
  fetchFileContent,
  chatComplete,
  postPRComment,
  sleep,
} from "../_shared/utils.ts";

// ============================================================
// Types
// ============================================================

interface PushEvent {
  ref: string;
  after: string;         // head commit SHA
  repository: { id: number; full_name: string; default_branch: string };
  commits: Array<{
    added: string[];
    modified: string[];
    removed: string[];
  }>;
}

interface PullRequestEvent {
  action: string;
  number: number;
  pull_request: {
    title: string;
    body: string | null;
    html_url: string;
    head: { sha: string; ref: string };
    base: { sha: string; ref: string };
    additions: number;
    deletions: number;
    changed_files: number;
  };
  repository: { id: number; full_name: string };
}

// ============================================================
// Main handler
// ============================================================

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY")!;
  const HF_API_KEY = Deno.env.get("HF_API_KEY")!;
  const GITHUB_PAT = Deno.env.get("GITHUB_PAT")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── Read raw body for HMAC verification ──
  const rawBody = await req.text();
  const githubEvent = req.headers.get("x-github-event") ?? "";
  const signatureHeader = req.headers.get("x-hub-signature-256") ?? "";

  let payload: PushEvent | PullRequestEvent;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // ── Look up the repository and verify webhook secret ──
  const githubRepoId = (payload as PushEvent).repository.id;
  const { data: repo, error: repoErr } = await supabase
    .from("repositories")
    .select("id, full_name, default_branch, webhook_secret")
    .eq("github_id", githubRepoId)
    .single();

  if (repoErr || !repo) {
    return new Response("Repository not registered", { status: 404 });
  }

  const isValid = await verifyWebhookSignature(rawBody, signatureHeader, repo.webhook_secret);
  if (!isValid) {
    return new Response("Invalid signature", { status: 401 });
  }

  // ── Route by event type ──
  try {
    if (githubEvent === "push") {
      await handlePush(payload as PushEvent, repo, supabase, HF_API_KEY, GITHUB_PAT);
    } else if (githubEvent === "pull_request") {
      await handlePullRequest(payload as PullRequestEvent, repo, supabase, GROQ_API_KEY, GITHUB_PAT);
    }
    // Other events (ping, etc.) are silently accepted
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Webhook handler error:", err);
    // Return 200 so GitHub doesn't deactivate the webhook on repeated failures.
    // Log the error for internal monitoring.
    return new Response("Internal error (logged)", { status: 200 });
  }
});

// ============================================================
// Push event handler
// ============================================================

async function handlePush(
  event: PushEvent,
  repo: { id: string; full_name: string; default_branch: string },
  supabase: ReturnType<typeof createClient>,
  openAIKey: string,
  githubToken: string
) {
  // Only sync pushes to the default branch
  const pushedBranch = event.ref.replace("refs/heads/", "");
  if (pushedBranch !== repo.default_branch) return;

  const changedFiles = new Set<string>();
  const removedFiles = new Set<string>();

  for (const commit of event.commits) {
    commit.added.forEach((f) => changedFiles.add(f));
    commit.modified.forEach((f) => changedFiles.add(f));
    commit.removed.forEach((f) => {
      removedFiles.add(f);
      changedFiles.delete(f);
    });
  }

  // ── Delete chunks for removed files ──
  if (removedFiles.size > 0) {
    const paths = Array.from(removedFiles);
    const { error } = await supabase
      .from("documents")
      .delete()
      .eq("repo_id", repo.id)
      .in("file_path", paths);
    if (error) console.error("Delete removed files error:", error);
  }

  // ── Re-embed changed files ──
  const filesToProcess = Array.from(changedFiles).filter(
    (f) => !shouldIgnoreFile(f)
  );
  if (filesToProcess.length === 0) return;

  const allChunks: Array<{
    repo_id: string;
    file_path: string;
    chunk_index: number;
    content: string;
    token_count: number;
    sha: string | undefined;
    metadata: object;
  }> = [];

  // Fetch file contents from GitHub (parallelize, max 5 at once)
  const CONCURRENCY = 5;
  for (let i = 0; i < filesToProcess.length; i += CONCURRENCY) {
    const batch = filesToProcess.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((filePath) =>
        fetchFileContent(repo.full_name, filePath, event.after, githubToken)
      )
    );

    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r.status === "rejected" || r.value === null) continue;
      const { content, sha } = r.value;
      const chunks = chunkFileContent(batch[j], content, sha);
      for (const chunk of chunks) {
        allChunks.push({
          repo_id: repo.id,
          file_path: chunk.filePath,
          chunk_index: chunk.chunkIndex,
          content: chunk.content,
          token_count: chunk.tokenCount,
          sha: chunk.metadata.sha,
          metadata: chunk.metadata,
        });
      }
    }
  }

  if (allChunks.length === 0) return;

  // ── Generate embeddings ──
  const texts = allChunks.map((c) => c.content);
  const embeddings = await embedBatch(texts, openAIKey);

  // ── Upsert into Supabase ──
  // First delete stale chunks for changed files (chunk count may differ after edits)
  const changedPaths = Array.from(changedFiles).filter((f) => !shouldIgnoreFile(f));
  if (changedPaths.length > 0) {
    await supabase
      .from("documents")
      .delete()
      .eq("repo_id", repo.id)
      .in("file_path", changedPaths);
  }

  const rows = allChunks.map((chunk, idx) => ({
    ...chunk,
    embedding: embeddings[idx],
  }));

  // Insert in batches of 100 to stay within request size limits
  const INSERT_BATCH = 100;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const { error } = await supabase
      .from("documents")
      .insert(rows.slice(i, i + INSERT_BATCH));
    if (error) console.error("Document insert error:", error);
  }

  // Update last_synced_at
  await supabase
    .from("repositories")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", repo.id);
}

// ============================================================
// Pull request event handler
// ============================================================

async function handlePullRequest(
  event: PullRequestEvent,
  repo: { id: string; full_name: string },
  _supabase: ReturnType<typeof createClient>,
  openAIKey: string,
  githubToken: string
) {
  if (event.action !== "opened") return;

  const pr = event.pull_request;

  // Fetch the diff (limited to first 100KB)
  const diffRes = await fetch(
    `https://api.github.com/repos/${repo.full_name}/pulls/${event.number}/files?per_page=50`,
    {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );

  let filesSummary = "";
  if (diffRes.ok) {
    const files = await diffRes.json();
    filesSummary = files
      .slice(0, 20)
      .map((f: { filename: string; status: string; additions: number; deletions: number; patch?: string }) =>
        `### ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})\n${
          f.patch ? f.patch.slice(0, 1500) : "(binary or large file)"
        }`
      )
      .join("\n\n");
  }

  const systemPrompt = `You are a senior software engineer reviewing a pull request. 
Write a concise, technical PR summary in GitHub-flavored Markdown. 
Focus on: what changed and why, potential issues, test coverage hints.
Keep it under 400 words. Do not praise the author excessively.`;

  const userMessage = `PR #${event.number}: "${pr.title}"

Base: \`${pr.base.ref}\` ← Head: \`${pr.head.ref}\`
Changes: +${pr.additions}/-${pr.deletions} across ${pr.changed_files} file(s)

${pr.body ? `**Author description:**\n${pr.body.slice(0, 1000)}\n\n` : ""}**Changed files:**\n${filesSummary || "(diff unavailable)"}`;

  let summary: string;
  try {
    summary = await chatComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      openAIKey,
      600
    );
  } catch (err) {
    console.error("PR summary generation failed:", err);
    return;
  }

  const comment = `<!-- echorepo-summary -->\n## 🤖 EchoRepo AI Summary\n\n${summary}\n\n---\n*Generated by [EchoRepo](https://echorepo.dev)*`;

  try {
    await postPRComment(repo.full_name, event.number, comment, githubToken);
  } catch (err) {
    console.error("Failed to post PR comment:", err);
  }
}
