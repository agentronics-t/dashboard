"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { sdkPolicyInput, upgradeFor, type SdkPolicyInput } from "@agentronics/intel-schema";
import { schema } from "@agentronics/intel-schema/db";
import { getWorkspacePlan } from "@/lib/billing";
import { db, getTenantId, requireWorkspaceAdmin } from "@/lib/tenant";

/** Create or update an authorization rule (one per site·tool). Plan caps the number of rules. */
export async function savePolicy(raw: SdkPolicyInput): Promise<void> {
  await requireWorkspaceAdmin();
  const tenantId = await getTenantId();
  const p = sdkPolicyInput.parse(raw);

  const { spec } = await getWorkspacePlan(tenantId);
  const max = spec.limits.authzPolicies;
  if (!p.id && max !== null) {
    const [row] = await db()
      .select({ n: sql<number>`count(*)` })
      .from(schema.sdkPolicies)
      .where(eq(schema.sdkPolicies.tenantId, tenantId));
    if (Number(row?.n ?? 0) >= max) {
      const next = upgradeFor((pl) => pl.limits.authzPolicies === null || pl.limits.authzPolicies > max);
      throw new Error(
        max === 0
          ? `Authorization rules aren't included in the ${spec.name} plan${next ? ` — upgrade to ${next.name}` : ""}.`
          : `Your ${spec.name} plan includes ${max} rules${next ? `. Upgrade to ${next.name} for more` : ""}.`
      );
    }
  }

  // Per-agent rate limits are a Pro feature (intel-api also drops them from
  // lower plans' config, so a rule saved before a downgrade stops applying).
  if (p.rateLimit && !spec.features.rateLimits) {
    const next = upgradeFor((pl) => pl.features.rateLimits);
    throw new Error(`Per-agent rate limits aren't included in the ${spec.name} plan${next ? ` — upgrade to ${next.name}` : ""}.`);
  }

  const values = {
    siteId: p.siteId,
    tool: p.tool,
    decision: p.decision,
    minTrust: p.minTrust,
    allowedClasses: p.allowedClasses,
    rateLimit: p.rateLimit,
    updatedAt: new Date()
  };
  if (p.id) {
    await db()
      .update(schema.sdkPolicies)
      .set(values)
      .where(and(eq(schema.sdkPolicies.id, p.id), eq(schema.sdkPolicies.tenantId, tenantId)));
  } else {
    await db()
      .insert(schema.sdkPolicies)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: [schema.sdkPolicies.tenantId, schema.sdkPolicies.siteId, schema.sdkPolicies.tool], set: values });
  }
  revalidatePath("/authz");
}

export async function deletePolicy(id: string): Promise<void> {
  await requireWorkspaceAdmin();
  const tenantId = await getTenantId();
  await db()
    .delete(schema.sdkPolicies)
    .where(and(eq(schema.sdkPolicies.id, String(id)), eq(schema.sdkPolicies.tenantId, tenantId)));
  revalidatePath("/authz");
}
