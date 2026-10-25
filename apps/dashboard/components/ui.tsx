// Shared presentational primitives in the design system: flat white cards,
// display-font headings, mono labels. Hard shadows are for things you press.
import type { CSSProperties, ReactNode } from "react";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 22 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 650, letterSpacing: "-0.035em", lineHeight: 1.05 }}>{title}</h1>
        {subtitle && <p style={{ margin: "8px 0 0", color: "var(--content-secondary)", fontSize: 15 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-xl)", padding: 20, ...style }}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <div style={{ fontFamily: "var(--font-heading)", fontSize: 17, fontWeight: 650, marginBottom: 14, letterSpacing: "-0.02em" }}>{children}</div>;
}

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--content-muted)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 34, fontWeight: 750, letterSpacing: "-0.04em", marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--content-muted)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

const SEVERITY: Record<string, { bg: string; fg: string }> = {
  info: { bg: "var(--info-bg)", fg: "var(--info)" },
  warning: { bg: "var(--warning-bg)", fg: "var(--warning)" },
  critical: { bg: "var(--danger-bg)", fg: "var(--danger)" }
};
const STATUS: Record<string, { bg: string; fg: string }> = {
  succeeded: { bg: "var(--success-bg)", fg: "var(--success)" },
  running: { bg: "var(--info-bg)", fg: "var(--info)" },
  queued: { bg: "var(--surface-raised)", fg: "var(--content-secondary)" },
  failed: { bg: "var(--danger-bg)", fg: "var(--danger)" }
};

export function Badge({ children, kind = "info" }: { children: ReactNode; kind?: string }) {
  const c = SEVERITY[kind] ?? STATUS[kind] ?? { bg: "var(--surface-raised)", fg: "var(--content-secondary)" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: "var(--radius-pill)", background: c.bg, color: c.fg, fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.fg }} />
      {children}
    </span>
  );
}

export const LANES = [
  { key: "webmcp", label: "WebMCP", color: "var(--data-1)" },
  { key: "webbotauth", label: "Web Bot Auth", color: "var(--data-2)" },
  { key: "stealth", label: "Stealth", color: "var(--data-3)" }
];

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--content-secondary)" }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
