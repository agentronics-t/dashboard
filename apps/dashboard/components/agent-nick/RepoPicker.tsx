"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { listRepos, startOnRepo, type RepoOption } from "@/app/(app)/agent-nic/actions";

/** Every repo the GitHub App can see; pick one and Agent Nic starts on it. */
export function RepoPicker({ manageLinks }: { manageLinks: { label: string; href: string }[] }) {
  const router = useRouter();
  const [repos, setRepos] = useState<RepoOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [, start] = useTransition();

  useEffect(() => {
    let alive = true;
    listRepos().then((r) => {
      if (!alive) return;
      if (r.ok) setRepos(r.repos);
      else setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (repos ?? []).filter((r) => !q || r.fullName.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q)).slice(0, 50);
  }, [repos, query]);

  const go = (r: RepoOption) => {
    setBusy(r.id);
    setError(null);
    start(async () => {
      const res = await startOnRepo(r.installationId, r.id);
      if (res.ok) router.push(`/agent-nic/runs/${res.runId}`);
      else {
        setError(res.error);
        setBusy(null);
      }
    });
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input
          className="ag-input"
          style={{ flex: "1 1 240px" }}
          placeholder="Search your repositories"
          aria-label="Search repositories"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {manageLinks.map((l) => (
          <a key={l.href} className="ag-btn ag-btn-sm" href={l.href} target="_blank" rel="noreferrer">
            {l.label} ↗
          </a>
        ))}
      </div>
      {error && <p style={{ color: "var(--danger)", margin: "0 0 10px", fontSize: 13 }}>{error}</p>}
      {repos === null && !error && <p className="ag-muted" style={{ margin: 0 }}>Loading your repositories…</p>}
      {repos !== null && !shown.length && (
        <p className="ag-muted" style={{ margin: 0 }}>
          {repos.length ? "No repository matches that search." : "The GitHub App can't see any repositories yet — grant it access to one."}
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {shown.map((r) => (
          <div key={r.id} className="ag-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 6px", borderTop: "1px solid var(--border)" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="ag-mono" style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{r.fullName}</span>
                {r.private && <span className="ag-muted" style={{ fontSize: 11, border: "1px solid var(--border)", borderRadius: 999, padding: "0 7px" }}>private</span>}
              </div>
              {r.description && <div className="ag-muted" style={{ fontSize: 12.5, marginTop: 2, overflowWrap: "anywhere" }}>{r.description}</div>}
            </div>
            {r.siteId ? (
              <Link className="ag-btn ag-btn-sm" href={`/agent-nic/sites/${r.siteId}`}>
                Open
              </Link>
            ) : (
              <button className="ag-btn ag-btn-sm ag-btn-primary" disabled={busy !== null} onClick={() => go(r)}>
                {busy === r.id ? "Starting…" : "Start Agent Nic"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
