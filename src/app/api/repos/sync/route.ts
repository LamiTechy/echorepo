// src/app/api/repos/sync/route.ts
// Triggers an initial full sync of a repo immediately after connection.
// Fetches the full file tree from GitHub and indexes everything.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const IGNORED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
  ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z",
  ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mp3",
  ".bin", ".exe", ".dll", ".so", ".lock", ".snap",
]);

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out",
  "coverage", ".cache", "__pycache__", ".venv", "venv", "vendor",
]);

const MAX_FILE_BYTES = 200_000;
const TARGET_CHUNK_CHARS = 2048;
const OVERLAP_CHARS = 256;

function shouldIgnore(filePath: string): boolean {
  const parts = filePath.split("/");
  if (parts.some((p) => IGNORED_DIRS.has(p))) return true;
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return IGNORED_EXTENSIONS.has(ext);
}

function chunkContent(filePath: string, content: string, sha: string) {
  if (content.length > MAX_FILE_BYTES) content = content.slice(0, MAX_FILE_BYTES);
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const langMap: Record<string, string> = {
    ".ts": "typescript", ".tsx": "typescript", ".js": "javascript",
    ".jsx": "javascript", ".py": "python", ".go": "go", ".rs": "rust",
    ".java": "java", ".md": "markdown", ".json": "json", ".sql": "sql",
    ".html": "html", ".css": "css",
  };
  const language = langMap[ext] ?? "plaintext";
  const lines = content.split("\n");
  const chunks = [];
  let current: string[] = [], chars = 0, startLine = 1, idx = 0;

  const flush = (endLine: number) => {
    const text = current.join("\n").trim();
    if (!text) return;
    chunks.push({
      chunkIndex: idx++, content: text,
      tokenCount: Math.ceil(text.length / 4),
      metadata: { language, startLine, endLine, sha },
    });
  };

  for (let i = 0; i < lines.length; i++) {
    current.push(lines[i]);
    chars += lines[i].length + 1;
    if (chars >= TARGET_CHUNK_CHARS) {
      flush(i + 1);
      const overlap: string[] = [];
      let oc = 0;
      for (let j = current.length - 1; j >= 0; j--) {
        oc += current[j].length + 1;
        if (oc > OVERLAP_CHARS) break;
        overlap.unshift(current[j]);
      }
      startLine = i + 1 - overlap.length + 1;
      current = overlap;
      chars = overlap.reduce((s, l) => s + l.length + 1, 0);
    }
  }
  if (current.length) flush(lines.length);
  return chunks;
}

async function embedBatch(texts: string[], hfToken: string): Promise<number[][]> {
  const BATCH = 32;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH).map((t) => t.slice(0, 512));
    let res = await fetch(
      "https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${hfToken}` },
        body: JSON.stringify({ inputs: slice, options: { wait_for_model: true } }),
      }
    );
    if (res.status === 503) {
      await new Promise((r) => setTimeout(r, 20_000));
      res = await fetch(
        "https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${hfToken}` },
          body: JSON.stringify({ inputs: slice, options: { wait_for_model: true } }),
        }
      );
    }
    if (!res.ok) throw new Error(`HF embed error: ${await res.text()}`);
    results.push(...(await res.json() as number[][]));
  }
  return results;
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { repoId } = await req.json();
  const GITHUB_PAT = process.env.GITHUB_PAT!;
  const HF_TOKEN = process.env.HF_TOKEN!;

  const serviceSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [] } }
  );

  // Verify ownership
  const { data: repo } = await serviceSupabase
    .from("repositories")
    .select("*")
    .eq("id", repoId)
    .eq("owner_id", user.id)
    .single();

  if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });

  // Fetch full file tree from GitHub
  const treeRes = await fetch(
    `https://api.github.com/repos/${repo.full_name}/git/trees/${repo.default_branch}?recursive=1`,
    { headers: { Authorization: `Bearer ${GITHUB_PAT}`, Accept: "application/vnd.github.v3+json" } }
  );

  if (!treeRes.ok) {
    return NextResponse.json({ error: "Failed to fetch repository tree" }, { status: 502 });
  }

  const tree = await treeRes.json();

  if (tree.truncated) {
    // Very large repos — still process what we have
    console.warn(`Tree truncated for ${repo.full_name}`);
  }

  const files: string[] = tree.tree
    .filter((f: { type: string; path: string }) => f.type === "blob" && !shouldIgnore(f.path))
    .map((f: { path: string }) => f.path);

  // Process in batches of 10 files concurrently
  const CONCURRENCY = 10;
  let totalChunks = 0;

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);

    const fileResults = await Promise.allSettled(
      batch.map(async (filePath) => {
        const res = await fetch(
          `https://api.github.com/repos/${repo.full_name}/contents/${encodeURIComponent(filePath)}?ref=${repo.default_branch}`,
          { headers: { Authorization: `Bearer ${GITHUB_PAT}`, Accept: "application/vnd.github.v3+json" } }
        );
        if (!res.ok) return null;
        const data = await res.json();
        if (data.size > MAX_FILE_BYTES || data.encoding !== "base64") return null;
        const content = atob(data.content.replace(/\n/g, ""));
        return { filePath, content, sha: data.sha };
      })
    );

    const allChunks: Array<{
      repo_id: string; file_path: string; chunk_index: number;
      content: string; token_count: number; sha: string; metadata: object;
    }> = [];

    for (const result of fileResults) {
      if (result.status === "rejected" || !result.value) continue;
      const { filePath, content, sha } = result.value;
      for (const chunk of chunkContent(filePath, content, sha)) {
        allChunks.push({
          repo_id: repoId,
          file_path: filePath,
          chunk_index: chunk.chunkIndex,
          content: chunk.content,
          token_count: chunk.tokenCount,
          sha,
          metadata: chunk.metadata,
        });
      }
    }

    if (allChunks.length === 0) continue;

    // Generate embeddings
    const embeddings = await embedBatch(allChunks.map((c) => c.content), HF_TOKEN);
    const rows = allChunks.map((c, idx) => ({ ...c, embedding: embeddings[idx] }));

    // Insert in batches of 100
    for (let j = 0; j < rows.length; j += 100) {
      await serviceSupabase.from("documents").insert(rows.slice(j, j + 100));
    }

    totalChunks += allChunks.length;
  }

  // Mark as synced
  await serviceSupabase
    .from("repositories")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", repoId);

  return NextResponse.json({ success: true, filesProcessed: files.length, chunksIndexed: totalChunks });
}
