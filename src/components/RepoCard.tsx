"use client";
// src/components/RepoCard.tsx — client component so hover handlers work

import Link from "next/link";
import { useState } from "react";
import type { Repository } from "@/lib/types";
import DisconnectButton from "./DisconnectButton";

export default function RepoCard({ repo }: { repo: Repository }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderRadius: "16px",
        border: `1px solid ${hovered ? "var(--cb2)" : "var(--cb)"}`,
        background: hovered ? "var(--c2)" : "var(--c1)",
        display: "flex", flexDirection: "column",
        transition: "border-color 0.15s, background 0.15s",
        overflow: "hidden",
      }}
    >
      <Link href={`/repo/${repo.id}/chat`} style={{ flex: 1, padding: "16px", display: "block", textDecoration: "none" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "12px" }}>
          <span style={{ fontSize: "13px", color: "var(--cg)", fontWeight: 500, wordBreak: "break-all", lineHeight: 1.4 }}>
            {repo.full_name}
          </span>
          <span className="er-tag" style={{ flexShrink: 0 }}>{repo.default_branch}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: repo.last_synced_at ? "var(--cg)" : "var(--ca)", flexShrink: 0 }} />
          <span style={{ fontSize: "10px", color: "var(--cm)" }}>
            {repo.last_synced_at
              ? `Synced ${new Date(repo.last_synced_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
              : "Indexing..."}
          </span>
        </div>
        <span style={{ fontSize: "11px", color: "var(--cm)" }}>Chat with this repo →</span>
      </Link>
      <div style={{ borderTop: "1px solid var(--cb)", padding: "8px 16px", display: "flex", justifyContent: "flex-end" }}>
        <DisconnectButton repoId={repo.id} repoName={repo.full_name} />
      </div>
    </div>
  );
}