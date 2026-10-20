"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { generateIngestKey } from "@agentronics/intel-schema";
import { schema } from "@agentronics/intel-schema/db";
import { db, getTenantId, requireWorkspaceAdmin } from "@/lib/tenant";

/** Mint a new SDK ingest key. The raw key is returned exactly once. */
export async function mintIngestKey(label: string): Promise<{ id: string; key: string; prefix: string }> {
  await requireWorkspaceAdmin();
  const tenantId = await getTenantId();
  const { raw, hash, prefix } = generateIngestKey();
  const [row] = await db()
    .insert(schema.sdkIngestKeys)
    .values({ tenantId, hashedKey: hash, prefix, label: String(label ?? "").trim().slice(0, 80) || "default" })
    .returning({ id: schema.sdkIngestKeys.id });
  revalidatePath("/settings");
  return { id: row!.id, key: raw, prefix };
}

/** Revoke a key (tenant-scoped). */
export async function revokeIngestKey(id: string): Promise<void> {
  await requireWorkspaceAdmin();
  const tenantId = await getTenantId();
  await db()
    .update(schema.sdkIngestKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sdkIngestKeys.id, String(id)), eq(schema.sdkIngestKeys.tenantId, tenantId)));
  revalidatePath("/settings");
}
