import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { isPaidPlanId } from "@agentronics/intel-schema";
import { schema } from "@agentronics/intel-schema/db";
import { dodo, planStatus } from "@/lib/billing";
import { db, getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Dodo sends the buyer back here. The query string is only a hint: we look up
 * the payment and subscription with Dodo, and only accept a checkout this
 * workspace started, before turning the plan on. The webhook confirms it too.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const nextParam = url.searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/account";
  const dest = (state: string) => NextResponse.redirect(`${url.origin}${next}${next.includes("?") ? "&" : "?"}plan=${state}`);

  const client = dodo();
  const tenantId = await getTenantId();
  const [row] = await db().select().from(schema.workspacePlans).where(eq(schema.workspacePlans.tenantId, tenantId));
  const sessionId = url.searchParams.get("session_id") ?? row?.checkoutSessionId ?? null;
  if (!client || !row || !sessionId || sessionId !== row.checkoutSessionId) return dest("unknown");

  try {
    const session = await client.checkoutSessions.retrieve(sessionId);
    if (session.payment_status !== "succeeded" || !session.payment_id) return dest(session.payment_status ?? "pending");
    const payment = await client.payments.retrieve(session.payment_id);
    const plan = payment.metadata?.plan;
    if (payment.metadata?.tenant_id !== tenantId || !isPaidPlanId(plan)) return dest("unknown");
    const subscriptionId = payment.subscription_ids?.[0] ?? null;
    const sub = subscriptionId ? await client.subscriptions.retrieve(subscriptionId) : null;
    await db()
      .update(schema.workspacePlans)
      .set({
        plan,
        status: sub ? planStatus(sub.status) : "active",
        dodoSubscriptionId: subscriptionId,
        dodoCustomerId: payment.customer?.customer_id ?? null,
        currentPeriodEnd: sub?.next_billing_date ? new Date(sub.next_billing_date) : null,
        checkoutSessionId: null,
        updatedAt: new Date()
      })
      .where(eq(schema.workspacePlans.tenantId, tenantId));
    return dest("active");
  } catch {
    return dest("unknown");
  }
}
