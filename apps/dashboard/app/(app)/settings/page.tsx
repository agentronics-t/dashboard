import { PageHeader } from "@/components/ui";
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

      <SdkKeys keys={keys} mint={mintIngestKey} revoke={revokeIngestKey} />
    </>
  );
}
