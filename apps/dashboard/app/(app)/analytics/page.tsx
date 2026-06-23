import { Card, CardTitle, Kpi, PageHeader, fmt } from "@/components/ui";
import { BarList, SdkEmpty } from "@/components/sdk";
import { getSdkEventTotals } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const PILLAR_LABEL: Record<string, string> = {
  "agent.detected": "Detections",
  "auth.identity_presented": "Auth presents",
  "authz.evaluated": "Authz decisions",
  "tool.executed": "Tool calls",
  "memory.accessed": "Memory reads",
  "sdk.error": "Errors"
};

export default async function AnalyticsPage() {
  const tenantId = await getTenantId();
  const totals = await getSdkEventTotals(tenantId, 30);

  const all = Object.values(totals).reduce((s, n) => s + n, 0);
  const toolCalls = totals["tool.executed"] ?? 0;
  const errors = totals["sdk.error"] ?? 0;

  return (
    <>
      <PageHeader title="Analytics" subtitle="Cross-pillar SDK activity over the last 30 days" />
      {all === 0 ? (
        <SdkEmpty feature="SDK" />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 18 }}>
            <Kpi label="Total events" value={fmt(all)} sub="all pillars, 30d" />
            <Kpi label="Tool calls" value={fmt(toolCalls)} sub="tool.executed" />
            <Kpi label="Errors" value={fmt(errors)} sub="sdk.error" />
          </div>
          <Card>
            <CardTitle>Events by pillar</CardTitle>
            <BarList
              items={Object.entries(totals)
                .sort((a, b) => b[1] - a[1])
                .map(([type, value]) => ({ label: PILLAR_LABEL[type] ?? type, value }))}
            />
          </Card>
        </>
      )}
    </>
  );
}
