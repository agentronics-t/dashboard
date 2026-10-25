"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { generateIngestKey, generatePublishableKey, normaliseOrigin } from "@agentronics/intel-schema";
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

const origins = (raw: string): string[] => {
  const list = String(raw ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((o) => normaliseOrigin(o));
  if (list.some((o) => o === null)) throw new Error("Origins look like https://shop.example — one per line or comma-separated.");
  return [...new Set(list as string[])].slice(0, 20);
};

/**
 * Mint a publishable key (agtx_pk_…) for the browser SDK. Public by design;
 * `allowedOrigins` are the sites that may send traces / tool registries with it.
 */
export async function mintPublishableKey(input: { label: string; origins: string }): Promise<{ key: string }> {
  await requireWorkspaceAdmin();
  const tenantId = await getTenantId();
  const key = generatePublishableKey();
  await db()
    .insert(schema.sdkPublishableKeys)
    .values({ tenantId, key, label: String(input?.label ?? "").trim().slice(0, 80) || "default", allowedOrigins: origins(input?.origins) });
  revalidatePath("/settings");
  return { key };
}

export async function updatePublishableKeyOrigins(id: string, raw: string): Promise<void> {
  await requireWorkspaceAdmin();
  const tenantId = await getTenantId();
  await db()
    .update(schema.sdkPublishableKeys)
    .set({ allowedOrigins: origins(raw) })
    .where(and(eq(schema.sdkPublishableKeys.id, String(id)), eq(schema.sdkPublishableKeys.tenantId, tenantId)));
  revalidatePath("/settings");
}

export async function revokePublishableKey(id: string): Promise<void> {
  await requireWorkspaceAdmin();
  const tenantId = await getTenantId();
  await db()
    .update(schema.sdkPublishableKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sdkPublishableKeys.id, String(id)), eq(schema.sdkPublishableKeys.tenantId, tenantId)));
  revalidatePath("/settings");
}
