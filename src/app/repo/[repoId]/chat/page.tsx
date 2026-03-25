"use client";

// src/app/repo/[repoId]/chat/page.tsx
// Terminal-style chat UI with a split-pane source viewer.
// Uses React 19 useOptimistic for instant message rendering.

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import type { ChatMessage, Repository, SourceChunk } from "@/lib/types";
import {
  getOrCreateSession,
  getRepositories,
  getSessionMessages,
  streamChat,
} from "@/lib/supabase";
import { use } from "react";

// ============================================================
// Sub-components
// ============================================================

function TerminalPrompt() {
  return (
    <span className="select-none text-[oklch(0.65_0.18_145)] font-mono">
      <span className="text-[oklch(0.55_0.12_260)]">echo</span>
      <span className="text-[oklch(0.75_0.04_260)]">@</span>
      <span className="text-[oklch(0.65_0.14_30)]">repo</span>
      <span className="text-[oklch(0.75_0.04_260)]"> › </span>
    </span>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      {isUser ? (
        <div className="flex items-center gap-2 font-mono text-sm max-w-[80%]">
          <TerminalPrompt />
          <span className="text-[oklch(0.92_0.02_260)]">{msg.content}</span>
        </div>
      ) : (
        <div className="max-w-[90%] font-mono text-sm leading-relaxed">
          {msg.isOptimistic ? (
            <span className="text-[oklch(0.55_0.08_260)] animate-pulse">
              █ thinking...
            </span>
          ) : (
            <div
              className="prose prose-invert prose-sm max-w-none prose-code:text-[oklch(0.78_0.14_145)] prose-pre:bg-[oklch(0.12_0.02_260)] prose-pre:border prose-pre:border-[oklch(0.22_0.04_260)]"
              dangerouslySetInnerHTML={{
                __html: markdownToHtml(msg.content),
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SourcePanel({
  sources,
  onSelectSource,
  activeSource,
}: {
  sources: SourceChunk[];
  onSelectSource: (s: SourceChunk) => void;
  activeSource: SourceChunk | null;
}) {
  if (sources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-[oklch(0.38_0.04_260)]">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span className="text-xs font-mono">No sources retrieved yet</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-2 border-b border-[oklch(0.18_0.03_260)] text-xs font-mono text-[oklch(0.48_0.06_260)] uppercase tracking-widest">
        Context · {sources.length} chunk{sources.length !== 1 ? "s" : ""}
      </div>
      <div className="flex-1 overflow-y-auto">
        {sources.map((s, i) => (
          <button
            key={`${s.doc_id}-${i}`}
            onClick={() => onSelectSource(s)}
            className={`w-full text-left px-4 py-3 border-b border-[oklch(0.14_0.02_260)] transition-colors hover:bg-[oklch(0.14_0.03_260)] ${
              activeSource?.doc_id === s.doc_id
                ? "bg-[oklch(0.14_0.04_260)] border-l-2 border-l-[oklch(0.65_0.18_145)]"
                : ""
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-xs text-[oklch(0.72_0.12_145)] truncate leading-relaxed">
                {s.file_path}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-[oklch(0.42_0.06_260)] bg-[oklch(0.12_0.02_260)] px-1.5 py-0.5 rounded">
                {(s.similarity * 100).toFixed(0)}%
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatInput({
  onSubmit,
  disabled,
}: {
  onSubmit: (q: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [disabled]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && value.trim() && !disabled) {
      onSubmit(value.trim());
      setValue("");
    }
  };

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-t border-[oklch(0.18_0.03_260)] bg-[oklch(0.09_0.015_260)]">
      <TerminalPrompt />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={disabled ? "waiting..." : "ask anything about this repo..."}
        className="flex-1 bg-transparent outline-none font-mono text-sm text-[oklch(0.9_0.02_260)] placeholder:text-[oklch(0.32_0.03_260)] caret-[oklch(0.65_0.18_145)] disabled:opacity-50"
        spellCheck={false}
        autoComplete="off"
      />
      {disabled && (
        <span className="text-[oklch(0.65_0.18_145)] text-xs font-mono animate-pulse">
          ●
        </span>
      )}
    </div>
  );
}

// ============================================================
// Main Page
// ============================================================

interface PageProps {
  params: Promise<{ repoId: string }>;
}

export default function ChatPage({ params }: PageProps) {
  const { repoId } = use(params);

  const [repo, setRepo] = useState<Repository | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sources, setSources] = useState<SourceChunk[]>([]);
  const [activeSource, setActiveSource] = useState<SourceChunk | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [repoNotSynced, setRepoNotSynced] = useState(false);
  const [, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);

  const [optimisticMessages, addOptimisticMessage] = useOptimistic(
    messages,
    (state: ChatMessage[], newMessage: ChatMessage) => [...state, newMessage]
  );

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [optimisticMessages, streamingContent]);

  // Load repo and session on mount
  useEffect(() => {
    async function init() {
      const repos = await getRepositories();
      const r = repos.find((r) => r.id === repoId);
      if (r) setRepo(r);

      const session = await getOrCreateSession(repoId);
      setSessionId(session.id);

      const msgs = await getSessionMessages(session.id);
      setMessages(msgs);
    }
    init();
  }, [repoId]);

  const handleSubmit = useCallback(
    async (question: string) => {
      if (!sessionId || isStreaming) return;

      const tempUserMsg: ChatMessage = {
        id: `opt-${Date.now()}`,
        session_id: sessionId,
        role: "user",
        content: question,
        source_chunks: [],
        created_at: new Date().toISOString(),
        isOptimistic: true,
      };
      const tempAssistantMsg: ChatMessage = {
        id: `opt-${Date.now() + 1}`,
        session_id: sessionId,
        role: "assistant",
        content: "",
        source_chunks: [],
        created_at: new Date().toISOString(),
        isOptimistic: true,
      };

      startTransition(() => {
        addOptimisticMessage(tempUserMsg);
        addOptimisticMessage(tempAssistantMsg);
      });

      setIsStreaming(true);
      setStreamingContent("");
      setSources([]);
      setRepoNotSynced(false);

      let accumulatedContent = "";

      await streamChat({
        repoId,
        sessionId,
        question,
        onSources: (newSources) => {
          setSources(newSources);
          if (newSources.length === 0) {
            setRepoNotSynced(true);
          }
        },
        onToken: (token) => {
          accumulatedContent += token;
          setStreamingContent(accumulatedContent);
        },
        onDone: async () => {
          setIsStreaming(false);
          setStreamingContent("");
          // Reload messages from DB to get persisted records
          const msgs = await getSessionMessages(sessionId);
          setMessages(msgs);
          // Attach latest sources to last assistant message display
          if (msgs.length > 0) {
            setSources(msgs[msgs.length - 1].source_chunks ?? []);
          }
        },
        onError: (err) => {
          console.error("Stream error:", err);
          setIsStreaming(false);
          setStreamingContent("");
        },
      });
    },
    [sessionId, isStreaming, repoId, addOptimisticMessage]
  );

  return (
    <div
      className="@container h-screen bg-[oklch(0.07_0.01_260)] text-[oklch(0.88_0.02_260)] flex flex-col overflow-hidden"
      style={{ fontFamily: "'Berkeley Mono', 'Fira Code', 'JetBrains Mono', monospace" }}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-[oklch(0.15_0.02_260)] bg-[oklch(0.085_0.012_260)] shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[oklch(0.65_0.18_25)]" />
            <div className="w-3 h-3 rounded-full bg-[oklch(0.72_0.16_85)]" />
            <div className="w-3 h-3 rounded-full bg-[oklch(0.65_0.18_145)]" />
          </div>
          <span className="text-sm font-mono text-[oklch(0.55_0.06_260)]">
            EchoRepo
            {repo && (
              <>
                <span className="text-[oklch(0.32_0.04_260)]"> / </span>
                <span className="text-[oklch(0.75_0.1_260)]">{repo.full_name}</span>
              </>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono text-[oklch(0.38_0.04_260)]">
          <span className={`w-1.5 h-1.5 rounded-full ${repo ? "bg-[oklch(0.65_0.18_145)]" : "bg-[oklch(0.5_0.1_25)]"}`} />
          {repo?.last_synced_at
            ? `synced ${new Date(repo.last_synced_at).toLocaleDateString()}`
            : "not synced"}
        </div>
      </header>

      {/* Split View */}
      <div className="flex-1 flex overflow-hidden @lg:flex-row flex-col-reverse">
        {/* Source Panel — left on large screens */}
        <aside className="@lg:w-72 @xl:w-80 w-full @lg:h-full h-48 border-r border-[oklch(0.15_0.02_260)] bg-[oklch(0.075_0.01_260)] flex flex-col overflow-hidden shrink-0">
          <SourcePanel
            sources={sources}
            onSelectSource={setActiveSource}
            activeSource={activeSource}
          />
        </aside>

        {/* Chat pane — right side */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Message list */}
          <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">
            {optimisticMessages.length === 0 && !isStreaming && (
              <WelcomeScreen repoName={repo?.full_name} />
            )}
            {repoNotSynced && (
              <NotSyncedBanner
                repoId={repoId}
                onSyncDone={() => setRepoNotSynced(false)}
              />
            )}
            {optimisticMessages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            {/* Live streaming output */}
            {isStreaming && streamingContent && (
              <div className="max-w-[90%] font-mono text-sm leading-relaxed">
                <div
                  className="prose prose-invert prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: markdownToHtml(streamingContent) }}
                />
                <span className="inline-block w-2 h-4 bg-[oklch(0.65_0.18_145)] animate-pulse ml-0.5 align-bottom" />
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <ChatInput onSubmit={handleSubmit} disabled={isStreaming} />
        </main>
      </div>
    </div>
  );
}

// ============================================================
// Not-synced banner
// ============================================================

function NotSyncedBanner({
  repoId,
  onSyncDone,
}: {
  repoId: string;
  onSyncDone: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const triggerSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/repos/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Sync failed (${res.status})`);
      }
      onSyncDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mx-auto my-8 max-w-md rounded border border-[oklch(0.55_0.16_85)] bg-[oklch(0.10_0.02_85)] p-5 font-mono text-sm">
      <div className="flex items-center gap-2 text-[oklch(0.78_0.16_85)] mb-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span className="font-semibold">Repo not indexed yet</span>
      </div>
      <p className="text-[oklch(0.58_0.08_260)] mb-4 leading-relaxed">
        No code chunks found for this repository. Trigger a sync so EchoRepo can
        embed the files and answer questions.
      </p>
      {error && (
        <p className="text-[oklch(0.65_0.18_25)] mb-3 text-xs">{error}</p>
      )}
      <button
        onClick={triggerSync}
        disabled={syncing}
        className="flex items-center gap-2 px-4 py-2 rounded bg-[oklch(0.65_0.18_145)] text-[oklch(0.08_0.01_260)] text-xs font-semibold hover:bg-[oklch(0.72_0.16_145)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {syncing ? (
          <>
            <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            Syncing…
          </>
        ) : (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 .49-3.84" />
            </svg>
            Sync now
          </>
        )}
      </button>
    </div>
  );
}

// ============================================================
// Welcome screen
// ============================================================

function WelcomeScreen({ repoName }: { repoName?: string }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-6 py-16 text-center">
      <div className="text-[oklch(0.22_0.04_260)] font-mono text-[10px] leading-relaxed select-none">
        {`
  ███████╗ ██████╗██╗  ██╗ ██████╗
  ██╔════╝██╔════╝██║  ██║██╔═══██╗
  █████╗  ██║     ███████║██║   ██║
  ██╔══╝  ██║     ██╔══██║██║   ██║
  ███████╗╚██████╗██║  ██║╚██████╔╝
  ╚══════╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝
        `.trim()}
      </div>
      {repoName && (
        <p className="font-mono text-sm text-[oklch(0.42_0.06_260)]">
          Chatting with{" "}
          <span className="text-[oklch(0.65_0.14_145)]">{repoName}</span>
        </p>
      )}
      <div className="grid grid-cols-1 gap-2 text-xs font-mono text-[oklch(0.38_0.04_260)] max-w-sm">
        {[
          "How does authentication work?",
          "Explain the database schema",
          "Where is the API rate limiting logic?",
          "What does the ChunkFile utility do?",
        ].map((suggestion) => (
          <div
            key={suggestion}
            className="px-3 py-2 border border-[oklch(0.18_0.03_260)] rounded text-left hover:border-[oklch(0.3_0.06_260)] transition-colors cursor-default"
          >
            <span className="text-[oklch(0.45_0.08_145)]">›</span>{" "}
            {suggestion}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Minimal Markdown → HTML (no external dep)
// ============================================================

function markdownToHtml(md: string): string {
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Code blocks
    .replace(
      /```(\w+)?\s*title="([^"]*)"[^\n]*\n([\s\S]*?)```/g,
      (_: string, lang: string, title: string, code: string) =>
        `<pre><div class="code-title">${title}</div><code class="language-${lang || "text"}">${code}</code></pre>`
    )
    .replace(/```(\w+)?\n?([\s\S]*?)```/g, (_: string, lang: string, code: string) =>
      `<pre><code class="language-${lang || "text"}">${code}</code></pre>`
    )
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Headings
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // List items
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    // Newlines → paragraphs
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br/>");
}