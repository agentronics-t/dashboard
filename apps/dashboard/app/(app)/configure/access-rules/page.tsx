import { PageHeader } from "@/components/ui";
import { RulesBuilder } from "@/components/configure/RulesBuilder";
import { currentPlan } from "@/lib/billing/service";
import { getAgentDirectory } from "@/lib/console";
import { db, getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function AccessRulesPage() {
  const tenantId = await getTenantId();
  const [plan, agents] = await Promise.all([currentPlan(db(), tenantId), getAgentDirectory(tenantId, 7, 500)]);
  return (
    <>
      <PageHeader title="Access rules" subtitle="Decide which agents get in. Human visitors are never affected." />
      <RulesBuilder
        listsAllowed={plan.tier !== "free"}
        agents={agents.map((a) => ({ identity: a.identity, name: a.name, verified: a.verified, requests: a.requests }))}
      />
    </>
  );
}
