import { PageHeader } from "@/components/ui";
import { SdkKeys } from "@/components/SdkKeys";
import { AgentKeys } from "@/components/configure/AgentKeys";
import { getAgentKeys } from "@/lib/console";
import { getSdkIngestKeys } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";
import { mintAgentKey, mintIngestKey, revokeAgentKey, revokeIngestKey } from "./actions";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const tenantId = await getTenantId();
  const [ingestKeys, agentKeys] = await Promise.all([getSdkIngestKeys(tenantId), getAgentKeys(tenantId)]);

  const env = Object.fromEntries(
    agentKeys
      .filter((k) => !k.revokedAt)
      .map((k) => [k.hashedKey, { agentId: k.agentId, name: k.name, ...(k.vendor ? { vendor: k.vendor } : {}) }])
  );
  const apiBase = process.env.INTEL_API_URL?.replace(/\/$/, "");

  return (
    <>
      <PageHeader title="API keys" subtitle="Credentials for your agents and for streaming auth logs" />
      <div style={{ display: "grid", gap: 18 }}>
        <AgentKeys
          keys={agentKeys.map(({ hashedKey: _h, ...k }) => k)}
          agentKeysEnv={JSON.stringify(env)}
          mint={mintAgentKey}
          revoke={revokeAgentKey}
        />
        <SdkKeys
          keys={ingestKeys}
          mint={mintIngestKey}
          revoke={revokeIngestKey}
          ingestUrl={apiBase ? `POST ${apiBase}/v1/sdk/events` : "POST /v1/sdk/events"}
        />
      </div>
    </>
  );
}
