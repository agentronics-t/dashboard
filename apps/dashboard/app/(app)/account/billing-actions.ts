"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { isBillingInterval, isPaidPlanId, type BillingInterval } from "@agentronics/intel-schema";
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
 * Move the workspace to a paid plan, billed monthly or yearly. New subscribers
 * go through Dodo checkout; an existing subscription is switched in place
 * (prorated), including monthly ↔ yearly.
 */
export async function choosePlan(plan: string, interval: string = "month", next?: string): Promise<BillingResult> {
  try {
    await requireWorkspaceAdmin();
    if (!isPaidPlanId(plan)) return { ok: false, error: "Unknown plan." };
    const billing: BillingInterval = isBillingInterval(interval) ? interval : "month";
    const client = dodo();
    const productId = planProductId(plan, billing);
    if (!client || !productId) return { ok: false, error: billing === "year" ? "Yearly billing isn't set up on this console yet." : "Payments aren't set up on this console yet." };
    const tenantId = await getTenantId();
    const { spec, row } = await getWorkspacePlan(tenantId);

    if (row?.dodoSubscriptionId && spec.id !== "free") {
      if (spec.id === plan && row.billingInterval === billing) return { ok: false, error: `You're already on ${spec.name}${billing === "year" ? ", billed yearly" : ""}.` };
      await client.subscriptions.changePlan(row.dodoSubscriptionId, { product_id: productId, quantity: 1, proration_billing_mode: "prorated_immediately" });
      // The subscription.plan_changed webhook confirms it; reflect it now so limits update immediately.
      await db().update(schema.workspacePlans).set({ plan, billingInterval: billing, updatedAt: new Date() }).where(eq(schema.workspacePlans.tenantId, tenantId));
      revalidatePath("/", "layout");
      return { ok: true };
    }

    const base = await origin();
    const session = await client.checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
      metadata: { tenant_id: tenantId, plan, interval: billing },
      return_url: `${base}/account/billing/return?next=${encodeURIComponent(safeNext(next))}`,
      cancel_url: `${base}${safeNext(next)}`,
      customization: { theme: "system" }
    });
    if (!session.checkout_url) return { ok: false, error: "Couldn't open the checkout page." };
    // Remember which checkout belongs to this workspace; confirmed on return or by webhook.
    await db()
      .insert(schema.workspacePlans)
      .values({ tenantId, plan, billingInterval: billing, status: "pending", checkoutSessionId: session.session_id })
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
