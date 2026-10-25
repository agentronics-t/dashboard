// The workspace's plan, for enforcing Agent Nic limits server-side.
import { and, count, eq, gte, ne } from "drizzle-orm";
import { PLANS, monthStart, resolvePlan, upgradeFor, type PlanSpec } from "@agentronics/intel-schema";
import { schema, type Db } from "@agentronics/intel-schema/db";

export async function tenantPlan(db: Db, tenantId: string): Promise<PlanSpec> {
  const [row] = await db.select().from(schema.workspacePlans).where(eq(schema.workspacePlans.tenantId, tenantId));
  return PLANS[resolvePlan(row)];
}

export async function runsThisMonth(db: Db, tenantId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(schema.agentNickRuns)
    .where(and(eq(schema.agentNickRuns.tenantId, tenantId), gte(schema.agentNickRuns.createdAt, monthStart().at)));
  return r?.n ?? 0;
}

export async function siteCount(db: Db, tenantId: string, exceptRepoId?: number): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(schema.agentNickSites)
    .where(and(eq(schema.agentNickSites.tenantId, tenantId), ...(exceptRepoId ? [ne(schema.agentNickSites.repoId, exceptRepoId)] : [])));
  return r?.n ?? 0;
}

/** 402 body for a limit, naming the cheapest plan that lifts it. */
export function limitError(message: string, ok: (p: PlanSpec) => boolean) {
  const up = upgradeFor(ok);
  return { error: "plan_limit", message: up ? `${message} Upgrade to ${up.name} for more.` : message, upgradeTo: up?.id ?? null };
}
