"use client";

// src/components/DisconnectButton.tsx
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DisconnectButton({
  repoId,
  repoName,
}: {
  repoId: string;
  repoName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDisconnect = async () => {
    if (!confirming) { setConfirming(true); return; }
    setLoading(true);
    await fetch("/api/repos/disconnect", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId }),
    });
    router.refresh();
  };

  if (loading) return <span className="text-[10px] text-[oklch(0.38_0.04_260)] font-mono">removing...</span>;

  return confirming ? (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[oklch(0.55_0.08_25)] font-mono">sure?</span>
      <button
        onClick={handleDisconnect}
        className="text-[10px] text-[oklch(0.65_0.18_25)] hover:text-[oklch(0.75_0.18_25)] font-mono transition-colors"
      >
        yes
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="text-[10px] text-[oklch(0.38_0.04_260)] hover:text-[oklch(0.55_0.06_260)] font-mono transition-colors"
      >
        cancel
      </button>
    </div>
  ) : (
    <button
      onClick={handleDisconnect}
      className="text-[10px] text-[oklch(0.35_0.04_260)] hover:text-[oklch(0.55_0.08_25)] font-mono transition-colors"
    >
      disconnect
    </button>
  );
}
