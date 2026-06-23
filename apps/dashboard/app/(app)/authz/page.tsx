import { Card, CardTitle, Kpi, PageHeader, fmt } from "@/components/ui";
import { BarList, EventFeed, SdkEmpty } from "@/components/sdk";
import { getSdkEventDaily, getSdkRecentEvents } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function AuthzPage() {
  const tenantId = await getTenantId();
  const [daily, events] = await Promise.all([
    getSdkEventDaily(tenantId, 30),
    getSdkRecentEvents(tenantId, { types: ["authz.evaluated", "authz.policies_set"], limit: 100 })
  ]);

  const evald = daily.filter((d) => d.type === "authz.evaluated");
  const byOutcome = new Map<string, number>();
  for (const d of evald) byOutcome.set(d.outcome, (byOutcome.get(d.outcome) ?? 0) + d.count);
  const total = evald.reduce((s, d) => s + d.count, 0);
  const blocked = byOutcome.get("blocked") ?? 0;
  const blockRate = total ? Math.round((blocked / total) * 100) : 0;

  return (
    <>
      <PageHeader title="Authz" subtitle="Policy decisions on governed tool calls" />
      {total === 0 && events.length === 0 ? (
        <SdkEmpty feature="authorization" />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 18 }}>
            <Kpi label="Evaluations" value={fmt(total)} sub="30d" />
            <Kpi label="Blocked" value={fmt(blocked)} sub={`${blockRate}% of decisions`} />
            <Kpi label="Allowed" value={fmt(byOutcome.get("success") ?? 0)} sub="permitted" />
          </div>
          <Card style={{ marginBottom: 18 }}>
            <CardTitle>Decisions by outcome</CardTitle>
            <BarList
              items={[
                { label: "allowed", value: byOutcome.get("success") ?? 0, color: "var(--success)" },
                { label: "blocked", value: byOutcome.get("blocked") ?? 0, color: "var(--danger)" },
                { label: "error", value: byOutcome.get("error") ?? 0, color: "var(--warning)" }
              ]}
            />
          </Card>
          <Card>
            <CardTitle>Recent decisions</CardTitle>
            <EventFeed events={events} />
          </Card>
        </>
      )}
    </>
  );
}
