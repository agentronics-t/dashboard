import { PageHeader } from "@/components/ui";
import { SdkKeys } from "@/components/SdkKeys";
import { PublishableKeys } from "@/components/PublishableKeys";
import { WebhookExport } from "@/components/WebhookExport";
import { eq } from "drizzle-orm";
import { upgradeFor } from "@agentronics/intel-schema";
import { schema } from "@agentronics/intel-schema/db";
import { getWorkspacePlan } from "@/lib/billing";
import { getPublishableKeys, getSdkIngestKeys } from "@/lib/queries";
import { db, getTenantId } from "@/lib/tenant";
import {
  deleteWebhook,
  mintIngestKey,
  mintPublishableKey,
  revealWebhookSecret,
  revokeIngestKey,
  revokePublishableKey,
  rotateWebhookSecret,
  saveWebhook,
  sendTestWebhook,
  updatePublishableKeyOrigins
} from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const tenantId = await getTenantId();
  const [keys, pubKeys, { spec: plan }, [hook]] = await Promise.all([
    getSdkIngestKeys(tenantId),
    getPublishableKeys(tenantId),
    getWorkspacePlan(tenantId),
    db()
      .select({
        url: schema.sdkWebhooks.url,
        enabled: schema.sdkWebhooks.enabled,
        failures: schema.sdkWebhooks.failures,
        lastStatus: schema.sdkWebhooks.lastStatus,
        lastDeliveryAt: schema.sdkWebhooks.lastDeliveryAt
      })
      .from(schema.sdkWebhooks)
      .where(eq(schema.sdkWebhooks.tenantId, tenantId))
  ]);
  const webhooksFrom = upgradeFor((p) => p.features.webhookExport);
  const apiUrl = (process.env.AGENTRONICS_API_PUBLIC_URL || "https://api.agentronics.dev").replace(/\/$/, "");

  return (
    <>
      <PageHeader title="Settings" subtitle="Keys for the SDK and the Agentronics API, and webhooks" />

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

      <div style={{ marginBottom: 18 }}>
        <WebhookExport
          included={plan.features.webhookExport}
          lockedNote={`Webhooks aren't included in the ${plan.name} plan.${webhooksFrom ? ` They come with ${webhooksFrom.name}.` : ""}`}
          hook={hook ?? null}
          save={saveWebhook}
          remove={deleteWebhook}
          reveal={revealWebhookSecret}
          rotate={rotateWebhookSecret}
          test={sendTestWebhook}
        />
      </div>

    </>
  );
}
