import { limitLabel, upgradeFor } from "@agentronics/intel-schema";
import { Card, CardTitle, Kpi, PageHeader, fmt } from "@/components/ui";
import { BarList, EventFeed } from "@/components/sdk";
import { PolicyEditor, type PolicyRow } from "@/components/pillars/PolicyEditor";
import { LiveRefresh } from "@/components/LiveRefresh";
import { getWorkspacePlan } from "@/lib/billing";
import { getDecisionStats, getPolicies, getTools } from "@/lib/pillars";
import { getSdkRecentEvents } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function AuthzPage() {
  const tenantId = await getTenantId();
  const [policies, tools, decisions, events, { spec: plan }] = await Promise.all([
    getPolicies(tenantId),
    getTools(tenantId),
    getDecisionStats(tenantId, 30),
    getSdkRecentEvents(tenantId, { types: ["authz.evaluated", "authz.policies_set"], limit: 60 }),
    getWorkspacePlan(tenantId)
  ]);

  const max = plan.limits.authzPolicies;
  const next = upgradeFor((p) => p.limits.authzPolicies === null || p.limits.authzPolicies > 0);
  const locked = max === 0 ? `Authorization rules aren't included in the ${plan.name} plan.${next ? ` ${next.name} includes ${limitLabel(next.limits.authzPolicies)}.` : ""}` : null;
  const reviewed = decisions.approved + decisions.refused;
  const total = decisions.allowed + decisions.denied + reviewed;

  const rules: PolicyRow[] = policies.map((p) => ({
    id: p.id,
    siteId: p.siteId,
    tool: p.tool,
    decision: p.decision as PolicyRow["decision"],
    minTrust: p.minTrust as PolicyRow["minTrust"],
    allowedClasses: (p.allowedClasses as string[]) ?? [],
    rateLimit: (p.rateLimit as PolicyRow["rateLimit"]) ?? null
  }));

  return (
    <>
      <PageHeader title="Authz" subtitle="Who may call each WebMCP tool — allow, deny, or ask the person first" action={<LiveRefresh />} />

      <div className="ag-grid-kpi">
        <Kpi label="Decisions" value={fmt(total)} sub="tool calls checked, 30d" />
        <Kpi label="Allowed" value={fmt(decisions.allowed)} sub="ran straight away" />
        <Kpi label="Reviewed" value={fmt(reviewed)} sub={`${fmt(decisions.approved)} approved · ${fmt(decisions.refused)} refused`} />
        <Kpi label="Denied" value={fmt(decisions.denied)} sub="tool not callable for that agent" />
      </div>

      <Card style={{ marginBottom: 18 }}>
        <CardTitle>Rules</CardTitle>
        <PolicyEditor
          rules={rules}
          tools={[...new Set(tools.map((t) => t.toolName))].sort()}
          sites={[...new Set(tools.map((t) => t.siteId))].sort()}
          limit={limitLabel(max)}
          used={rules.length}
          locked={locked}
          rateLimitsIncluded={plan.features.rateLimits}
        />
      </Card>

      {total > 0 && (
        <Card style={{ marginBottom: 18 }}>
          <CardTitle>Decisions</CardTitle>
          <BarList
            items={[
              { label: "allowed", value: decisions.allowed, color: "var(--success)" },
              { label: "approved", value: decisions.approved, color: "var(--data-3)" },
              { label: "refused", value: decisions.refused, color: "var(--warning)" },
              { label: "denied", value: decisions.denied, color: "var(--danger)" }
            ]}
          />
        </Card>
      )}

      <Card>
        <CardTitle>Recent decisions</CardTitle>
        {events.length ? <EventFeed events={events} /> : <div className="ag-muted" style={{ fontSize: 13 }}>No decisions yet.</div>}
      </Card>
    </>
  );
}
