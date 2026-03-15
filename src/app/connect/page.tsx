"use client";
// src/app/connect/page.tsx

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Step = { status: "idle" } | { status: "loading"; message: string } | { status: "success"; repo: ConnectedRepo } | { status: "error"; message: string };
interface ConnectedRepo { id: string; fullName: string; defaultBranch: string; private: boolean; description: string | null; webhookId: number; }

const STEPS = ["Fetching repository from GitHub...", "Generating webhook secret...", "Saving to database...", "Registering webhook on GitHub..."];

export default function ConnectPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [step, setStep] = useState<Step>({ status: "idle" });

  const handleConnect = async () => {
    if (!input.trim() || step.status === "loading") return;
    let msgIndex = 0;
    setStep({ status: "loading", message: STEPS[0] });
    const interval = setInterval(() => {
      msgIndex = Math.min(msgIndex + 1, STEPS.length - 1);
      setStep({ status: "loading", message: STEPS[msgIndex] });
    }, 1200);
    try {
      const res = await fetch("/api/repos/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repoUrl: input.trim() }) });
      clearInterval(interval);
      const data = await res.json();
      if (!res.ok) { setStep({ status: "error", message: data.error ?? "Something went wrong" }); return; }
      setStep({ status: "success", repo: data.repo });
    } catch {
      clearInterval(interval);
      setStep({ status: "error", message: "Network error — please try again" });
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--c0)", fontFamily: "var(--font)", display: "flex", flexDirection: "column" }}>
      {/* Nav */}
      <header style={{ borderBottom: "1px solid var(--cb)", background: "var(--c1)" }}>
        <div style={{ maxWidth: "640px", margin: "0 auto", padding: "12px 24px", display: "flex", alignItems: "center", gap: "10px" }}>
          <Link href="/" style={{ fontSize: "11px", color: "var(--cm)", textDecoration: "none" }}>← Dashboard</Link>
          <span style={{ color: "var(--cb)" }}>·</span>
          <span style={{ fontSize: "11px", color: "var(--cm)" }}>Connect Repository</span>
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px" }}>
        <div style={{ width: "100%", maxWidth: "520px", display: "flex", flexDirection: "column", gap: "24px" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 700, color: "var(--ct)", marginBottom: "6px" }}>Connect a Repository</h1>
            <p style={{ fontSize: "13px", color: "var(--cm)", lineHeight: 1.6 }}>
              Paste a GitHub URL or <code style={{ color: "var(--cg)", background: "var(--c2)", padding: "2px 6px", borderRadius: "6px", fontSize: "12px" }}>owner/repo</code> — everything is set up automatically.
            </p>
          </div>

          <div className="er-card" style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.4)" }}>
            {step.status !== "success" && (
              <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Input row */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--c0)", border: "1px solid var(--cb)", borderRadius: "12px", padding: "10px 14px", transition: "border-color 0.15s" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--cb2)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--cb)")}>
                  <span style={{ color: "var(--cm)", fontSize: "14px", flexShrink: 0 }}>$</span>
                  <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                    disabled={step.status === "loading"}
                    placeholder="github.com/owner/repo  or  owner/repo"
                    autoFocus spellCheck={false} autoComplete="off"
                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: "13px", color: "var(--ct)", fontFamily: "var(--font)", caretColor: "var(--cg)" }} />
                </div>

                {/* Progress */}
                {step.status === "loading" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {STEPS.map((msg, i) => {
                      const currentIndex = STEPS.indexOf(step.message);
                      const isDone = i < currentIndex, isActive = i === currentIndex;
                      return (
                        <div key={msg} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <div style={{ width: "20px", height: "20px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, transition: "all 0.2s", background: isDone ? "var(--cg)" : "transparent", color: isDone ? "var(--c0)" : "transparent", border: isDone ? "none" : isActive ? "2px solid var(--cg)" : "1px solid var(--cb)" }}>
                            {isDone ? "✓" : isActive ? <span className="er-pulse" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--cg)", display: "block" }} /> : null}
                          </div>
                          <span style={{ fontSize: "12px", color: isDone ? "var(--cm)" : isActive ? "var(--ct)" : "var(--cf)", textDecoration: isDone ? "line-through" : "none", transition: "color 0.2s" }}>{msg}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Error */}
                {step.status === "error" && (
                  <div>
                    <div className="er-alert-error" style={{ flexDirection: "column", gap: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span>✕</span><span style={{ fontWeight: 600 }}>Connection failed</span>
                      </div>
                      <span style={{ opacity: 0.8, paddingLeft: "20px" }}>{step.message}</span>
                    </div>
                    <button onClick={() => setStep({ status: "idle" })} style={{ marginTop: "8px", fontSize: "11px", color: "var(--cm)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font)" }}>← Try again</button>
                  </div>
                )}

                {step.status !== "loading" && (
                  <button onClick={handleConnect} disabled={!input.trim()} className="er-btn-primary" style={{ width: "100%" }}>
                    Connect Repository →
                  </button>
                )}
              </div>
            )}

            {/* Success */}
            {step.status === "success" && (
              <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "18px" }}>
                <div className="er-alert-success" style={{ alignItems: "flex-start" }}>
                  <span style={{ fontWeight: 700, marginTop: "1px" }}>✓</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "13px" }}>Connected successfully!</div>
                    <div style={{ fontSize: "11px", opacity: 0.8, marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font)" }}>{step.repo.fullName}</div>
                  </div>
                  <span className="er-tag">{step.repo.private ? "private" : "public"}</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                  {[["Branch", step.repo.defaultBranch], ["Webhook", `#${step.repo.webhookId}`], ["Status", "Indexing..."]].map(([label, value]) => (
                    <div key={label} style={{ background: "var(--c0)", border: "1px solid var(--cb)", borderRadius: "10px", padding: "10px 12px" }}>
                      <div style={{ fontSize: "9px", color: "var(--cm)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>{label}</div>
                      <div style={{ fontSize: "12px", color: "var(--ct2)", fontFamily: "var(--font)" }}>{value}</div>
                    </div>
                  ))}
                </div>

                {step.repo.description && <p style={{ fontSize: "12px", color: "var(--cm)", fontStyle: "italic", lineHeight: 1.6 }}>{step.repo.description}</p>}

                <div style={{ background: "var(--c0)", border: "1px solid var(--cb)", borderRadius: "12px", padding: "12px 14px", fontSize: "12px", color: "var(--cm)", lineHeight: 1.7 }}>
                  <span style={{ color: "var(--ca)", fontWeight: 600 }}>⚡ Indexing in progress</span>
                  <span> — your repository is being chunked and embedded in the background. You can start chatting now.</span>
                </div>

                <div style={{ display: "flex", gap: "10px" }}>
                  <button onClick={() => router.push(`/repo/${step.repo.id}/chat`)} className="er-btn-primary" style={{ flex: 1 }}>Start Chatting →</button>
                  <button onClick={() => { setInput(""); setStep({ status: "idle" }); }} className="er-btn-ghost">Add more</button>
                </div>
              </div>
            )}
          </div>

          {/* Examples */}
          {step.status === "idle" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <p style={{ fontSize: "10px", color: "var(--cf)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Try an example</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {["vercel/next.js", "supabase/supabase", "facebook/react", "tailwindlabs/tailwindcss"].map((ex) => (
                  <button key={ex} onClick={() => setInput(ex)}
                    style={{ fontSize: "11px", fontFamily: "var(--font)", color: "var(--cm)", border: "1px solid var(--cb)", borderRadius: "8px", padding: "5px 10px", background: "transparent", cursor: "pointer", transition: "border-color 0.15s, color 0.15s" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--cb2)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--ct2)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--cb)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--cm)"; }}>
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
