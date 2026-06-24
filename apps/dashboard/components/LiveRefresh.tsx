"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Lightweight "live" updates: re-run the page's server components every
// `intervalMs` so freshly-streamed SDK events show without a manual reload.
// router.refresh() refetches server data without dropping client state.
export function LiveRefresh({ intervalMs = 15000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        fontSize: 12,
        fontWeight: 600,
        color: "var(--content-muted)"
      }}
      title={`Live — refreshes every ${Math.round(intervalMs / 1000)}s`}
    >
      <style>{"@keyframes ag-live-pulse{0%,100%{opacity:1}50%{opacity:.35}}"}</style>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "var(--success)",
          animation: "ag-live-pulse 1.6s ease-in-out infinite"
        }}
      />
      Live
    </span>
  );
}
