import { eq, or } from "drizzle-orm";
import { schema } from "@agentronics/intel-schema/db";
import { isPaidPlanId } from "@agentronics/intel-schema";
import { dodo, planFromProduct, planStatus } from "@/lib/billing";
import { db } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dodo Payments webhooks — the source of truth for workspace plans. The
 * signature is verified over the raw body before anything is trusted; Dodo
 * retries any non-2xx response.
 */
export async function POST(req: Request) {
  const client = dodo();
  if (!client || !process.env.DODO_PAYMENTS_WEBHOOK_KEY) return Response.json({ error: "webhooks_not_configured" }, { status: 503 });

  const raw = await req.text();
  let event: ReturnType<typeof client.webhooks.unwrap>;
  try {
    event = client.webhooks.unwrap(raw, {
      headers: {
        "webhook-id": req.headers.get("webhook-id") ?? "",
        "webhook-signature": req.headers.get("webhook-signature") ?? "",
        "webhook-timestamp": req.headers.get("webhook-timestamp") ?? ""
      }
    });
  } catch {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  if (!event.type.startsWith("subscription.")) return Response.json({ ok: true, ignored: event.type });
  const sub = event.data as {
    subscription_id: string;
    status: string;
    product_id: string;
    next_billing_date?: string | null;
    metadata?: Record<string, string>;
    customer?: { customer_id?: string };
  };
  const tenantId = sub.metadata?.tenant_id;
  const plan = planFromProduct(sub.product_id) ?? (isPaidPlanId(sub.metadata?.plan) ? sub.metadata.plan : null);
  const values = {
    status: planStatus(sub.status),
    dodoSubscriptionId: sub.subscription_id,
    dodoCustomerId: sub.customer?.customer_id ?? null,
    currentPeriodEnd: sub.next_billing_date ? new Date(sub.next_billing_date) : null,
    updatedAt: new Date(),
    ...(plan ? { plan } : {})
  };

  const updated = await db()
    .update(schema.workspacePlans)
    .set(values)
    .where(
      tenantId
        ? or(eq(schema.workspacePlans.dodoSubscriptionId, sub.subscription_id), eq(schema.workspacePlans.tenantId, tenantId))
        : eq(schema.workspacePlans.dodoSubscriptionId, sub.subscription_id)
    )
    .returning({ tenantId: schema.workspacePlans.tenantId });
  if (!updated.length && tenantId && plan) {
    await db().insert(schema.workspacePlans).values({ tenantId, plan, ...values }).onConflictDoNothing();
  }
  return Response.json({ ok: true });
}
