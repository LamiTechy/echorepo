// src/lib/types.ts

export interface Repository {
  id: string;
  github_id: number;
  full_name: string;
  default_branch: string;
  last_synced_at: string | null;
  created_at: string;
}

export interface ChatSession {
  id: string;
  repo_id: string;
  user_id: string;
  title: string | null;
  created_at: string;
}

export interface SourceChunk {
  doc_id: string;
  file_path: string;
  chunk_index: number;
  similarity: number;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  source_chunks: SourceChunk[];
  created_at: string;
  // UI-only: optimistic messages don't have a DB id yet
  isOptimistic?: boolean;
}
