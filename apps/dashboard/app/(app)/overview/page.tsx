import { ForecastBand } from "@/components/charts/ForecastBand";
import { StackedArea } from "@/components/charts/StackedArea";
import { Badge, Card, CardTitle, fmt, Kpi, LANES, Legend, PageHeader } from "@/components/ui";
import { getForecasts, getTopAgents, getTrafficSeries } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const tenantId = await getTenantId();
  const [traffic, topAgents] = await Promise.all([
    getTrafficSeries(tenantId, 30),
    getTopAgents(tenantId, 30, 8)
  ]);

  const totalRequests = traffic.reduce((s, d) => s + d.requests, 0);
  const totalBlocked = traffic.reduce((s, d) => s + d.blocked, 0);
  const blockRate = totalRequests ? Math.round((totalBlocked / totalRequests) * 100) : 0;
  const stealth = traffic.reduce((s, d) => s + d.stealth, 0);
  const stealthPct = totalRequests ? Math.round((stealth / totalRequests) * 100) : 0;

  return (
    <>
      <PageHeader title="Overview" subtitle="AI-agent traffic across the last 30 days" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 18 }}>
        <Kpi label="Total requests" value={fmt(totalRequests)} sub="agent traffic, 30d" />
        <Kpi label="Blocked" value={fmt(totalBlocked)} sub={`${blockRate}% of requests`} />
        <Kpi label="Stealth share" value={`${stealthPct}%`} sub="unverified automated" />
        <Kpi label="Distinct agents" value={fmt(topAgents.length)} sub="top observed" />
      </div>

      <Card style={{ marginBottom: 18 }}>
        <CardTitle>Requests by agent lane</CardTitle>
        <StackedArea data={traffic} series={LANES} />
        <Legend items={LANES} />
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <Card>
          <CardTitle>Blocked vs allowed</CardTitle>
          <StackedArea
            data={traffic}
            series={[
              { key: "allowed", label: "Allowed", color: "var(--success)" },
              { key: "blocked", label: "Blocked", color: "var(--danger)" }
            ]}
            height={180}
          />
          <Legend items={[{ label: "Allowed", color: "var(--success)" }, { label: "Blocked", color: "var(--danger)" }]} />
        </Card>

        <Card>
          <CardTitle>Top agents</CardTitle>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {topAgents.length === 0 && <Empty />}
            {topAgents.map((a) => (
              <div key={a.agent} className="ag-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 6px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{a.agent}</span>
                  <Badge kind={a.lane === "stealth" ? "warning" : "info"}>{a.lane}</Badge>
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 13 }}>
                  <span style={{ color: "var(--content-muted)" }}>{fmt(a.requests)} req</span>
                  <span style={{ color: a.blocked ? "var(--danger)" : "var(--content-muted)" }}>{fmt(a.blocked)} blocked</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card style={{ marginTop: 18 }}>
        <CardTitle>Requests forecast · next 14 days</CardTitle>
        <ForecastBand points={(await getForecasts(tenantId)).filter((f) => f.metric === "requests")} />
      </Card>
    </>
  );
}

function Empty() {
  return <div style={{ color: "var(--content-muted)", fontSize: 13, padding: "20px 6px" }}>No agents observed yet.</div>;
}
