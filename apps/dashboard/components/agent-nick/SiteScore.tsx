"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { removeTrackedSite, rescanSite, saveSiteUrl, testSdk } from "@/app/(app)/agent-nic/actions";
import type { ScanCheck, ScanResult } from "@/lib/siteScore";

// The site's Agent Readiness Score at the top of Agent Nic: one line with the
// score before Agent Nic and after its PR went live; the arrow opens the full
// check list (the same checks as the scan on agentronics.dev).

export interface ScorePoint {
  score: number;
  band: ScanResult["band"]["key"];
  at: string;
}

const BAND_COLOR: Record<ScorePoint["band"], string> = { not: "var(--danger)", partly: "var(--warning)", ready: "var(--success)" };
const BAND_LABEL: Record<ScorePoint["band"], string> = { not: "Not ready", partly: "Partly ready", ready: "Agent-ready" };
const GROUPS = ["find", "read", "act"] as const;

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Score({ label, point }: { label: string; point: ScorePoint }) {
  return (
    <div title={`${BAND_LABEL[point.band]} · ${when(point.at)}`} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
      <span className="ag-muted" style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 26, lineHeight: 1, color: BAND_COLOR[point.band] }}>{point.score}</span>
      <span className="ag-muted" style={{ fontSize: 12 }}>/100</span>
    </div>
  );
}

function Mark({ c }: { c: ScanCheck }) {
  const [bg, glyph] = c.pass ? ["var(--lime)", "✓"] : c.partial ? ["var(--warning)", "–"] : ["var(--danger)", "✕"];
  return (
    <span aria-label={c.pass ? "passed" : c.partial ? "doesn't apply here" : "failed"} style={{ flex: "0 0 18px", height: 18, borderRadius: 999, background: bg, color: c.pass ? "var(--ink)" : "#fff", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, marginTop: 1 }}>
      {glyph}
    </span>
  );
}

function Breakdown({ result }: { result: ScanResult }) {
  return (
    <div className="ag-score-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 14 }}>
      {GROUPS.map((g) => {
        const group = result.groups[g];
        const checks = result.checks.filter((c) => c.group === g);
        return (
          <div key={g} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{group?.label ?? g}</div>
                <div className="ag-muted" style={{ fontSize: 12 }}>{group?.question}</div>
              </div>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 22 }}>{group?.score ?? "–"}</div>
            </div>
            <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 10 }}>
              {checks.map((c) => (
                <li key={c.id} style={{ display: "flex", gap: 10 }}>
                  <Mark c={c} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.title}</div>
                    {c.detail && <div className="ag-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{c.detail}</div>}
                    {!c.pass && !c.partial && c.fix && (
                      <div style={{ fontSize: 12.5, marginTop: 4, fontFamily: "var(--font-mono)" }}>
                        <span style={{ color: "var(--brand-solid)", fontWeight: 700 }}>Fix → </span>
                        {c.fix}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Add a website: score it right away. */
export function SiteUrlForm({ initial = "", first = true, onDone }: { initial?: string; first?: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [url, setUrl] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const res = await saveSiteUrl(url);
          if (!res.ok) return setError(res.error);
          setUrl("");
          onDone?.();
          router.refresh();
        });
      }}
      style={{ display: "grid", gap: 8 }}
    >
      <label htmlFor={first ? "ag-site-url" : "ag-site-url-more"} style={{ fontWeight: 700 }}>
        {first ? "What's your website?" : "Add another website"}
      </label>
      {first && (
        <span className="ag-muted" style={{ fontSize: 13, marginTop: -4 }}>
          We score it now, Agent Nic uses it in every run, and we score it again once Agent Nic&apos;s changes are live.
        </span>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          id={first ? "ag-site-url" : "ag-site-url-more"}
          className="ag-input"
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="yourcompany.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ flex: "1 1 260px", maxWidth: 420 }}
          required
        />
        <button className="ag-btn ag-btn-primary" type="submit" disabled={pending || !url.trim()}>
          {pending ? "Scanning…" : "Get my score"}
        </button>
      </div>
      {error && (
        <span role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>
          {error}
        </span>
      )}
    </form>
  );
}

export function SiteScore({
  id,
  url,
  before,
  after,
  waiting,
  latest
}: {
  id: string;
  url: string;
  before: ScorePoint | null;
  after: ScorePoint | null;
  /** Agent Nic's PR is merged and we're waiting for the site to redeploy. */
  waiting: boolean;
  latest: ScanResult | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [pending, start] = useTransition();
  const host = url.replace(/^https?:\/\//, "");
  const gain = before && after ? after.score - before.score : null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <a className="ag-link" href={url} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
            {host}
          </a>
          <div className="ag-muted" style={{ fontSize: 12.5 }}>
            Agent Readiness Score ·{" "}
            <button
              type="button"
              className="ag-link"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(`Stop tracking ${host}? Its past scores are kept.`)) return;
                start(async () => {
                  const res = await removeTrackedSite(id);
                  if (!res.ok) setError(res.error);
                  router.refresh();
                });
              }}
              style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" }}
            >
              remove
            </button>
          </div>
        </div>
        {before ? <Score label={after ? "Before" : "Now"} point={before} /> : <span className="ag-muted">Not scored yet</span>}
        {after && (
          <>
            <span aria-hidden className="ag-muted" style={{ fontSize: 18 }}>
              →
            </span>
            <Score label="After" point={after} />
            {gain !== null && gain !== 0 && (
              <span style={{ fontWeight: 700, fontSize: 13, color: gain > 0 ? "var(--success)" : "var(--danger)" }}>
                {gain > 0 ? `+${gain}` : gain}
              </span>
            )}
          </>
        )}
        {waiting && <span className="ag-muted" style={{ fontSize: 12.5 }}>Agent Nic&apos;s PR is merged: scanning again once your site redeploys…</span>}
        {!after && !waiting && before && before.band !== "ready" && (
          <span className="ag-muted" style={{ fontSize: 12.5 }}>Run Agent Nic on your site&apos;s repo to fix what&apos;s missing.</span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="ag-btn ag-btn-sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await rescanSite(id);
                if (!res.ok) setError(res.error);
                router.refresh();
              })
            }
          >
            {pending && !testing ? "Scanning…" : "Scan again"}
          </button>
          <button
            type="button"
            className="ag-btn ag-btn-sm"
            disabled={pending}
            title="Check the Agentronics SDK is on this site and send test events to every console page"
            onClick={() => {
              setTesting(true);
              start(async () => {
                setError(null);
                setNote(null);
                const res = await testSdk(id);
                if (res.ok) setNote(res.message);
                else setError(res.error);
                setTesting(false);
                router.refresh();
              });
            }}
          >
            {testing ? "Testing…" : "Send test events"}
          </button>
          {latest && (
            <button
              type="button"
              className="ag-btn ag-btn-sm"
              aria-expanded={open}
              aria-label={open ? "Hide the full analysis" : "Show the full analysis"}
              onClick={() => setOpen((o) => !o)}
              style={{ width: 32, padding: 0, justifyContent: "center" }}
            >
              <span aria-hidden style={{ display: "inline-block", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}>
                ▾
              </span>
            </button>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>
          {error}
        </div>
      )}
      {note && (
        <div role="status" style={{ color: "var(--success)", fontSize: 13, marginTop: 8 }}>
          {note}
        </div>
      )}
      {open && latest && (
        <>
          <div className="ag-muted" style={{ fontSize: 12.5, marginTop: 12 }}>
            {latest.passed} of {latest.total} checks pass{after ? " (latest scan)" : ""}.
          </div>
          <Breakdown result={latest} />
        </>
      )}
    </div>
  );
}

/** Under the list: add another website, or say the plan is full. */
export function AddWebsite({ canAdd, note }: { canAdd: boolean; note: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
      {open ? (
        <SiteUrlForm first={false} onDone={() => setOpen(false)} />
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {canAdd && (
            <button type="button" className="ag-btn ag-btn-sm" onClick={() => setOpen(true)}>
              + Add website
            </button>
          )}
          <span className="ag-muted" style={{ fontSize: 12.5 }}>
            {note}
            {!canAdd && (
              <>
                {" · "}
                <a className="ag-link" href="/account">
                  upgrade for more
                </a>
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
