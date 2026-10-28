"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Lightweight "live" updates: re-run the page's server components every
// `intervalMs` so freshly-streamed SDK events show without a manual reload.
// router.refresh() refetches server data without dropping client state.
export function LiveRefresh({ intervalMs = 15000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    // A refresh still loading when the visitor clicks to another page can be
    // drawn after that navigation (the old page's data under the new address).
    // So skip a tick once the address has changed, or right after a click on a
    // link, and while the tab is hidden.
    const path = window.location.pathname;
    let lastNav = 0;
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.("a[href]")) lastNav = Date.now();
    };
    const onPop = () => (lastNav = Date.now());
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    const id = setInterval(() => {
      if (window.location.pathname !== path || Date.now() - lastNav < 5000 || document.visibilityState !== "visible") return;
      router.refresh();
    }, intervalMs);
    return () => {
      clearInterval(id);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
    };
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
