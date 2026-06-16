import { Card, CardTitle, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Workspace preferences" />

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
