import { Card, CardTitle, PageHeader } from "@/components/ui";
import { SdkKeys } from "@/components/SdkKeys";
import { getSdkIngestKeys } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";
import { mintIngestKey, revokeIngestKey } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const tenantId = await getTenantId();
  const keys = await getSdkIngestKeys(tenantId);

  return (
    <>
      <PageHeader title="Settings" subtitle="Workspace preferences" />

      <div style={{ marginBottom: 18 }}>
        <SdkKeys keys={keys} mint={mintIngestKey} revoke={revokeIngestKey} />
      </div>

      <Card style={{ marginBottom: 18 }}>
        <CardTitle>Data sources</CardTitle>
        <p style={{ margin: 0, color: "var(--content-secondary)", fontSize: 14, lineHeight: 1.55 }}>
          Connect and configure your data sources from the <strong>Plugins</strong> page.
          Credentials are stored in Google Secret Manager and never touch the database.
        </p>
      </Card>

      <Card>
        <CardTitle>Import schedule</CardTitle>
        <p style={{ margin: 0, color: "var(--content-secondary)", fontSize: 14, lineHeight: 1.55 }}>
          Imports run automatically every day at <strong>02:00 IST</strong> per connected plugin,
          and you can trigger one any time from <strong>Plugins → Run import now</strong>. A watchdog
          fails jobs stuck longer than 2 hours and surfaces them in your insights feed.
        </p>
      </Card>
    </>
  );
}
