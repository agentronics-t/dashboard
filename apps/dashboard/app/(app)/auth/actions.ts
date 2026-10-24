"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { upgradeFor } from "@agentronics/intel-schema";
import { schema } from "@agentronics/intel-schema/db";
import { getWorkspacePlan } from "@/lib/billing";
import { db, getTenantId, requireWorkspaceAdmin } from "@/lib/tenant";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

/**
 * Mint an agent API key (agk_ + 32 random bytes, base64url — the same format
 * as generateAgentKey() in @agentronics/sdk/server). Only the SHA-256 is kept.
 * The plan caps active keys (Free 3, Starter 25, Pro unlimited).
 */
export async function mintAgentKey(input: { name: string; vendor?: string }): Promise<{ key: string; agentId: string }> {
  await requireWorkspaceAdmin();
  const tenantId = await getTenantId();
  const name = String(input?.name ?? "").trim().slice(0, 80);
  if (!name) throw new Error("Give the agent a name.");

  const { spec } = await getWorkspacePlan(tenantId);
  const max = spec.limits.agentApiKeys;
  if (max !== null) {
    const [row] = await db()
      .select({ n: sql<number>`count(*)` })
      .from(schema.agentKeys)
      .where(and(eq(schema.agentKeys.tenantId, tenantId), isNull(schema.agentKeys.revokedAt)));
    if (Number(row?.n ?? 0) >= max) {
      const next = upgradeFor((p) => p.limits.agentApiKeys === null || p.limits.agentApiKeys > max);
      throw new Error(`Your ${spec.name} plan includes ${max} active agent keys. Revoke one${next ? `, or upgrade to ${next.name}` : ""}.`);
    }
  }

  const vendor = String(input?.vendor ?? "").trim().slice(0, 80) || null;
  const agentId = slug(name) || `agent-${randomBytes(3).toString("hex")}`;
  const key = "agk_" + randomBytes(32).toString("base64url");
  const hashedKey = createHash("sha256").update(key).digest("hex");
  await db().insert(schema.agentKeys).values({ tenantId, agentId, name, vendor, hashedKey, prefix: key.slice(0, 10) });
  revalidatePath("/auth");
  return { key, agentId };
}

export async function revokeAgentKey(id: string): Promise<void> {
  await requireWorkspaceAdmin();
  const tenantId = await getTenantId();
  await db()
    .update(schema.agentKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.agentKeys.id, String(id)), eq(schema.agentKeys.tenantId, tenantId)));
  revalidatePath("/auth");
}
