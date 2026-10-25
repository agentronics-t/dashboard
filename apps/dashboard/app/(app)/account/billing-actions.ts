"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { isPaidPlanId } from "@agentronics/intel-schema";
import { schema } from "@agentronics/intel-schema/db";
import { eq } from "drizzle-orm";
import { dodo, getWorkspacePlan, planProductId } from "@/lib/billing";
import { db, getTenantId, requireWorkspaceAdmin } from "@/lib/tenant";

export type BillingResult = { ok: true; url?: string } | { ok: false; error: string };

async function origin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/** Only same-site paths may be returned to after checkout. */
const safeNext = (next: string | null | undefined) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/account");

/**
 * Move the workspace to a paid plan. New subscribers go through Dodo checkout;
 * an existing subscription is switched in place (prorated).
 */
export async function choosePlan(plan: string, next?: string): Promise<BillingResult> {
  try {
    await requireWorkspaceAdmin();
    if (!isPaidPlanId(plan)) return { ok: false, error: "Unknown plan." };
    const client = dodo();
    const productId = planProductId(plan);
    if (!client || !productId) return { ok: false, error: "Payments aren't set up on this console yet." };
    const tenantId = await getTenantId();
    const { spec, row } = await getWorkspacePlan(tenantId);

    if (row?.dodoSubscriptionId && spec.id !== "free") {
      if (spec.id === plan) return { ok: false, error: `You're already on ${spec.name}.` };
      await client.subscriptions.changePlan(row.dodoSubscriptionId, { product_id: productId, quantity: 1, proration_billing_mode: "prorated_immediately" });
      // The subscription.plan_changed webhook confirms it; reflect it now so limits update immediately.
      await db().update(schema.workspacePlans).set({ plan, updatedAt: new Date() }).where(eq(schema.workspacePlans.tenantId, tenantId));
      revalidatePath("/", "layout");
      return { ok: true };
    }

    const base = await origin();
    const session = await client.checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
      metadata: { tenant_id: tenantId, plan },
      return_url: `${base}/account/billing/return?next=${encodeURIComponent(safeNext(next))}`,
      cancel_url: `${base}${safeNext(next)}`,
      customization: { theme: "system" }
    });
    if (!session.checkout_url) return { ok: false, error: "Couldn't open the checkout page." };
    // Remember which checkout belongs to this workspace; confirmed on return or by webhook.
    await db()
      .insert(schema.workspacePlans)
      .values({ tenantId, plan, status: "pending", checkoutSessionId: session.session_id })
      .onConflictDoUpdate({ target: schema.workspacePlans.tenantId, set: { checkoutSessionId: session.session_id, updatedAt: new Date() } });
    return { ok: true, url: session.checkout_url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't change the plan." };
  }
}

/** Dodo's customer portal: invoices, payment method, cancel. */
export async function openBillingPortal(): Promise<BillingResult> {
  try {
    await requireWorkspaceAdmin();
    const client = dodo();
    const { row } = await getWorkspacePlan(await getTenantId());
    if (!client || !row?.dodoCustomerId) return { ok: false, error: "No billing account yet." };
    const session = await client.customers.customerPortal.create(row.dodoCustomerId, { return_url: `${await origin()}/account` });
    return { ok: true, url: session.link };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't open billing." };
  }
}
