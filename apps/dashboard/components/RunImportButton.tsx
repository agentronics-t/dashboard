"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RunImportButton({ connectorId, disabled }: { connectorId?: string; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    if (!connectorId) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connector_id: connectorId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      setMsg(`Queued job ${String(data.job_id).slice(0, 8)}…`);
      setTimeout(() => router.refresh(), 1200);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {msg && <span style={{ fontSize: 12, color: "var(--content-muted)", fontFamily: "var(--font-mono)" }}>{msg}</span>}
      <button
        onClick={run}
        disabled={busy || disabled || !connectorId}
        style={{
          padding: "9px 16px",
          borderRadius: "var(--radius-md)",
          border: "none",
          background: disabled || !connectorId ? "var(--surface-raised)" : "var(--brand-solid)",
          color: disabled || !connectorId ? "var(--content-muted)" : "#fff",
          fontWeight: 600,
          fontSize: 14,
          cursor: busy || disabled || !connectorId ? "default" : "pointer",
          opacity: busy ? 0.7 : 1
        }}
      >
        {busy ? "Queuing…" : "Run import now"}
      </button>
    </div>
  );
}
