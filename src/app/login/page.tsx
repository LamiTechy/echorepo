"use client";
// src/app/login/page.tsx

import { useState } from "react";
import { createClient } from "@/lib/supabase";

type Mode = "signin" | "signup" | "magic" | "sent";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const sb = createClient();

  const handleSubmit = async () => {
    if (!email.trim()) return;
    setError(""); setLoading(true);
    try {
      if (mode === "magic") {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
        if (error) throw error; setMode("sent"); return;
      }
      if (mode === "signup") {
        const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
        if (error) throw error; setMode("sent"); return;
      }
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.href = "/";
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally { setLoading(false); }
  };

  const tabs: { id: Mode; label: string }[] = [
    { id: "signin", label: "Sign In" },
    { id: "signup", label: "Sign Up" },
    { id: "magic",  label: "✦ Magic" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--c0)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      {/* Subtle grid */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", backgroundImage: "linear-gradient(var(--cb) 1px,transparent 1px),linear-gradient(90deg,var(--cb) 1px,transparent 1px)", backgroundSize: "48px 48px", opacity: 0.2 }} />

      <div style={{ position: "relative", width: "100%", maxWidth: "360px", display: "flex", flexDirection: "column", gap: "32px" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "52px", height: "52px", borderRadius: "14px", background: "var(--c2)", border: "1px solid var(--cb)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
            <span style={{ fontSize: "20px", fontWeight: 700, color: "var(--cg)" }}>&gt;_</span>
          </div>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--ct)", margin: 0 }}>
              <span style={{ color: "var(--cg)" }}>Echo</span>Repo
            </h1>
            <p style={{ fontSize: "11px", color: "var(--cm)", marginTop: "4px" }}>Chat with any GitHub repository</p>
          </div>
        </div>

        {/* Card */}
        <div className="er-card" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
          {/* Tabs */}
          {mode !== "sent" && (
            <div style={{ display: "flex", borderBottom: "1px solid var(--cb)" }}>
              {tabs.map((t) => (
                <button key={t.id} onClick={() => { setMode(t.id); setError(""); }}
                  style={{ flex: 1, padding: "12px 8px", fontSize: "11px", fontWeight: 600, cursor: "pointer", border: "none", fontFamily: "var(--font)", transition: "all 0.15s", background: mode === t.id ? "var(--c2)" : "transparent", color: mode === t.id ? "var(--ct)" : "var(--cm)", borderBottom: mode === t.id ? "2px solid var(--cg)" : "2px solid transparent" }}>
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "18px" }}>
            {mode === "sent" ? (
              <div style={{ textAlign: "center", padding: "24px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
                <div style={{ width: "52px", height: "52px", borderRadius: "50%", background: "var(--cgb)", border: "1px solid var(--cgbd)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px" }}>📬</div>
                <div>
                  <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--ct)" }}>Check your inbox</p>
                  <p style={{ fontSize: "11px", color: "var(--cm)", marginTop: "4px" }}>Sent to <span style={{ color: "var(--cbl)" }}>{email}</span></p>
                </div>
                <button onClick={() => { setMode("signin"); setEmail(""); setPassword(""); }}
                  style={{ fontSize: "11px", color: "var(--cm)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font)" }}>
                  ← Back to sign in
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <label className="er-label">Email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                    placeholder="you@example.com" autoFocus className="er-input" />
                </div>

                {mode !== "magic" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label className="er-label">Password</label>
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                      placeholder="••••••••" className="er-input" />
                  </div>
                )}

                {error && (
                  <div className="er-alert-error">
                    <span style={{ flexShrink: 0, marginTop: "1px" }}>✕</span>
                    <span>{error}</span>
                  </div>
                )}

                <button onClick={handleSubmit} className="er-btn-primary"
                  disabled={loading || !email.trim() || (mode !== "magic" && !password.trim())}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  {loading ? (
                    <>
                      <span className="er-spin" style={{ width: "14px", height: "14px", borderRadius: "50%", border: "2px solid rgba(0,0,0,0.2)", borderTopColor: "rgba(0,0,0,0.8)", display: "inline-block" }} />
                      Please wait...
                    </>
                  ) : mode === "signin" ? "Sign In →" : mode === "signup" ? "Create Account →" : "Send Magic Link →"}
                </button>

                {mode === "magic" && (
                  <p style={{ fontSize: "10px", color: "var(--cf)", textAlign: "center", lineHeight: 1.6 }}>
                    One-click sign-in link sent to your inbox.<br />No password needed.
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <p style={{ textAlign: "center", fontSize: "10px", color: "var(--cf)" }}>
          Secured with Supabase Auth &amp; Row Level Security
        </p>
      </div>
    </div>
  );
}
