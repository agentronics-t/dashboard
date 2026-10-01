// Presentational pieces for the agent-auth console — server-safe, token-driven.
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { ago, methodLabel, type AuthLogRow } from "@/lib/console";

export const tableHead: CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--content-muted)",
  padding: "8px 10px",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap"
};

export const tableCell: CSSProperties = {
  padding: "10px",
  borderBottom: "1px solid var(--border)",
  fontSize: 13,
  verticalAlign: "middle"
};

const OUTCOME: Record<string, { kind: string; label: string }> = {
  success: { kind: "succeeded", label: "Verified" },
  error: { kind: "warning", label: "Unverified" },
  blocked: { kind: "failed", label: "Blocked" }
};

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const o = OUTCOME[outcome] ?? { kind: "info", label: outcome };
  return <Badge kind={o.kind}>{o.label}</Badge>;
}

export function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? <Badge kind="succeeded">Verified</Badge> : <Badge kind="warning">Unverified</Badge>;
}

export function Mono({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: muted ? "var(--content-muted)" : undefined, wordBreak: "break-all" }}>
      {children}
    </span>
  );
}

/** Empty state shared by every console page until auth events arrive. */
export function ConsoleEmpty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card style={{ textAlign: "center", padding: "44px 18px" }}>
      <div style={{ fontSize: 15, fontWeight: 650 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--content-muted)", marginTop: 8, maxWidth: 520, marginInline: "auto", lineHeight: 1.6 }}>
        {children ?? (
          <>
            Add <code>agentronicsMiddleware()</code> to your app and stream auth events with an ingest key from{" "}
            <Link href="/configure/api-keys" style={{ color: "var(--brand)" }}>
              API keys
            </Link>
            . See the{" "}
            <a href="https://agentronics.dev/docs/getting-started" style={{ color: "var(--brand)" }}>
              quickstart
            </a>
            .
          </>
        )}
      </div>
    </Card>
  );
}

/** Auth log table — one row per sign-in / verification attempt. */
export function AuthLogTable({ rows, showAgent = true }: { rows: AuthLogRow[]; showAgent?: boolean }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={tableHead}>Time</th>
            {showAgent && <th style={tableHead}>Agent</th>}
            <th style={tableHead}>Method</th>
            <th style={tableHead}>Result</th>
            <th style={tableHead}>Page</th>
            <th style={tableHead}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="ag-row">
              <td style={{ ...tableCell, whiteSpace: "nowrap", color: "var(--content-muted)" }} title={new Date(r.occurredAt).toISOString()}>
                {ago(new Date(r.occurredAt))}
              </td>
              {showAgent && (
                <td style={tableCell}>
                  <Link href={`/agents/${encodeURIComponent(r.identity)}`} style={{ color: "var(--content)", fontWeight: 600, textDecoration: "none" }}>
                    {r.vendor ?? r.identity}
                  </Link>
                  {r.vendor && r.vendor !== r.identity && (
                    <div>
                      <Mono muted>{r.identity}</Mono>
                    </div>
                  )}
                </td>
              )}
              <td style={tableCell}>{methodLabel(r.method)}</td>
              <td style={tableCell}>
                <OutcomeBadge outcome={r.outcome} />
              </td>
              <td style={tableCell}>
                <Mono muted>{r.page ?? "—"}</Mono>
              </td>
              <td style={tableCell}>
                <Mono muted>{r.error ?? r.decision ?? "—"}</Mono>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Pill-shaped filter links (server-rendered, URL-driven). */
export function FilterPills({ options, active }: { options: { label: string; href: string; value: string }[]; active: string }) {
  return (
    <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 999, border: "1px solid var(--border)", background: "var(--surface)" }}>
      {options.map((o) => (
        <Link
          key={o.value}
          href={o.href}
          style={{
            padding: "5px 12px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
            background: o.value === active ? "var(--content)" : "transparent",
            color: o.value === active ? "var(--surface)" : "var(--content-secondary)"
          }}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
