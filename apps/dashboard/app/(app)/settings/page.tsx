import { PageHeader } from "@/components/ui";
import { SdkKeys } from "@/components/SdkKeys";
import { PublishableKeys } from "@/components/PublishableKeys";
import { getPublishableKeys, getSdkIngestKeys } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";
import { mintIngestKey, mintPublishableKey, revokeIngestKey, revokePublishableKey, updatePublishableKeyOrigins } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const tenantId = await getTenantId();
  const [keys, pubKeys] = await Promise.all([getSdkIngestKeys(tenantId), getPublishableKeys(tenantId)]);
  const apiUrl = (process.env.AGENTRONICS_API_PUBLIC_URL || "https://api.agentronics.dev").replace(/\/$/, "");

  return (
    <>
      <PageHeader title="Settings" subtitle="Keys for the SDK and the Agentronics API" />

      <div style={{ marginBottom: 18 }}>
        <PublishableKeys
          keys={pubKeys.map((k) => ({ ...k, allowedOrigins: (k.allowedOrigins as string[]) ?? [] }))}
          apiUrl={apiUrl}
          mint={mintPublishableKey}
          updateOrigins={updatePublishableKeyOrigins}
          revoke={revokePublishableKey}
        />
      </div>

      <div style={{ marginBottom: 18 }}>
        <SdkKeys keys={keys} mint={mintIngestKey} revoke={revokeIngestKey} />
      </div>

    </>
  );
}
