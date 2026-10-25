import Link from "next/link";
import { Badge, Card, CardTitle, Kpi, PageHeader, fmt } from "@/components/ui";
import { EventFeed, SdkEmpty } from "@/components/sdk";
import { LiveRefresh } from "@/components/LiveRefresh";
import { getFilteredEvents, getLatency, getSessions, type EventFilters } from "@/lib/pillars";
import { getWorkspacePlan } from "@/lib/billing";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const TYPES = [
  "agent.detected",
  "auth.identity_presented",
  "authz.evaluated",
  "tool.executed",
  "tool.surfaced",
  "memory.accessed",
  "sdk.error"
];
const OUTCOMES = ["success", "error", "blocked"];
const CLASSES: Array<[string, string]> = [
  ["webmcp", "WebMCP"],
  ["dom", "Browser automation"],
  ["screenshot", "Vision model"],
  ["crawler", "Crawler"]
];

const ms = (v: number | null) => (v === null ? "—" : `${fmt(v)} ms`);
const duration = (a: Date, b: Date) => {
  const s = Math.round((b.getTime() - a.getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
};

export default async function ObservabilityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const filters: EventFilters = {};
  if (sp.type && TYPES.includes(sp.type)) filters.type = sp.type;
  if (sp.outcome && OUTCOMES.includes(sp.outcome)) filters.outcome = sp.outcome;
  if (sp.class && CLASSES.some(([c]) => c === sp.class)) filters.agentClass = sp.class;
  if (sp.tool) filters.tool = sp.tool.slice(0, 200);
  if (sp.session) filters.session = sp.session.slice(0, 200);

  const tenantId = await getTenantId();
  const [events, sessions, latency, { spec: plan }] = await Promise.all([
    getFilteredEvents(tenantId, filters, 200),
    getSessions(tenantId, 7, 20),
    getLatency(tenantId, 7),
    getWorkspacePlan(tenantId)
  ]);
  const exportQuery = new URLSearchParams(
    Object.entries({ type: filters.type, outcome: filters.outcome, class: filters.agentClass, tool: filters.tool, session: filters.session }).filter(
      (e): e is [string, string] => typeof e[1] === "string"
    )
  ).toString();
  const filtered = Object.keys(filters).length > 0;

  return (
    <>
      <PageHeader title="Observability" subtitle="Every agent session and SDK event — filter, follow a session, spot slow or failing tools" action={<LiveRefresh />} />
      {!filtered && events.length === 0 ? (
        <SdkEmpty feature="SDK" />
      ) : (
        <>
          <div className="ag-grid-kpi">
            <Kpi label="Events, 7d" value={fmt(latency.total)} sub={`${fmt(latency.errors)} errors`} />
            <Kpi label="Error rate" value={latency.total ? `${((latency.errors / latency.total) * 100).toFixed(1)}%` : "0%"} sub="of all events" />
            <Kpi label="Tool call p50" value={ms(latency.p50)} sub={`${fmt(latency.toolCalls)} calls`} />
            <Kpi label="Tool call p95" value={ms(latency.p95)} sub="slowest 5%" />
          </div>

          <Card style={{ marginBottom: 18 }}>
            <CardTitle>Agent sessions · last 7 days</CardTitle>
            {sessions.length === 0 ? (
              <div className="ag-muted" style={{ fontSize: 13 }}>No agent sessions yet.</div>
            ) : (
              <div className="ag-scroll-x">
                <table className="ag-table">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Site</th>
                      <th>Trust</th>
                      <th>Events</th>
                      <th>Tool calls</th>
                      <th>Errors</th>
                      <th>Length</th>
                      <th>Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s.sessionId}>
                        <td>
                          <Link className="ag-link" href={`/logs?session=${encodeURIComponent(s.sessionId)}`}>
                            {s.vendor ?? CLASSES.find(([c]) => c === s.agentClass)?.[1] ?? "Agent"}
                          </Link>
                          <div className="ag-muted ag-mono" style={{ fontSize: 11 }}>{s.sessionId.slice(0, 28)}</div>
                        </td>
                        <td className="ag-mono">{s.siteId}</td>
                        <td>{s.trust ?? "—"}</td>
                        <td>{fmt(s.events)}</td>
                        <td>{fmt(s.toolCalls)}</td>
                        <td>{s.errors ? <Badge kind="failed">{fmt(s.errors)}</Badge> : "0"}</td>
                        <td>{duration(s.startedAt, s.endedAt)}</td>
                        <td className="ag-muted">{s.endedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <CardTitle>
                Events{filters.session ? " in this session" : ""} · {events.length}
              </CardTitle>
              <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select className="ag-select" name="type" defaultValue={filters.type ?? ""}>
                  <option value="">All types</option>
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <select className="ag-select" name="outcome" defaultValue={filters.outcome ?? ""}>
                  <option value="">Any outcome</option>
                  {OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <select className="ag-select" name="class" defaultValue={filters.agentClass ?? ""}>
                  <option value="">Any agent</option>
                  {CLASSES.map(([c, label]) => (
                    <option key={c} value={c}>
                      {label}
                    </option>
                  ))}
                </select>
                <input className="ag-input" name="tool" placeholder="Tool" defaultValue={filters.tool ?? ""} style={{ width: 140 }} />
                {filters.session && <input type="hidden" name="session" value={filters.session} />}
                <button type="submit" className="ag-btn ag-btn-sm">
                  Filter
                </button>
                {filtered && (
                  <Link className="ag-btn ag-btn-sm" href="/logs">
                    Clear
                  </Link>
                )}
                {plan.features.auditAndTraceExport ? (
                  <a className="ag-btn ag-btn-sm" href={`/logs/export${exportQuery ? `?${exportQuery}` : ""}`}>
                    Export CSV
                  </a>
                ) : (
                  <Link className="ag-btn ag-btn-sm" href="/account" title="Raw trace export is part of Enterprise">
                    Export (Enterprise)
                  </Link>
                )}
              </form>
            </div>
            {events.length ? <EventFeed events={events} /> : <div className="ag-muted" style={{ fontSize: 13 }}>No events match.</div>}
          </Card>
        </>
      )}
    </>
  );
}
