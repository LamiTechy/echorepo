# EchoRepo — Full Deployment Guide

## Project Structure

```
echorepo/
├── supabase/
│   ├── migrations/
│   │   └── 001_initial.sql          # DB schema, pgvector, RLS, HNSW index
│   └── functions/
│       ├── _shared/
│       │   └── utils.ts             # Chunking, OpenAI, GitHub helpers
│       ├── github-webhook/
│       │   └── index.ts             # Push + PR webhook handler
│       └── chat-query/
│           └── index.ts             # RAG chat with streaming
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── globals.css              # Tailwind v4 + OKLCH tokens
    │   ├── page.tsx                 # Repository dashboard
    │   └── repo/[repoId]/chat/
    │       └── page.tsx             # Terminal chat UI
    └── lib/
        ├── types.ts
        └── supabase.ts              # Client + typed API helpers
```

---

## Step 1 — Supabase Setup

### 1a. Create project
1. Go to https://supabase.com/dashboard → New project
2. Note your **Project URL** and **API keys** (anon + service role)

### 1b. Enable pgvector
The migration SQL handles this, but ensure the `vector` extension is available
in your Supabase plan (available on all paid plans and Pro free tier).

### 1c. Run migration
```bash
# Using Supabase CLI
supabase db push
# Or paste supabase/migrations/001_initial.sql into the SQL editor
```

---

## Step 2 — Deploy Edge Functions

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to your project
supabase link --project-ref <your-project-ref>

# Set secrets (these become Deno.env vars inside functions)
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set GITHUB_PAT=ghp_...
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically

# Deploy both functions
supabase functions deploy github-webhook --no-verify-jwt
supabase functions deploy chat-query
```

> **Note**: `--no-verify-jwt` is required for `github-webhook` because GitHub
> calls it without a Supabase JWT. Signature verification is done manually
> via HMAC-SHA256.

After deployment, your webhook URL will be:
```
https://<project-ref>.supabase.co/functions/v1/github-webhook
```

---

## Step 3 — Register a Repository

You need to insert a row into `repositories` and configure GitHub.

### 3a. Generate a webhook secret
```bash
openssl rand -hex 32
# → e.g. a3f7c2d1e8b9...
```

### 3b. Insert repository record (Supabase SQL editor)
```sql
insert into public.repositories
  (owner_id, github_id, full_name, default_branch, webhook_secret)
values
  (
    auth.uid(),          -- run as the authenticated user, or paste UUID
    123456789,           -- GitHub numeric repo ID (from GitHub API)
    'yourorg/yourrepo',
    'main',
    'a3f7c2d1e8b9...'   -- the secret generated above
  );
```

To find the GitHub numeric ID:
```bash
curl https://api.github.com/repos/yourorg/yourrepo | jq .id
```

### 3c. Configure GitHub Webhook
1. Go to your GitHub repo → **Settings → Webhooks → Add webhook**
2. **Payload URL**: `https://<project-ref>.supabase.co/functions/v1/github-webhook`
3. **Content type**: `application/json`
4. **Secret**: the same value from step 3a
5. **Events**: Select `Push` and `Pull requests`
6. Click **Add webhook**

GitHub will send a `ping` event immediately — check the webhook delivery log
to confirm it returns `200 OK`.

---

## Step 4 — Initial Repository Sync

The webhook only processes *incremental* changes. For the initial full sync,
run this one-off script locally or as a Supabase Edge Function:

```typescript
// scripts/full-sync.ts (run with: deno run --allow-net --allow-env full-sync.ts)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chunkFileContent, embedBatch, fetchFileContent, shouldIgnoreFile } from "./supabase/functions/_shared/utils.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_PAT   = Deno.env.get("GITHUB_PAT")!;
const OPENAI_KEY   = Deno.env.get("OPENAI_API_KEY")!;
const REPO_ID      = Deno.env.get("REPO_ID")!;   // UUID from repositories table

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const { data: repo } = await sb.from("repositories").select("*").eq("id", REPO_ID).single();

// Fetch file tree from GitHub
const treeRes = await fetch(
  `https://api.github.com/repos/${repo.full_name}/git/trees/${repo.default_branch}?recursive=1`,
  { headers: { Authorization: `Bearer ${GITHUB_PAT}` } }
);
const tree = await treeRes.json();
const files = tree.tree
  .filter((f: { type: string; path: string }) => f.type === "blob" && !shouldIgnoreFile(f.path))
  .map((f: { path: string }) => f.path);

console.log(`Syncing ${files.length} files...`);

// Process in batches
const BATCH = 10;
for (let i = 0; i < files.length; i += BATCH) {
  const batch = files.slice(i, i + BATCH);
  const chunks = (
    await Promise.all(
      batch.map(async (path: string) => {
        const file = await fetchFileContent(repo.full_name, path, repo.default_branch, GITHUB_PAT);
        if (!file) return [];
        return chunkFileContent(path, file.content, file.sha);
      })
    )
  ).flat();

  if (chunks.length === 0) continue;

  const embeddings = await embedBatch(chunks.map((c) => c.content), OPENAI_KEY);
  const rows = chunks.map((c, idx) => ({
    repo_id: REPO_ID,
    file_path: c.filePath,
    chunk_index: c.chunkIndex,
    content: c.content,
    token_count: c.tokenCount,
    sha: c.metadata.sha,
    metadata: c.metadata,
    embedding: embeddings[idx],
  }));

  await sb.from("documents").upsert(rows, { onConflict: "repo_id,file_path,chunk_index" });
  console.log(`  Processed ${i + batch.length}/${files.length} files`);
}

await sb.from("repositories").update({ last_synced_at: new Date().toISOString() }).eq("id", REPO_ID);
console.log("Sync complete!");
```

---

## Step 5 — Frontend Deployment (Vercel)

```bash
# Install deps
npm install

# Set env vars in Vercel dashboard or .env.local:
# NEXT_PUBLIC_SUPABASE_URL
# NEXT_PUBLIC_SUPABASE_ANON_KEY

# Deploy
vercel deploy
```

---

## Auth Flow: Frontend → DB → Edge Functions

```
Browser
  │  login with Supabase Auth (email/magic link/OAuth)
  │  receives JWT (access_token)
  │
  ▼
Next.js App (client)
  │  includes JWT in Authorization header
  │  for all Supabase and Edge Function requests
  │
  ├──► Supabase DB (via supabase-js)
  │      RLS policies evaluate auth.uid() from JWT
  │      Users can only read their own repos/sessions/messages
  │
  └──► chat-query Edge Function
         verifies JWT via SUPABASE_ANON_KEY (automatic with supabase-js)
         uses service role for DB writes (bypass RLS for INSERT)
         never exposes service key or GITHUB_PAT to client

GitHub
  │  sends HMAC-SHA256 signed webhook
  │
  └──► github-webhook Edge Function
         --no-verify-jwt (no user JWT)
         verifies webhook signature using per-repo secret
         uses service role key for all DB operations
```

---

## Assumptions & Tradeoffs

| Decision | Rationale |
|---|---|
| HNSW over IVFFlat | HNSW has better recall at similar query latency for < 10M vectors. IVFFlat needs periodic `VACUUM ANALYZE` after bulk inserts. |
| `text-embedding-3-small` | 8× cheaper than `text-embedding-3-large`, 1536 dims still excellent for code. |
| Chunk size ~512 tokens with overlap | Balances context completeness vs. retrieval precision. Files > 200KB are truncated. |
| GPT-4o for chat + summaries | Best code reasoning. Can swap to `gpt-4o-mini` for 15× cost reduction if needed. |
| Streaming via TransformStream | Minimal TTFB; assistant message is persisted only after the stream ends. |
| `--no-verify-jwt` on webhook | GitHub has no Supabase account; HMAC signature is the auth layer instead. |
| Per-repo webhook secrets | Revocation granularity — compromising one secret doesn't affect other repos. |
| Service role for Edge Function writes | RLS would require a user JWT for inserts, which webhooks don't have. Service role is scoped to server-side functions only, never the client. |
| Minimal markdown renderer | Avoids `react-markdown` + `rehype` bundle (~80KB gzipped). Swap if full GFM is needed. |
| Full resync on push to default branch only | Avoids noisy churn from feature branches. PRs are summarized but not indexed. |
