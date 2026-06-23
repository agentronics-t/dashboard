import { Card, CardTitle, Kpi, PageHeader, fmt } from "@/components/ui";
import { BarList, EventFeed, SdkEmpty } from "@/components/sdk";
import { getSdkEventDaily, getSdkRecentEvents } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function DetectPage() {
  const tenantId = await getTenantId();
  const [daily, events] = await Promise.all([
    getSdkEventDaily(tenantId, 30),
    getSdkRecentEvents(tenantId, { types: ["agent.detected", "agent.missed"], limit: 80 })
  ]);

  const detectRows = daily.filter((d) => d.type === "agent.detected");
  const detected = detectRows.reduce((s, d) => s + d.count, 0);
  const missed = daily.filter((d) => d.type === "agent.missed").reduce((s, d) => s + d.count, 0);

  const byClass = new Map<string, number>();
  for (const d of detectRows) byClass.set(d.agentClass, (byClass.get(d.agentClass) ?? 0) + d.count);
  const vendors = new Map<string, number>();
  for (const e of events)
    if (e.type === "agent.detected" && e.agentVendor)
      vendors.set(e.agentVendor, (vendors.get(e.agentVendor) ?? 0) + 1);

  const hasData = detected + missed > 0;

  return (
    <>
      <PageHeader title="Detect" subtitle="Which agents the SDK identified on your pages" />
      {!hasData ? (
        <SdkEmpty feature="detection" />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 18 }}>
            <Kpi label="Detected" value={fmt(detected)} sub="agents identified, 30d" />
            <Kpi label="Missed" value={fmt(missed)} sub="ran but no class fired" />
            <Kpi label="Distinct vendors" value={fmt(vendors.size)} sub="observed" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 18 }}>
            <Card>
              <CardTitle>By agent class</CardTitle>
              <BarList
                items={[...byClass].map(([label, value]) => ({
                  label,
                  value,
                  color: label === "crawler" ? "var(--accent)" : "var(--brand)"
                }))}
              />
            </Card>
            <Card>
              <CardTitle>Top vendors</CardTitle>
              <BarList items={[...vendors].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }))} />
            </Card>
          </div>
          <Card>
            <CardTitle>Recent detections</CardTitle>
            <EventFeed events={events} />
          </Card>
        </>
      )}
    </>
  );
}
