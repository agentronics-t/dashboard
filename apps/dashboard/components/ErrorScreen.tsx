"use client";

import { useEffect } from "react";

// What a client-side crash shows instead of Next's blank "Application error".
// After a deploy, an open console can call a server action or load a code
// chunk that no longer exists; one automatic reload fixes that, so it's done
// for the visitor (at most once a minute, so a real bug can't loop).
const STALE = /Failed to find Server Action|ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|deployment/i;
const KEY = "ag-auto-reload-at";

export function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = STALE.test(`${error.name} ${error.message}`);
  useEffect(() => {
    console.error(error);
    if (!stale) return;
    try {
      const last = Number(sessionStorage.getItem(KEY) ?? 0);
      if (Date.now() - last < 60_000) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      // no storage: still reload once
    }
    window.location.reload();
  }, [error, stale]);

  return (
    <div role="alert" style={{ maxWidth: 520, margin: "12vh auto", padding: 24, border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", background: "var(--surface)", color: "var(--content)" }}>
      <div style={{ fontWeight: 800, fontSize: 18 }}>{stale ? "The console was just updated" : "Something went wrong on this page"}</div>
      <p className="ag-muted" style={{ margin: "8px 0 16px", fontSize: 14 }}>
        {stale ? "Loading the new version…" : "Nothing you did was lost. Try again, or reload the page."}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="ag-btn ag-btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
        {!stale && (
          <button className="ag-btn" onClick={() => reset()}>
            Try again
          </button>
        )}
      </div>
      {error.digest && (
        <p className="ag-muted ag-mono" style={{ fontSize: 11.5, marginTop: 14 }}>
          Ref {error.digest}
        </p>
      )}
    </div>
  );
}
