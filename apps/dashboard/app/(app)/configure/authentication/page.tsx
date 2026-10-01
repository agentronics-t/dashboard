import { PageHeader } from "@/components/ui";
import { AuthConfigurator } from "@/components/configure/AuthConfigurator";
import { currentPlan } from "@/lib/billing/service";
import { getAuthSummary } from "@/lib/console";
import { db, getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function AuthenticationPage() {
  const tenantId = await getTenantId();
  const [plan, summary] = await Promise.all([currentPlan(db(), tenantId), getAuthSummary(tenantId, 30)]);
  const usage = Object.fromEntries(summary.byMethod.map((m) => [m.method, { verified: m.verified, failed: m.failed }]));
  return (
    <>
      <PageHeader title="Authentication" subtitle="How agents prove who they are on your sites" />
      <AuthConfigurator tier={plan.tier} usage={usage} />
    </>
  );
}
