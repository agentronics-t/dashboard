import { Card, CardTitle, PageHeader } from "@/components/ui";
import { EventFeed, SdkEmpty } from "@/components/sdk";
import { getSdkRecentEvents, getSdkSiteMemory } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

function band(score: number) {
  if (score >= 75) return { label: "Strong", color: "var(--success)" };
  if (score >= 50) return { label: "Adequate", color: "var(--warning)" };
  return { label: "Thin", color: "var(--danger)" };
}

export default async function KnaphPage() {
  const tenantId = await getTenantId();
  const [memory, events] = await Promise.all([
    getSdkSiteMemory(tenantId),
    getSdkRecentEvents(tenantId, { types: ["memory.accessed", "memory.updated"], limit: 80 })
  ]);

  return (
    <>
      <PageHeader
        title="Knaph"
        subtitle="Site memory — the structured context your sites serve to agents"
      />
      {memory.length === 0 && events.length === 0 ? (
        <SdkEmpty feature="site-memory" />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, marginBottom: 18 }}>
            {memory.map((m) => {
              const b = m.score != null ? band(m.score) : null;
              return (
                <Card key={m.siteId}>
                  <CardTitle>{m.siteId}</CardTitle>
                  {b && (
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 30, fontWeight: 800, color: b.color, lineHeight: 1 }}>{m.score}</span>
                      <span style={{ color: "var(--content-muted)", fontSize: 13 }}>/ 100</span>
                      <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: b.color, background: `color-mix(in srgb, ${b.color} 14%, transparent)`, padding: "3px 10px", borderRadius: "var(--radius-pill)" }}>
                        {b.label}
                      </span>
                    </div>
                  )}
                  <pre style={{ margin: 0, maxHeight: 220, overflow: "auto", background: "var(--code-bg)", color: "var(--code-fg)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 12px", fontSize: 12, fontFamily: "var(--font-mono)" }}>
                    {JSON.stringify(m.snapshot ?? {}, null, 2)}
                  </pre>
                </Card>
              );
            })}
          </div>
          <Card>
            <CardTitle>Memory activity</CardTitle>
            <EventFeed events={events} />
          </Card>
        </>
      )}
    </>
  );
}
