// src/app/api/repos/trigger-sync/route.ts
// TEMPORARY public sync endpoint — delete after first sync

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");
  const repoId = searchParams.get("repoId");

  if (secret !== process.env.SYNC_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!repoId) {
    return NextResponse.json({ error: "Missing repoId" }, { status: 400 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: repo } = await sb.from("repositories").select("*").eq("id", repoId).single();
  if (!repo) return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const GITHUB_PAT = process.env.GITHUB_PAT!;
  const HF_TOKEN = process.env.HF_TOKEN!;

  const treeRes = await fetch(
    `https://api.github.com/repos/${repo.full_name}/git/trees/${repo.default_branch}?recursive=1`,
    { headers: { Authorization: `Bearer ${GITHUB_PAT}` } }
  );
  if (!treeRes.ok) return NextResponse.json({ error: "Failed to fetch tree" }, { status: 502 });

  const tree = await treeRes.json();
  const IGNORED = new Set(["node_modules", ".git", "dist", "build", ".next", "out"]);
  const IGNORED_EXT = new Set([".png",".jpg",".jpeg",".gif",".svg",".ico",".woff",".woff2",".ttf",".lock",".zip"]);

  const files: string[] = (tree.tree as { type: string; path: string }[])
    .filter((f) => {
      if (f.type !== "blob") return false;
      if (f.path.split("/").some((p) => IGNORED.has(p))) return false;
      const ext = f.path.slice(f.path.lastIndexOf(".")).toLowerCase();
      return !IGNORED_EXT.has(ext);
    })
    .map((f) => f.path)
    .slice(0, 80);

  let totalChunks = 0;

  for (let i = 0; i < files.length; i += 5) {
    const batch = files.slice(i, i + 5);
    const fetched = await Promise.allSettled(
      batch.map(async (filePath) => {
        const res = await fetch(
          `https://api.github.com/repos/${repo.full_name}/contents/${encodeURIComponent(filePath)}?ref=${repo.default_branch}`,
          { headers: { Authorization: `Bearer ${GITHUB_PAT}` } }
        );
        if (!res.ok) return null;
        const data = await res.json();
        if (data.encoding !== "base64" || data.size > 80000) return null;
        return { filePath, content: atob(data.content.replace(/\n/g, "")), sha: data.sha as string };
      })
    );

    const chunks: {
      repo_id: string; file_path: string; chunk_index: number;
      content: string; token_count: number; sha: string; metadata: object; embedding?: number[];
    }[] = [];

    for (const r of fetched) {
      if (r.status === "rejected" || !r.value) continue;
      const { filePath, content, sha } = r.value;
      const lines = content.split("\n");
      let chunkIdx = 0;
      for (let j = 0; j < lines.length; j += 30) {
        const text = lines.slice(j, j + 30).join("\n").trim();
        if (!text) continue;
        chunks.push({
          repo_id: repoId, file_path: filePath, chunk_index: chunkIdx++,
          content: text, token_count: Math.ceil(text.length / 4), sha,
          metadata: { language: "text", startLine: j + 1, endLine: j + 30, sha },
        });
      }
    }

    if (chunks.length === 0) continue;

    const embedRes = await fetch(
      "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${HF_TOKEN}` },
        body: JSON.stringify({ inputs: chunks.map((c) => c.content.slice(0, 512)), options: { wait_for_model: true } }),
      }
    );

    if (!embedRes.ok) { console.error("HF error:", await embedRes.text()); continue; }
    const embeddings = await embedRes.json() as number[][];

    const rows = chunks.map((c, idx) => ({ ...c, embedding: embeddings[idx] }));
    for (let j = 0; j < rows.length; j += 50) {
      await sb.from("documents").upsert(rows.slice(j, j + 50), { onConflict: "repo_id,file_path,chunk_index" });
    }
    totalChunks += chunks.length;
  }

  await sb.from("repositories").update({ last_synced_at: new Date().toISOString() }).eq("id", repoId);
  return NextResponse.json({ success: true, filesProcessed: files.length, chunksIndexed: totalChunks });
}