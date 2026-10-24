import { Card, CardTitle, Kpi, PageHeader, fmt } from "@/components/ui";
import { BarList, EventFeed, SdkEmpty } from "@/components/sdk";
import { getSdkEventDaily, getSdkRecentEvents } from "@/lib/queries";
import { getDetectionSources } from "@/lib/pillars";
import { getTenantId } from "@/lib/tenant";
import { LiveRefresh } from "@/components/LiveRefresh";

export const dynamic = "force-dynamic";

const CLASS_LABEL: Record<string, string> = { webmcp: "WebMCP", dom: "Browser automation", screenshot: "Vision model", crawler: "Crawler" };

export default async function DetectPage() {
  const tenantId = await getTenantId();
  const [daily, events, sources] = await Promise.all([
    getSdkEventDaily(tenantId, 30),
    getSdkRecentEvents(tenantId, { types: ["agent.detected", "agent.missed"], limit: 80 }),
    getDetectionSources(tenantId, 30)
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
      <PageHeader title="Detect" subtitle="Agents on your pages — self-declared, browser automation, vision models, WebMCP and crawlers" action={<LiveRefresh />} />
      {!hasData ? (
        <SdkEmpty feature="detection" />
      ) : (
        <>
          <div className="ag-grid-kpi">
            <Kpi label="Detected" value={fmt(detected)} sub="agents identified, 30d" />
            <Kpi label="Missed" value={fmt(missed)} sub="ran but no class fired" />
            <Kpi label="Distinct vendors" value={fmt(vendors.size)} sub="observed" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18, marginBottom: 18 }}>
            <Card>
              <CardTitle>How they were found</CardTitle>
              <BarList items={sources.filter((s) => s.count > 0).map((s) => ({ label: s.source, value: s.count, color: s.source === "Vision model" ? "var(--accent)" : "var(--brand)" }))} />
              <p className="ag-muted" style={{ fontSize: 12, margin: "10px 0 0", lineHeight: 1.5 }}>
                Vision-model agents are spotted by how they interact — clicks with no mouse travel, clicks at an element&apos;s exact centre,
                perfectly even typing. Detection only labels traffic; it never blocks it.
              </p>
            </Card>
            <Card>
              <CardTitle>By agent class</CardTitle>
              <BarList
                items={[...byClass].map(([label, value]) => ({
                  label: CLASS_LABEL[label] ?? label,
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
