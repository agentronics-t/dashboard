import { Card, CardTitle, Kpi, PageHeader, fmt } from "@/components/ui";
import { BarList, EventFeed, SdkEmpty } from "@/components/sdk";
import { getSdkRecentEvents } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";
import { LiveRefresh } from "@/components/LiveRefresh";

export const dynamic = "force-dynamic";

export default async function AuthPage() {
  const tenantId = await getTenantId();
  const events = await getSdkRecentEvents(tenantId, {
    types: ["auth.identity_presented", "auth.identity_cleared"],
    limit: 120
  });

  const presented = events.filter((e) => e.type === "auth.identity_presented");
  const byProtocol = new Map<string, number>();
  const byTrust = new Map<string, number>();
  for (const e of presented) {
    if (e.protocol) byProtocol.set(e.protocol, (byProtocol.get(e.protocol) ?? 0) + 1);
    if (e.trust) byTrust.set(e.trust, (byTrust.get(e.trust) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader title="Auth" subtitle="Identities agents presented, by protocol and trust" action={<LiveRefresh />} />
      {events.length === 0 ? (
        <SdkEmpty feature="auth" />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 18 }}>
            <Kpi label="Identities presented" value={fmt(presented.length)} sub="30d" />
            <Kpi label="Protocols" value={fmt(byProtocol.size)} sub="distinct auth methods" />
            <Kpi label="Verified+" value={fmt(presented.filter((e) => e.trust === "verified" || e.trust === "linked").length)} sub="trust ≥ verified" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 18 }}>
            <Card>
              <CardTitle>By protocol</CardTitle>
              <BarList items={[...byProtocol].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} />
            </Card>
            <Card>
              <CardTitle>By trust level</CardTitle>
              <BarList
                items={["linked", "verified", "declared", "detected"].map((t) => ({
                  label: t,
                  value: byTrust.get(t) ?? 0,
                  color: t === "verified" || t === "linked" ? "var(--success)" : t === "declared" ? "var(--warning)" : "var(--neutral-300)"
                }))}
              />
            </Card>
          </div>
          <Card>
            <CardTitle>Recent identity events</CardTitle>
            <EventFeed events={events} />
          </Card>
        </>
      )}
    </>
  );
}
