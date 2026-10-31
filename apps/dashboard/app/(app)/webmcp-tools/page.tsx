import { Badge, Card, CardTitle, Kpi, PageHeader, fmt } from "@/components/ui";
import { ContextBar, SdkEmpty } from "@/components/sdk";
import { LiveRefresh } from "@/components/LiveRefresh";
import { getToolHealth, getTools, type ToolHealth, type ToolRow } from "@/lib/pillars";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; kind: string; help: string }> = {
  callable: { label: "Callable", kind: "succeeded", help: "Registered with document.modelContext" },
  failed: { label: "Failed", kind: "failed", help: "The browser rejected the registration" },
  disabled: { label: "Disabled", kind: "queued", help: "Turned off in code" },
  unknown: { label: "Not seen", kind: "queued", help: "In your code, but no browser has opened its page since it went live" }
};

const HINTS: Array<[string, string]> = [
  ["readOnlyHint", "read-only"],
  ["consequentialHint", "asks first"],
  ["untrustedContentHint", "untrusted content"]
];

export default async function WebmcpToolsPage() {
  const tenantId = await getTenantId();
  const [tools, health] = await Promise.all([getTools(tenantId), getToolHealth(tenantId, 30)]);

  const counts = { callable: 0, failed: 0, disabled: 0, unknown: 0 } as Record<string, number>;
  for (const t of tools) counts[t.status] = (counts[t.status] ?? 0) + 1;
  const pages = new Map<string, ToolRow[]>();
  for (const t of tools) {
    const key = `${t.siteId} · ${t.page ?? "every page"}`;
    pages.set(key, [...(pages.get(key) ?? []), t]);
  }
  const calls = [...health.values()].reduce((s, h) => s + h.calls, 0);
  const errors = [...health.values()].reduce((s, h) => s + h.errors, 0);

  return (
    <>
      <PageHeader title="WebMCP Tools" subtitle="Every tool your sites expose to agents — by page, with status and cost" action={<LiveRefresh />} />
      {tools.length === 0 ? (
        <SdkEmpty feature="tool" />
      ) : (
        <>
          <div className="ag-grid-kpi">
            <Kpi label="Tools" value={fmt(tools.length)} sub={`on ${fmt(pages.size)} page${pages.size === 1 ? "" : "s"}`} />
            <Kpi label="Callable" value={fmt(counts.callable ?? 0)} sub={`${fmt(counts.unknown ?? 0)} not seen yet`} />
            <Kpi label="Failed" value={fmt(counts.failed ?? 0)} sub="registration rejected" />
            <Kpi label="Calls, 30d" value={fmt(calls)} sub={calls ? `${Math.round(((calls - errors) / calls) * 100)}% succeeded` : "no calls yet"} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {[...pages.entries()].map(([page, pageTools]) => {
              const total = pageTools.reduce((s, t) => s + t.tokens, 0);
              return (
                <Card key={page}>
                  <CardTitle>
                    {page} · {pageTools.length} tool{pageTools.length === 1 ? "" : "s"}
                  </CardTitle>
                  <div style={{ marginBottom: 14 }}>
                    <ContextBar tokens={total} label="Context these tools take on this page" />
                  </div>
                  {pageTools.map((t) => (
                    <ToolLine key={t.toolName} tool={t} health={health.get(`${t.siteId}|${t.toolName}`)} />
                  ))}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function ToolLine({ tool: t, health: h }: { tool: ToolRow; health: ToolHealth | undefined }) {
  const st = STATUS[t.status] ?? STATUS.unknown!;
  return (
    <details style={{ borderTop: "1px solid var(--border)", padding: "10px 4px" }}>
      <summary style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", listStyle: "none", flexWrap: "wrap" }}>
        <span className="ag-mono" style={{ fontWeight: 600 }}>{t.toolName}</span>
        <span title={st.help}>
          <Badge kind={st.kind}>{st.label}</Badge>
        </span>
        {t.groupName && <Badge>{t.groupName}</Badge>}
        {HINTS.filter(([k]) => t.annotations?.[k]).map(([k, label]) => (
          <span key={k} className="ag-muted" style={{ fontSize: 12 }}>
            {label}
          </span>
        ))}
        <span className="ag-muted ag-mono" style={{ marginLeft: "auto", fontSize: 12 }}>
          {h ? `${fmt(h.calls)} calls · ${fmt(h.errors)} errors${h.p95 !== null ? ` · p95 ${fmt(h.p95)}ms` : ""} · ` : ""}~{fmt(t.tokens)} tokens
        </span>
      </summary>
      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
        {t.description && <div style={{ fontSize: 13.5 }}>{t.description}</div>}
        {t.status === "failed" && t.statusError && (
          <div style={{ fontSize: 13, color: "var(--danger)" }}>Registration failed: {t.statusError}</div>
        )}
        {h?.lastError && <div style={{ fontSize: 13, color: "var(--warning)" }}>Last call error: {h.lastError}</div>}
        {h && h.denied > 0 && <div className="ag-muted" style={{ fontSize: 13 }}>{fmt(h.denied)} calls refused by your rules.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
          <Schema title="Input" value={t.inputSchema} />
          {t.outputSchema ? <Schema title="Output" value={t.outputSchema} /> : null}
        </div>
      </div>
    </details>
  );
}

function Schema({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--content-muted)", fontWeight: 700, marginBottom: 4 }}>
        {title}
      </div>
      <pre style={{ margin: 0, background: "var(--code-bg)", color: "var(--code-fg)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "8px 10px", fontSize: 12, fontFamily: "var(--font-mono)", overflowX: "auto" }}>
        {JSON.stringify(value ?? {}, null, 2)}
      </pre>
    </div>
  );
}
