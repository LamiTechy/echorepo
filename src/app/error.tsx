"use client";
import { useEffect } from "react";
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div style={{ minHeight: "100vh", background: "var(--c0)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "var(--font)" }}>
      <div style={{ maxWidth: "420px", width: "100%", display: "flex", flexDirection: "column", gap: "20px" }}>
        <div style={{ background: "var(--crb)", border: "1px solid var(--crbd)", borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ color: "var(--cr)", fontSize: "18px" }}>⚠</span>
            <div>
              <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--ct)", margin: 0 }}>Something went wrong</h2>
              {error.digest && <p style={{ fontSize: "10px", color: "var(--cm)", marginTop: "2px" }}>ID: {error.digest}</p>}
            </div>
          </div>
          <div style={{ background: "var(--c0)", border: "1px solid var(--cb)", borderRadius: "10px", padding: "12px 14px", fontSize: "12px", color: "var(--cm)", fontFamily: "var(--font)", lineHeight: 1.6 }}>
            {error.message ?? "An unexpected error occurred."}
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={reset} className="er-btn-primary" style={{ flex: 1 }}>Try again</button>
          <button onClick={() => window.location.href = "/"} className="er-btn-ghost" style={{ flex: 1 }}>Go home</button>
        </div>
      </div>
    </div>
  );
}
