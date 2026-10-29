"use client";

// The run's activity, one line per step: when it happened (in your time zone),
// which pipeline box it belongs to, what Agent Nic found, and how long it took.
// A step's "started" line is folded into its result once the step finishes.
import { useEffect, useRef } from "react";
import type { RunEvent } from "@/lib/agentNick";
import { LocalTime, useTimeZoneName } from "@/components/LocalTime";
import { stepLabel } from "./Pipeline";

type Row = { id: number | string; at: string; step: string; kind: string; message: string; tookMs: number | null };

const STATE: Record<string, { glyph: string; color: string; label: string }> = {
  start: { glyph: "•", color: "var(--content-secondary)", label: "working" },
  done: { glyph: "✓", color: "var(--success)", label: "done" },
  fail: { glyph: "✕", color: "var(--danger)", label: "failed" },
  wait: { glyph: "!", color: "var(--warning)", label: "waiting for you" },
  info: { glyph: "i", color: "var(--content-muted)", label: "note" }
};

function took(ms: number) {
  if (ms < 1000) return "under 1s";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Oldest first; a finished step's start line is replaced by its result, with the time it took. */
export function foldEvents(events: RunEvent[]): Row[] {
  const rows: Row[] = [];
  const open = new Map<string, number>(); // step → index of its unfinished "start" row
  for (const e of [...events].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt) || Number(a.id) - Number(b.id))) {
    const at = new Date(e.createdAt).toISOString();
    const row: Row = { id: e.id, at, step: e.step, kind: e.kind, message: e.message, tookMs: null };
    const startIdx = open.get(e.step);
    if (e.kind === "start") {
      open.set(e.step, rows.push(row) - 1);
    } else if (startIdx !== undefined && e.kind !== "info") {
      const start = rows[startIdx]!;
      rows[startIdx] = { ...row, at: start.at, tookMs: +new Date(at) - +new Date(start.at) };
      open.delete(e.step);
    } else {
      rows.push(row);
    }
  }
  return rows;
}

export function RunLog({ events }: { events: RunEvent[] }) {
  const zone = useTimeZoneName();
  const list = useRef<HTMLOListElement>(null);
  const rows = foldEvents(events);
  // Keep the newest line in view while the run is going.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  if (!rows.length) return <p className="ag-muted" style={{ margin: 0 }}>Starting…</p>;
  return (
    <>
      <p className="ag-muted" style={{ margin: "-4px 0 10px", fontSize: 12.5 }}>
        Oldest first. Times are in your time zone{zone ? ` (${zone})` : ""}.
      </p>
      <ol className="ag-log">
        {rows.map((r) => {
          const st = STATE[r.kind] ?? STATE.info!;
          return (
            <li key={r.id}>
              <span className="ag-muted">
                <LocalTime at={r.at} format="time" />
              </span>
              <span className="ag-log-step">
                <span aria-hidden style={{ color: st.color, fontWeight: 700, width: 12, display: "inline-block" }}>
                  {st.glyph}
                </span>{" "}
                {stepLabel(r.step)}
                <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                  {st.label}
                </span>
              </span>
              <span style={{ fontFamily: "var(--font-sans)", overflowWrap: "anywhere", color: r.kind === "fail" ? "var(--danger)" : undefined }}>
                {r.message}
                {r.tookMs !== null && <span className="ag-muted"> · {took(r.tookMs)}</span>}
                {r.kind === "start" && <span className="ag-muted"> · working…</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
