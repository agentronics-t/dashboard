import { AddConnector } from "@/components/AddConnector";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui";
import { getConnectors } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const tenantId = await getTenantId();
  const connectors = await getConnectors(tenantId);

  return (
    <>
      <PageHeader title="Settings" subtitle="Connectors and workspace configuration" />

      <Card style={{ marginBottom: 18 }}>
        <CardTitle>Connected sources</CardTitle>
        {connectors.length === 0 && <div style={{ color: "var(--content-muted)", fontSize: 14, marginBottom: 4 }}>No connectors yet.</div>}
        {connectors.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 4px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{c.type}</span>
              <Badge kind={c.secret_ref ? "succeeded" : "warning"}>{c.secret_ref ? "credential set" : "no credential"}</Badge>
            </div>
            <code style={{ fontSize: 12, color: "var(--content-muted)", fontFamily: "var(--font-mono)" }}>
              {JSON.stringify(c.config)}
            </code>
          </div>
        ))}
      </Card>

      <Card style={{ marginBottom: 18 }}>
        <CardTitle>Add a connector</CardTitle>
        <AddConnector />
      </Card>

      <Card>
        <CardTitle>Import schedule</CardTitle>
        <p style={{ margin: 0, color: "var(--content-secondary)", fontSize: 14, lineHeight: 1.55 }}>
          Imports run automatically every day at <strong>02:00 IST</strong> per connector via Cloud Scheduler,
          and you can trigger one any time from <strong>Activity → Run import now</strong>. A watchdog fails
          jobs stuck longer than 2 hours and surfaces them in your insights feed.
        </p>
      </Card>
    </>
  );
}
