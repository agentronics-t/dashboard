"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptRun, rerunSite } from "@/app/(app)/agent-nick/actions";

/** "Accept" merges the PR on GitHub (branch protection still applies). */
export function AcceptButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <button
        className="ag-btn ag-btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await acceptRun(runId);
            if (!res.ok) setError(res.error);
            router.refresh();
          })
        }
      >
        {pending ? "Merging…" : "Accept & merge"}
      </button>
      {error && <span style={{ color: "var(--danger)", fontSize: 12.5, maxWidth: 360 }}>{error}</span>}
    </span>
  );
}

export function RerunButton({ siteId, label = "Run again", primary = false }: { siteId: string; label?: string; primary?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <button
        className={`ag-btn${primary ? " ag-btn-primary" : ""}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await rerunSite(siteId);
            if (res.ok) router.push(`/agent-nick/runs/${res.runId}`);
            else setError(res.error);
          })
        }
      >
        {pending ? "Starting…" : label}
      </button>
      {error && <span style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</span>}
    </span>
  );
}
