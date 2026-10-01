"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { generateIngestKey } from "@agentronics/intel-schema";
import { schema } from "@agentronics/intel-schema/db";
import { db, getTenantId, requireWorkspaceAdmin } from "@/lib/tenant";

const PATH = "/configure/api-keys";

/** Mint a new ingest key (agtx_ik_…). The raw key is returned exactly once. */
export async function mintIngestKey(label: string): Promise<{ id: string; key: string; prefix: string }> {
  await requireWorkspaceAdmin();
  const tenantId = await getTenantId();
  const { raw, hash, prefix } = generateIngestKey();
  const [row] = await db()
    .insert(schema.sdkIngestKeys)
    .values({ tenantId, hashedKey: hash, prefix, label: String(label ?? "").trim().slice(0, 80) || "default" })
    .returning({ id: schema.sdkIngestKeys.id });
  revalidatePath(PATH);
  return { id: row!.id, key: raw, prefix };
}

export async function revokeIngestKey(id: string): Promise<void> {
  await requireWorkspaceAdmin();
  const tenantId = await getTenantId();
  await db()
    .update(schema.sdkIngestKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sdkIngestKeys.id, String(id)), eq(schema.sdkIngestKeys.tenantId, tenantId)));
  revalidatePath(PATH);
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

/**
 * Mint an agent API key (agk_ + 32 random bytes, base64url — the same format
 * as generateAgentKey() in @agentronics/sdk/server). Only the SHA-256 is kept.
 */
export async function mintAgentKey(input: { name: string; vendor?: string }): Promise<{ key: string; agentId: string }> {
  await requireWorkspaceAdmin();
  const tenantId = await getTenantId();
  const name = String(input?.name ?? "").trim().slice(0, 80);
  if (!name) throw new Error("Give the agent a name.");
  const vendor = String(input?.vendor ?? "").trim().slice(0, 80) || null;
  const agentId = slug(name) || `agent-${randomBytes(3).toString("hex")}`;
  const key = "agk_" + randomBytes(32).toString("base64url");
  const hashedKey = createHash("sha256").update(key).digest("hex");
  await db().insert(schema.agentKeys).values({ tenantId, agentId, name, vendor, hashedKey, prefix: key.slice(0, 10) });
  revalidatePath(PATH);
  return { key, agentId };
}

export async function revokeAgentKey(id: string): Promise<void> {
  await requireWorkspaceAdmin();
  const tenantId = await getTenantId();
  await db()
    .update(schema.agentKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.agentKeys.id, String(id)), eq(schema.agentKeys.tenantId, tenantId)));
  revalidatePath(PATH);
}
