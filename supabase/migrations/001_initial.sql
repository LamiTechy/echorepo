-- ============================================================
-- EchoRepo: Initial Database Migration
-- ============================================================

-- 1. Enable pgvector extension
create extension if not exists vector with schema extensions;

-- ============================================================
-- 2. TABLES
-- ============================================================

-- Repositories tracked by EchoRepo
create table if not exists public.repositories (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  github_id     bigint not null unique,          -- GitHub numeric repo ID
  full_name     text not null,                   -- "owner/repo"
  default_branch text not null default 'main',
  webhook_secret text not null,                  -- stored hashed; raw secret kept in Vault
  last_synced_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Chunked source documents (code, markdown, etc.) with embeddings
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  repo_id       uuid not null references public.repositories(id) on delete cascade,
  file_path     text not null,                   -- e.g. "src/utils/parser.ts"
  chunk_index   int not null,                    -- 0-based chunk order within file
  content       text not null,                   -- raw text of this chunk
  token_count   int,
  sha           text,                            -- git blob SHA for the source file
  embedding     vector(384),                     -- all-MiniLM-L6-v2 (Hugging Face, free)
  metadata      jsonb not null default '{}',     -- language, start_line, end_line, etc.
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique(repo_id, file_path, chunk_index)
);

-- Chat sessions scoped to a repository
create table if not exists public.chat_sessions (
  id            uuid primary key default gen_random_uuid(),
  repo_id       uuid not null references public.repositories(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Individual messages within a chat session
create table if not exists public.chat_messages (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.chat_sessions(id) on delete cascade,
  role          text not null check (role in ('user', 'assistant', 'system')),
  content       text not null,
  -- Snippet references attached to assistant turns
  source_chunks jsonb default '[]',             -- [{doc_id, file_path, chunk_index, similarity}]
  created_at    timestamptz not null default now()
);

-- ============================================================
-- 3. INDEXES
-- ============================================================

-- HNSW index for fast approximate cosine-similarity search
-- m=16, ef_construction=64 are balanced defaults for most code corpora
create index if not exists documents_embedding_hnsw
  on public.documents
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists documents_repo_id_idx on public.documents(repo_id);
create index if not exists chat_messages_session_id_idx on public.chat_messages(session_id);
create index if not exists chat_sessions_repo_id_idx on public.chat_sessions(repo_id);

-- ============================================================
-- 4. RPC: cosine similarity search
-- ============================================================

-- Returns the top-k most similar document chunks for a query embedding
-- within a specific repository. Uses the HNSW index automatically.
create or replace function public.match_documents(
  query_embedding vector(384),
  repo_id_filter  uuid,
  match_count     int default 8,
  min_similarity  float default 0.0
)
returns table (
  id          uuid,
  repo_id     uuid,
  file_path   text,
  chunk_index int,
  content     text,
  metadata    jsonb,
  similarity  float
)
language sql stable
as $$
  select
    d.id,
    d.repo_id,
    d.file_path,
    d.chunk_index,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.documents d
  where d.repo_id = repo_id_filter
    and 1 - (d.embedding <=> query_embedding) > min_similarity
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- 5. RLS POLICIES
-- ============================================================

alter table public.repositories  enable row level security;
alter table public.documents      enable row level security;
alter table public.chat_sessions  enable row level security;
alter table public.chat_messages  enable row level security;

-- Helper: check if calling user owns or has been granted access to a repo
create or replace function public.user_can_access_repo(p_repo_id uuid)
returns boolean
language sql stable security definer
as $$
  select exists (
    select 1 from public.repositories r
    where r.id = p_repo_id
      and r.owner_id = auth.uid()
  )
  -- extend here with a repo_grants table if multi-user access is needed
$$;

-- repositories
create policy "Users can view own repositories"
  on public.repositories for select
  using (owner_id = auth.uid());

create policy "Users can insert own repositories"
  on public.repositories for insert
  with check (owner_id = auth.uid());

create policy "Users can update own repositories"
  on public.repositories for update
  using (owner_id = auth.uid());

create policy "Users can delete own repositories"
  on public.repositories for delete
  using (owner_id = auth.uid());

-- documents: accessible if user can access the parent repo
create policy "Users can view documents of accessible repos"
  on public.documents for select
  using (public.user_can_access_repo(repo_id));

-- Service role (used by Edge Functions) bypasses RLS automatically.
-- Documents are inserted/updated only by Edge Functions running as service role.

-- chat_sessions
create policy "Users can manage their own chat sessions"
  on public.chat_sessions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- chat_messages: accessible if session belongs to user
create policy "Users can view messages of their sessions"
  on public.chat_messages for select
  using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

create policy "Users can insert messages into their sessions"
  on public.chat_messages for insert
  with check (
    exists (
      select 1 from public.chat_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

-- ============================================================
-- 6. UPDATED_AT TRIGGER
-- ============================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger repositories_updated_at
  before update on public.repositories
  for each row execute function public.set_updated_at();

create trigger documents_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

create trigger chat_sessions_updated_at
  before update on public.chat_sessions
  for each row execute function public.set_updated_at();
