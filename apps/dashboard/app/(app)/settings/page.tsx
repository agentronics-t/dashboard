import { Card, CardTitle, PageHeader } from "@/components/ui";
import { Mono } from "@/components/console";
import { TIERS } from "@/lib/billing/plans";
import { currentPlan } from "@/lib/billing/service";
import { db, getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const RETENTION: Record<string, string> = { free: "7 days", pro: "30 days", business: "90 days", enterprise: "Custom" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 2px", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
      <span style={{ color: "var(--content-muted)", fontSize: 13 }}>{label}</span>
      <span style={{ textAlign: "right" }}>{children}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const tenantId = await getTenantId();
  const plan = await currentPlan(db(), tenantId);
  const apiBase = process.env.INTEL_API_URL?.replace(/\/$/, "");
  return (
    <>
      <PageHeader title="Settings" subtitle="Workspace details" />
      <div style={{ display: "grid", gap: 16 }}>
        <Card>
          <CardTitle>Workspace</CardTitle>
          <Row label="Workspace id">
            <Mono>{tenantId}</Mono>
          </Row>
          <Row label="Plan">{TIERS[plan.tier].name}</Row>
          <Row label="Auth log retention">{RETENTION[plan.tier]}</Row>
        </Card>
        <Card>
          <CardTitle>Endpoints</CardTitle>
          <Row label="Ingest URL (AGENTRONICS_INGEST_URL)">
            <Mono>{apiBase ?? "not configured"}</Mono>
          </Row>
          <Row label="Events endpoint">
            <Mono>{apiBase ? `${apiBase}/v1/sdk/events` : "—"}</Mono>
          </Row>
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--content-muted)" }}>
            Keys live under <a href="/configure/api-keys" style={{ color: "var(--brand)" }}>Configure → API keys</a>.
          </p>
        </Card>
      </div>
    </>
  );
}
