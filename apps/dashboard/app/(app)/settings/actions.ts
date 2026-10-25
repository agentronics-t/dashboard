"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { generateIngestKey, generatePublishableKey, normaliseOrigin } from "@agentronics/intel-schema";
import { schema } from "@agentronics/intel-schema/db";
import { generateWebhookSecret, postWebhook, webhookUrlProblem } from "@agentronics/intel-schema/webhooks";
import { getWorkspacePlan } from "@/lib/billing";
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

// ---- webhook export (Pro+) -------------------------------------------------

async function webhookWorkspace(): Promise<string> {
  await requireWorkspaceAdmin();
  const tenantId = await getTenantId();
  const { spec } = await getWorkspacePlan(tenantId);
  if (!spec.features.webhookExport) throw new Error(`Webhooks aren't included in the ${spec.name} plan.`);
  return tenantId;
}

/**
 * Point webhook export at a URL. Saving also switches a paused endpoint back
 * on. Delivery starts with events from now; the secret is kept across edits.
 */
export async function saveWebhook(rawUrl: string): Promise<{ error?: string }> {
  const tenantId = await webhookWorkspace();
  const url = String(rawUrl ?? "").trim();
  // Returned, not thrown: production hides thrown server-action messages.
  const problem = webhookUrlProblem(url);
  if (problem) return { error: problem };
  const at = new Date();
  await db()
    .insert(schema.sdkWebhooks)
    .values({ tenantId, url, secret: generateWebhookSecret(), cursorAt: at, nextAttemptAt: at })
    .onConflictDoUpdate({
      target: schema.sdkWebhooks.tenantId,
      set: { url, enabled: true, failures: 0, nextAttemptAt: at, lastStatus: null }
    });
  revalidatePath("/settings");
  return {};
}

export async function deleteWebhook(): Promise<void> {
  const tenantId = await webhookWorkspace();
  await db().delete(schema.sdkWebhooks).where(eq(schema.sdkWebhooks.tenantId, tenantId));
  revalidatePath("/settings");
}

/** The signing secret, for admins only (it's needed to verify deliveries). */
export async function revealWebhookSecret(): Promise<string> {
  const tenantId = await webhookWorkspace();
  const [row] = await db().select({ secret: schema.sdkWebhooks.secret }).from(schema.sdkWebhooks).where(eq(schema.sdkWebhooks.tenantId, tenantId));
  if (!row) throw new Error("Add an endpoint first.");
  return row.secret;
}

export async function rotateWebhookSecret(): Promise<string> {
  const tenantId = await webhookWorkspace();
  const secret = generateWebhookSecret();
  await db().update(schema.sdkWebhooks).set({ secret }).where(eq(schema.sdkWebhooks.tenantId, tenantId));
  return secret;
}

/** Send one signed `webhook.test` delivery now and report what came back. */
export async function sendTestWebhook(): Promise<{ ok: boolean; status: string }> {
  const tenantId = await webhookWorkspace();
  const [row] = await db().select().from(schema.sdkWebhooks).where(eq(schema.sdkWebhooks.tenantId, tenantId));
  if (!row) throw new Error("Add an endpoint first.");
  const id = `msg_test_${Date.now()}`;
  const body = JSON.stringify({ type: "webhook.test", timestamp: new Date().toISOString(), data: { message: "Agentronics webhook test" } });
  return postWebhook(row.url, row.secret, id, body);
}
