import { Card, CardTitle, PageHeader } from "@/components/ui";
import { EventFeed, SdkEmpty } from "@/components/sdk";
import { getSdkRecentEvents } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const tenantId = await getTenantId();
  const events = await getSdkRecentEvents(tenantId, { limit: 200 });

  return (
    <>
      <PageHeader title="Logs" subtitle="Live stream of every SDK event, newest first" />
      {events.length === 0 ? (
        <SdkEmpty feature="SDK" />
      ) : (
        <Card>
          <CardTitle>Recent events · {events.length}</CardTitle>
          <EventFeed events={events} />
        </Card>
      )}
    </>
  );
}
