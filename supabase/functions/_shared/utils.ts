// supabase/functions/_shared/utils.ts
// Shared helpers for chunking, filtering, Groq (chat) + Hugging Face (embeddings), and GitHub API calls.
// 100% free-tier compatible:
//   - Chat:       Groq  — llama-3.3-70b-versatile (free, 14,400 req/day)
//   - Embeddings: Hugging Face Inference API — all-MiniLM-L6-v2 (free, 384 dims)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================
// Types
// ============================================================

export interface FileChunk {
  filePath: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadata: {
    language: string;
    startLine: number;
    endLine: number;
    sha?: string;
  };
}

export interface EmbeddedChunk extends FileChunk {
  embedding: number[];
}

// ============================================================
// File filtering
// ============================================================

const IGNORED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
  ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z",
  ".woff", ".woff2", ".ttf", ".eot",
  ".mp4", ".mp3", ".mov", ".avi",
  ".bin", ".exe", ".dll", ".so",
  ".lock",        // package-lock.json, yarn.lock, etc.
  ".snap",        // jest snapshots
]);

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out",
  "coverage", ".cache", "__pycache__", ".venv", "venv",
  "vendor", ".turbo", ".vercel", "public/assets",
]);

const MAX_FILE_BYTES = 200_000; // skip files > 200 KB

export function shouldIgnoreFile(filePath: string): boolean {
  const parts = filePath.split("/");
  for (const part of parts) {
    if (IGNORED_DIRS.has(part)) return true;
  }
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return IGNORED_EXTENSIONS.has(ext);
}

// ============================================================
// Language detection (simple heuristic)
// ============================================================

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript",
  ".py": "python", ".rb": "ruby", ".go": "go",
  ".rs": "rust", ".java": "java", ".kt": "kotlin",
  ".c": "c", ".cpp": "cpp", ".h": "c",
  ".cs": "csharp", ".swift": "swift",
  ".md": "markdown", ".mdx": "markdown",
  ".json": "json", ".yaml": "yaml", ".yml": "yaml",
  ".toml": "toml", ".sql": "sql", ".sh": "shell",
  ".html": "html", ".css": "css", ".scss": "scss",
};

export function detectLanguage(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return EXT_TO_LANG[ext] ?? "plaintext";
}

// ============================================================
// Code chunking
// ============================================================

// Splits file content into overlapping chunks of ~512 tokens.
// Token estimate: 1 token ≈ 4 characters (conservative for code).
const TARGET_CHUNK_CHARS = 2048;   // ~512 tokens
const OVERLAP_CHARS = 256;         // ~64 tokens of overlap

export function chunkFileContent(
  filePath: string,
  content: string,
  sha?: string
): FileChunk[] {
  if (content.length > MAX_FILE_BYTES) {
    content = content.slice(0, MAX_FILE_BYTES);
  }

  const language = detectLanguage(filePath);
  const lines = content.split("\n");
  const chunks: FileChunk[] = [];

  let currentChunkLines: string[] = [];
  let currentChunkChars = 0;
  let startLine = 1;
  let chunkIndex = 0;

  const flushChunk = (endLine: number) => {
    const chunkContent = currentChunkLines.join("\n").trim();
    if (chunkContent.length === 0) return;
    chunks.push({
      filePath,
      chunkIndex: chunkIndex++,
      content: chunkContent,
      tokenCount: Math.ceil(chunkContent.length / 4),
      metadata: { language, startLine, endLine, sha },
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentChunkLines.push(line);
    currentChunkChars += line.length + 1;

    if (currentChunkChars >= TARGET_CHUNK_CHARS) {
      flushChunk(i + 1);
      // Overlap: retain last few lines for context continuity
      const overlapLines: string[] = [];
      let overlapChars = 0;
      for (let j = currentChunkLines.length - 1; j >= 0; j--) {
        overlapChars += currentChunkLines[j].length + 1;
        if (overlapChars > OVERLAP_CHARS) break;
        overlapLines.unshift(currentChunkLines[j]);
      }
      startLine = i + 1 - overlapLines.length + 1;
      currentChunkLines = overlapLines;
      currentChunkChars = overlapLines.reduce((s, l) => s + l.length + 1, 0);
    }
  }

  // Flush remaining content
  if (currentChunkLines.length > 0) {
    flushChunk(lines.length);
  }

  return chunks;
}

// ============================================================
// Groq — Chat (free tier: 14,400 req/day, 6,000 tokens/min)
// Sign up at https://console.groq.com → API Keys
// ============================================================

const GROQ_API_BASE = "https://api.groq.com/openai/v1";
// Best free model for code understanding
const GROQ_CHAT_MODEL = "llama-3.3-70b-versatile";

async function groqRequest(
  path: string,
  body: unknown,
  apiKey: string
): Promise<Response> {
  return fetch(`${GROQ_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

// Non-streaming chat — used for PR summaries
export async function chatComplete(
  messages: { role: string; content: string }[],
  apiKey: string,
  maxTokens = 512
): Promise<string> {
  const res = await groqRequest("/chat/completions", {
    model: GROQ_CHAT_MODEL,
    messages,
    max_tokens: maxTokens,
    temperature: 0.3,
  }, apiKey);

  if (!res.ok) throw new Error(`Groq chat error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.choices[0].message.content as string;
}

// Streaming chat — used for the chat UI
export async function chatStream(
  messages: { role: string; content: string }[],
  apiKey: string
): Promise<Response> {
  return groqRequest("/chat/completions", {
    model: GROQ_CHAT_MODEL,
    messages,
    max_tokens: 1024,
    temperature: 0.3,
    stream: true,
  }, apiKey);
}

// ============================================================
// Hugging Face Inference API — Embeddings (completely free)
// Model: all-MiniLM-L6-v2 → 384-dimension embeddings
// Sign up at https://huggingface.co → Settings → Access Tokens
// ============================================================

const HF_EMBED_URL =
  "https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2";

// Embed a single text (used for query embedding at chat time)
export async function embedText(
  text: string,
  apiKey: string
): Promise<number[]> {
  const res = await fetch(HF_EMBED_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: text.slice(0, 512) }),
  });

  // HF returns 503 while the model is loading (cold start) — retry after 20s
  if (res.status === 503) {
    await sleep(20_000);
    const retry = await fetch(HF_EMBED_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: text.slice(0, 512) }),
    });
    if (!retry.ok) throw new Error(`HF embed retry failed: ${await retry.text()}`);
    return await retry.json() as number[];
  }

  if (!res.ok) throw new Error(`HF embed error ${res.status}: ${await res.text()}`);
  return await res.json() as number[];
}

// Embed multiple texts — HF free tier has no batch endpoint for this model,
// so we call sequentially with a small delay to avoid rate limits.
export async function embedBatch(
  texts: string[],
  apiKey: string
): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const embedding = await embedText(texts[i], apiKey);
    results.push(embedding);
    // Small delay to stay within HF free-tier rate limits (~300 req/min)
    if (i < texts.length - 1) await sleep(200);
  }
  return results;
}

// ============================================================
// GitHub API helpers
// ============================================================

export async function githubGet(
  path: string,
  token: string
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

// Fetch raw file content from GitHub (returns null if file is too large or binary)
export async function fetchFileContent(
  fullName: string,
  filePath: string,
  ref: string,
  token: string
): Promise<{ content: string; sha: string } | null> {
  const res = await githubGet(
    `/repos/${fullName}/contents/${encodeURIComponent(filePath)}?ref=${ref}`,
    token
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (data.size > MAX_FILE_BYTES || data.encoding !== "base64") return null;
  const content = atob(data.content.replace(/\n/g, ""));
  return { content, sha: data.sha };
}

// Post a comment on a GitHub PR
export async function postPRComment(
  fullName: string,
  prNumber: number,
  body: string,
  token: string
): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${fullName}/issues/${prNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    }
  );
  if (!res.ok) {
    throw new Error(`GitHub comment error ${res.status}: ${await res.text()}`);
  }
}

// ============================================================
// Supabase Vault: retrieve GitHub PAT for a repository
// ============================================================

export async function getGitHubToken(
  supabaseServiceKey: string,
  supabaseUrl: string,
  repoId: string
): Promise<string> {
  // Tokens are stored in Vault as: "github_pat_<repoId>"
  // Using service-role client to bypass RLS
  const client = createClient(supabaseUrl, supabaseServiceKey);
  const { data, error } = await client.rpc("vault.decrypted_secrets", {
    // This is a helper view approach; adapt to your Vault setup
  });
  // Simpler: store as env var per-function or use Vault via raw SQL
  // For MVP, we read from an environment variable set during function deploy
  throw new Error("getGitHubToken: use GITHUB_PAT env var for MVP");
}

// ============================================================
// Misc
// ============================================================

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Verify GitHub webhook HMAC-SHA256 signature
export async function verifyWebhookSignature(
  payload: string,
  signature: string, // "sha256=..."
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expected = `sha256=${hex}`;
  // Constant-time comparison
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
