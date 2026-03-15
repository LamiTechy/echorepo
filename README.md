# EchoRepo 🔍

> Chat with any GitHub repository using AI-powered semantic search.

EchoRepo lets you ask natural language questions about a codebase and get grounded answers backed by real source code. It indexes your repository into a vector database and uses RAG (Retrieval-Augmented Generation) to answer questions with direct references to the relevant files and line numbers.

![EchoRepo terminal UI](https://placehold.co/1200x600/0a0b14/65d47a?text=EchoRepo+—+Chat+with+your+codebase&font=monospace)

---

## Features

- 🔎 **Semantic code search** — find relevant code by meaning, not just keywords
- 💬 **AI chat interface** — terminal-style UI with streaming responses
- 📂 **Source viewer** — see exactly which files and lines the AI is referencing
- 🔄 **Real-time sync** — GitHub webhook re-indexes only changed files on every push
- 🤖 **AI PR summaries** — automatically posts a technical summary comment when a PR is opened
- 🔐 **Secure by default** — RLS policies, webhook signature verification, secrets never exposed to client

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, Tailwind CSS v4 |
| Database | Supabase (PostgreSQL + pgvector) |
| Edge Functions | Supabase Edge Functions (Deno runtime) |
| Embeddings | `text-embedding-3-small` — 1536 dimensions |
| Chat | GPT-4o (or Groq `llama-3.3-70b` as a free alternative) |
| Webhooks | GitHub Webhooks |

---

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
    │   ├── globals.css              # Tailwind v4 + OKLCH design tokens
    │   ├── page.tsx                 # Repository dashboard
    │   └── repo/[repoId]/chat/
    │       └── page.tsx             # Terminal chat UI
    └── lib/
        ├── types.ts                 # Shared TypeScript interfaces
        └── supabase.ts              # Client + typed API helpers
```

---

## Prerequisites

- Node.js 18+
- [Supabase account](https://supabase.com) (free tier works)
- [OpenAI API key](https://platform.openai.com) — or use [Groq](https://console.groq.com) for free
- [GitHub Personal Access Token](https://github.com/settings/tokens) with `repo` scope

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/yourname/echorepo.git
cd echorepo
npm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → paste and run `supabase/migrations/001_initial.sql`
3. Go to **Settings → API** and copy your Project URL and keys

### 3. Configure environment

```bash
cp .env.example .env.local
```

Fill in `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

### 4. Deploy Edge Functions

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>

# Set secrets (server-side only, never exposed to client)
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set GITHUB_PAT=ghp_...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=sb_secret_...

# Deploy
supabase functions deploy github-webhook --no-verify-jwt
supabase functions deploy chat-query
```

### 5. Register a repository

Generate a webhook secret:
```bash
openssl rand -hex 32
```

Insert your repo into the database (Supabase SQL Editor):
```sql
insert into public.repositories
  (owner_id, github_id, full_name, default_branch, webhook_secret)
values (
  '<your-user-uuid>',   -- Auth → Users → your UUID
  123456789,             -- GitHub numeric repo ID
  'yourname/yourrepo',
  'main',
  'your-generated-secret'
);
```

Find your GitHub repo's numeric ID:
```bash
curl https://api.github.com/repos/yourname/yourrepo | grep '"id"'
```

### 6. Add GitHub Webhook

1. Go to your GitHub repo → **Settings → Webhooks → Add webhook**
2. Set **Payload URL** to:
   ```
   https://<project-ref>.supabase.co/functions/v1/github-webhook
   ```
3. Set **Content type** to `application/json`
4. Set **Secret** to the value from step 5
5. Select events: **Pushes** and **Pull requests**
6. Click **Add webhook** — you should see a green `200` in Recent Deliveries

### 7. Run initial sync

Index all existing files in your repository:
```bash
SUPABASE_URL=https://xxxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=sb_secret_... \
GITHUB_PAT=ghp_... \
OPENAI_API_KEY=sk-... \
REPO_ID=<uuid-from-repositories-table> \
deno run --allow-net --allow-env scripts/full-sync.ts
```

### 8. Start the app

```bash
npm run dev
# Open http://localhost:3000
```

---

## Free Alternative: Groq Instead of OpenAI

Don't want to pay for OpenAI? Use [Groq](https://console.groq.com) — it's free and fast.

In `supabase/functions/_shared/utils.ts`, change:

```typescript
// From
const OPENAI_API_BASE = "https://api.openai.com/v1";
// model: "gpt-4o"

// To
const OPENAI_API_BASE = "https://api.groq.com/openai/v1";
// model: "llama-3.3-70b-versatile"
```

Then update your secret:
```bash
supabase secrets set OPENAI_API_KEY=gsk_...   # your Groq API key
```

---

## How It Works

```
You ask a question
        │
        ▼
  Embed question          ← text-embedding-3-small
        │
        ▼
  Vector similarity       ← pgvector HNSW index (cosine distance)
  search in Supabase
        │
        ▼
  Top 8 code chunks
  retrieved with file
  paths + line numbers
        │
        ▼
  Grounded prompt         ← chunks injected as context
  sent to GPT-4o
        │
        ▼
  Streamed response       ← SSE stream to browser
  with source citations
```

### Webhook sync flow

```
Git push to main branch
        │
        ▼
  GitHub sends webhook    ← HMAC-SHA256 verified
        │
        ▼
  Fetch changed files
  from GitHub API
        │
        ▼
  Chunk → Embed           ← text-embedding-3-small
        │
        ▼
  Delete stale chunks
  Upsert new chunks       ← Supabase pgvector
```

---

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` | Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secrets | Service role key (server only) |
| `OPENAI_API_KEY` | Supabase secrets | OpenAI or Groq API key |
| `GITHUB_PAT` | Supabase secrets | GitHub Personal Access Token |

---

## Deployment (Vercel)

```bash
vercel deploy
```

Set these environment variables in your Vercel dashboard:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

The Edge Functions run on Supabase infrastructure — Vercel only hosts the Next.js frontend.

---

## Security

- **Webhook signatures** — every GitHub webhook is verified with HMAC-SHA256 before processing
- **Row Level Security** — users can only access repositories they own
- **Secrets never reach the client** — `service_role` key and API keys live only in Supabase Edge Function environment
- **JWT auth** — `chat-query` function verifies the user's Supabase JWT on every request

---

## Limitations & Known Tradeoffs

- Files larger than 200KB are truncated before chunking
- Binary files, lockfiles, and `node_modules` are automatically skipped
- Only pushes to the **default branch** trigger re-indexing
- PR summaries are generated but PR files are not indexed into the vector store
- Free Supabase projects **pause after 7 days of inactivity** — webhooks stop working until the project wakes up

---

## Contributing

Pull requests are welcome. For major changes, open an issue first.

---

## License

MIT
