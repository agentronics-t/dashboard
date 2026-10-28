"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { isBillingInterval, isPaidPlanId, type BillingInterval } from "@agentronics/intel-schema";
import { schema } from "@agentronics/intel-schema/db";
import { dodo, getScheduledPlan, getWorkspacePlan, planProductId } from "@/lib/billing";
import { db, getTenantId, requireWorkspaceAdmin } from "@/lib/tenant";

export type BillingResult = { ok: true; url?: string; scheduledFor?: string } | { ok: false; error: string };

async function origin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/** Only same-site paths may be returned to after checkout. */
const safeNext = (next: string | null | undefined) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/account");

/**
 * Move the workspace to a paid plan, billed monthly or yearly. New subscribers
 * pay in Dodo checkout. An existing subscription switches on its next billing
 * date: the workspace keeps its current plan until then, Dodo charges the new
 * price at that renewal, and the switch only happens if that payment succeeds
 * (on_payment_failure: prevent_change). The plan here changes when Dodo's
 * webhook reports it, never before.
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
      try {
        await client.subscriptions.changePlan(row.dodoSubscriptionId, {
          product_id: productId,
          quantity: 1,
          proration_billing_mode: "full_immediately",
          effective_at: "next_billing_date",
          on_payment_failure: "prevent_change",
          // Picking another plan replaces a switch that's already scheduled.
          cancel_scheduled_change_plan: true
        });
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 409) return { ok: false, error: "A payment on your subscription is still being processed. Try again once it clears, or check Invoices & payment method." };
        throw err;
      }
      revalidatePath("/account");
      const scheduled = await getScheduledPlan(row.dodoSubscriptionId);
      return { ok: true, scheduledFor: scheduled?.at ?? row.currentPeriodEnd?.toISOString() };
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

/** Drop a plan switch that's waiting for the next billing date. */
export async function cancelPlanChange(): Promise<BillingResult> {
  try {
    await requireWorkspaceAdmin();
    const client = dodo();
    const { row } = await getWorkspacePlan(await getTenantId());
    if (!client || !row?.dodoSubscriptionId) return { ok: false, error: "No subscription to change." };
    await client.subscriptions.cancelChangePlan(row.dodoSubscriptionId);
    revalidatePath("/account");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't cancel the switch." };
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
