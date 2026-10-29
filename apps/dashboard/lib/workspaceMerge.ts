// Teams are gone: a workspace belongs to one person (tenants.clerk_org_id =
// "user:<id>"). Someone who worked inside a team workspace (a Clerk
// organization) before that keeps their work: the first time they show up with
// that organization active, its data moves into their personal workspace and
// the old tenant is retired (clerk_org_id "merged:<org id>"), so this runs once.
//
// Rows that would collide with what the personal workspace already has (the
// same repo, website, tool, day…) stay with the retired tenant; the personal
// workspace's own rows win. The better of the two plans is kept.
import "server-only";
import { eq, sql } from "drizzle-orm";
import { PLAN_IDS, resolvePlan } from "@agentronics/intel-schema";
import { schema } from "@agentronics/intel-schema/db";
import { db } from "./tenant";

/** Tenant tables and the columns (besides tenant_id) that must stay unique per tenant. */
const TABLES: [table: string, unique: string[]][] = [
  ["connectors", ["type"]],
  ["jobs", []],
  ["agent_traffic_daily", ["date", "source", "agent_name"]],
  ["forecasts", ["metric", "horizon_date"]],
  ["insights", []],
  ["billing_usage", ["period"]],
  ["sdk_ingest_keys", []],
  ["sdk_publishable_keys", []],
  ["sdk_events", []],
  ["sdk_event_daily", ["date", "type", "agent_class", "outcome"]],
  ["sdk_tool_registry", ["site_id", "tool_name"]],
  ["sdk_policies", ["site_id", "tool"]],
  ["sdk_tool_descriptions", ["site_id", "tool_name"]],
  ["sdk_site_memory", ["site_id"]],
  ["sdk_forecasts", ["metric", "horizon_date"]],
  ["sdk_insights", ["kind"]],
  ["billing_subscriptions", []],
  ["agent_keys", []],
  ["github_installations", ["installation_id"]],
  ["agent_nick_sites", ["repo_id"]],
  ["site_scans", []],
  ["tracked_sites", ["url"]]
];

function moveSql(table: string, unique: string[], from: string, into: string) {
  const t = sql.identifier(table);
  const clash = unique.length
    ? sql` and not exists (select 1 from ${t} x where x.tenant_id = ${into} and ${sql.join(
        unique.map((c) => sql`x.${sql.identifier(c)} is not distinct from ${t}.${sql.identifier(c)}`),
        sql` and `
      )})`
    : sql``;
  return sql`update ${t} set tenant_id = ${into} where tenant_id = ${from}${clash}`;
}

/** Move the organization's workspace into `personalTenantId`, once. */
export async function mergeOrgWorkspace(orgId: string, personalTenantId: string): Promise<void> {
  const [org] = await db().select({ id: schema.tenants.id, siteUrl: schema.tenants.siteUrl }).from(schema.tenants).where(eq(schema.tenants.clerkOrgId, orgId)).limit(1);
  if (!org || org.id === personalTenantId) return;
  const from = org.id;
  const into = personalTenantId;
  await db().transaction(async (tx) => {
    // Claim it first: a second request racing this one finds nothing to merge.
    const claimed = await tx
      .update(schema.tenants)
      .set({ clerkOrgId: `merged:${orgId}` })
      .where(eq(schema.tenants.clerkOrgId, orgId))
      .returning({ id: schema.tenants.id });
    if (!claimed.length) return;

    for (const [table, unique] of TABLES) await tx.execute(moveSql(table, unique, from, into));
    // Runs follow their repo: only those whose site moved (a repo both had keeps the personal one's history).
    await tx.execute(sql`update agent_nick_runs set tenant_id = ${into} where tenant_id = ${from} and site_id in (select id from agent_nick_sites where tenant_id = ${into})`);
    // Tracked websites pointing at a repo that stayed behind lose that link, not the website.
    await tx.execute(sql`update tracked_sites set agent_nick_site_id = null where tenant_id = ${into} and agent_nick_site_id in (select id from agent_nick_sites where tenant_id = ${from})`);
    await tx.execute(sql`update tenants set site_url = ${org.siteUrl} where id = ${into} and site_url is null`);

    // The plan: keep whichever workspace's is better (a paid, active plan beats Free).
    const plans = await tx.select().from(schema.workspacePlans).where(sql`${schema.workspacePlans.tenantId} in (${from}, ${into})`);
    const mine = plans.find((p) => p.tenantId === into);
    const theirs = plans.find((p) => p.tenantId === from);
    const rank = (p: typeof mine) => (p ? PLAN_IDS.indexOf(resolvePlan(p)) : -1);
    if (theirs && rank(theirs) > rank(mine)) {
      await tx.delete(schema.workspacePlans).where(eq(schema.workspacePlans.tenantId, into));
      await tx.update(schema.workspacePlans).set({ tenantId: into }).where(eq(schema.workspacePlans.tenantId, from));
    }
    // Webhook export: move it if the personal workspace has none.
    await tx.execute(sql`update sdk_webhooks set tenant_id = ${into} where tenant_id = ${from} and not exists (select 1 from sdk_webhooks where tenant_id = ${into})`);
  });
}
