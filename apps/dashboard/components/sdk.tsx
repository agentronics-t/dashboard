// Shared presentational pieces for the SDK pages — token-driven, server-safe.
import type { ReactNode } from "react";
import { Badge, Card, fmt } from "@/components/ui";
import type { SdkEventRow } from "@/lib/queries";

/** Shown on every SDK page until events arrive. */
export function SdkEmpty({ feature }: { feature: string }) {
  return (
    <Card style={{ textAlign: "center", padding: "44px 18px" }}>
      <div style={{ fontSize: 14, color: "var(--content-secondary)", fontWeight: 600 }}>
        No {feature} events yet
      </div>
      <div style={{ fontSize: 13, color: "var(--content-muted)", marginTop: 6, maxWidth: 460, marginInline: "auto" }}>
        Add an SDK ingest key in{" "}
        <a href="/settings" style={{ color: "var(--brand)" }}>
          Settings
        </a>{" "}
        and stream events from your backend to <code>POST /v1/sdk/events</code>.
      </div>
    </Card>
  );
}

const OUTCOME_KIND: Record<string, string> = {
  success: "succeeded",
  blocked: "warning",
  error: "failed"
};

const shortTime = (d: Date) =>
  new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

/** A scrollable feed of raw events — used by Logs + per-pillar pages. */
export function EventFeed({ events, showType = true }: { events: SdkEventRow[]; showType?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {events.map((e) => (
        <div
          key={e.id}
          className="ag-row"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "9px 6px",
            borderBottom: "1px solid var(--border)",
            fontSize: 13
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ color: "var(--content-muted)", fontFamily: "var(--font-mono)", fontSize: 12, flex: "none" }}>
              {shortTime(e.occurredAt)}
            </span>
            {showType && (
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, flex: "none" }}>{e.type}</span>
            )}
            {e.agentClass && <Badge kind={e.agentClass === "crawler" ? "info" : "info"}>{e.agentClass}</Badge>}
            {e.agentVendor && <span style={{ color: "var(--content-secondary)" }}>{e.agentVendor}</span>}
            {e.tool && <span style={{ color: "var(--content-secondary)", fontFamily: "var(--font-mono)" }}>{e.tool}</span>}
            {e.page && <span style={{ color: "var(--content-muted)" }}>{e.page}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
            {e.protocol && <span style={{ color: "var(--content-muted)" }}>{e.protocol}</span>}
            {e.trust && <span style={{ color: "var(--content-muted)" }}>{e.trust}</span>}
            <Badge kind={OUTCOME_KIND[e.outcome] ?? "info"}>{e.outcome}</Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface Bar {
  label: string;
  value: number;
  color?: string;
}

/** Simple horizontal bar list (counts by class / vendor / outcome). */
export function BarList({ items }: { items: Bar[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((it) => (
        <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 130, flex: "none", fontSize: 13, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {it.label}
          </span>
          <div style={{ flex: 1, height: 9, borderRadius: "var(--radius-pill)", background: "var(--surface-raised)", overflow: "hidden" }}>
            <div style={{ width: `${(it.value / max) * 100}%`, height: "100%", background: it.color ?? "var(--brand)" }} />
          </div>
          <span style={{ width: 56, flex: "none", textAlign: "right", fontSize: 13, color: "var(--content-muted)" }}>{fmt(it.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Tool-management context-fullness bar (budget 4000 tokens/page). */
export function ContextBar({ tokens, budget = 4000, label }: { tokens: number; budget?: number; label?: ReactNode }) {
  const pct = Math.round((tokens / budget) * 100);
  const color = pct > 100 ? "var(--danger)" : pct > 75 ? "var(--warning)" : "var(--brand)";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
        <span style={{ color: "var(--content-secondary)", fontWeight: 600 }}>{label ?? "Context fullness"}</span>
        <span style={{ color: "var(--content-muted)", fontFamily: "var(--font-mono)" }}>
          {fmt(tokens)} / {fmt(budget)} tokens · {pct}%
        </span>
      </div>
      <div style={{ height: 9, borderRadius: "var(--radius-pill)", background: "var(--surface-raised)", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}
