// Billing service — Razorpay Subscriptions ↔ billing_subscriptions (Neon).
// Pure of Next/Clerk so it runs under `node --test` against a scratch DB; the
// route handlers resolve the tenant + user and inject db, client and config.

import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@agentronics/intel-schema/db";
import {
  LIVE_STATUSES,
  TIERS,
  isCurrency,
  isCycle,
  isPaidTier,
  planEnvKey,
  totalCount,
  type Currency,
  type Cycle,
  type PaidTier,
  type Tier
} from "./plans.ts";
import {
  RazorpayError,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  type RazorpayClient,
  type RazorpaySubscription
} from "./razorpay.ts";

export interface BillingConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  /** Razorpay plan ids keyed by planEnvKey(). */
  planIds: Record<string, string | undefined>;
}

export class BillingError extends Error {
  readonly status: number;
  readonly code: string;
  // explicit fields: the repo runs tests with node strip-types (no parameter properties)
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export interface CurrentPlan {
  tier: Tier;
  status: string | null;
  cycle: Cycle | null;
  currency: Currency | null;
  currentPeriodEnd: Date | null;
  cancelAtCycleEnd: boolean;
  razorpaySubscriptionId: string | null;
}

const toDate = (unix: number | null | undefined) => (unix ? new Date(unix * 1000) : null);

/** The plan in force for a tenant: newest subscription in a live status, else Free. */
export async function currentPlan(db: Db, tenantId: string): Promise<CurrentPlan> {
  const [row] = await db
    .select()
    .from(schema.billingSubscriptions)
    .where(
      and(
        eq(schema.billingSubscriptions.tenantId, tenantId),
        inArray(schema.billingSubscriptions.status, [...LIVE_STATUSES])
      )
    )
    .orderBy(desc(schema.billingSubscriptions.createdAt))
    .limit(1);
  if (!row || !isPaidTier(row.plan)) {
    return { tier: "free", status: null, cycle: null, currency: null, currentPeriodEnd: null, cancelAtCycleEnd: false, razorpaySubscriptionId: null };
  }
  return {
    tier: row.plan,
    status: row.status,
    cycle: isCycle(row.cycle) ? row.cycle : null,
    currency: isCurrency(row.currency) ? row.currency : null,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtCycleEnd: row.cancelAtCycleEnd,
    razorpaySubscriptionId: row.razorpaySubscriptionId
  };
}

/** Create a Razorpay subscription for the tenant and record it (status "created"). */
export async function startCheckout(
  deps: { db: Db; rzp: RazorpayClient; config: BillingConfig },
  tenantId: string,
  userId: string,
  input: { plan: unknown; cycle: unknown; currency: unknown }
): Promise<{ subscriptionId: string; keyId: string; amount: number; currency: Currency; planName: string }> {
  const { db, rzp, config } = deps;
  const { plan, cycle, currency } = input;
  if (!isPaidTier(plan) || !isCycle(cycle) || !isCurrency(currency)) {
    throw new BillingError(400, "invalid_plan");
  }
  const live = await currentPlan(db, tenantId);
  if (live.tier !== "free") {
    throw new BillingError(409, "already_subscribed", `already on ${TIERS[live.tier].name}; cancel before switching`);
  }
  const razorpayPlanId = config.planIds[planEnvKey(plan, cycle, currency)];
  if (!razorpayPlanId) throw new BillingError(503, "plan_not_configured", planEnvKey(plan, cycle, currency));

  let sub: RazorpaySubscription;
  try {
    sub = await rzp.createSubscription({
      plan_id: razorpayPlanId,
      total_count: totalCount(cycle),
      // An unpaid checkout should not linger for 30 years (Razorpay default).
      expire_by: Math.floor(Date.now() / 1000) + 2 * 3600,
      notes: { tenant_id: tenantId, plan, cycle, currency }
    });
  } catch (e) {
    throw new BillingError(502, "razorpay_error", e instanceof RazorpayError ? e.code : "create_failed");
  }
  await db.insert(schema.billingSubscriptions).values({
    tenantId,
    razorpaySubscriptionId: sub.id,
    razorpayPlanId,
    plan,
    cycle,
    currency,
    status: sub.status,
    // status_at stays null: only webhook timestamps (Razorpay's clock) order state
    createdBy: userId
  });
  return {
    subscriptionId: sub.id,
    keyId: config.keyId,
    amount: TIERS[plan].prices![currency][cycle],
    currency,
    planName: TIERS[plan].name
  };
}

/**
 * Checkout success callback. Verifies the signature against the subscription
 * WE stored for this tenant, then re-reads the subscription from Razorpay —
 * the browser's word alone never changes a plan.
 */
export async function confirmCheckout(
  deps: { db: Db; rzp: RazorpayClient; config: BillingConfig },
  tenantId: string,
  body: { razorpay_payment_id?: unknown; razorpay_subscription_id?: unknown; razorpay_signature?: unknown }
): Promise<{ status: string; tier: PaidTier }> {
  const { db, rzp, config } = deps;
  const paymentId = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
  const subId = typeof body.razorpay_subscription_id === "string" ? body.razorpay_subscription_id : "";
  const signature = typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";

  const [row] = await db
    .select()
    .from(schema.billingSubscriptions)
    .where(
      and(
        eq(schema.billingSubscriptions.razorpaySubscriptionId, subId),
        eq(schema.billingSubscriptions.tenantId, tenantId)
      )
    );
  if (!row || !isPaidTier(row.plan)) throw new BillingError(404, "subscription_not_found");
  if (!verifyCheckoutSignature(config.keySecret, paymentId, row.razorpaySubscriptionId, signature)) {
    throw new BillingError(400, "invalid_signature");
  }
  const sub = await rzp.fetchSubscription(row.razorpaySubscriptionId);
  // Fresh state straight from Razorpay. status_at is left to webhooks so all
  // ordering comparisons use Razorpay's clock, not ours.
  await db
    .update(schema.billingSubscriptions)
    .set({ status: sub.status, currentPeriodEnd: toDate(sub.current_end), updatedAt: new Date() })
    .where(eq(schema.billingSubscriptions.id, row.id));
  return { status: sub.status, tier: row.plan };
}

export type WebhookOutcome = "applied" | "duplicate" | "ignored" | "stale" | "unknown_subscription";

/**
 * Apply one Razorpay webhook delivery. Verifies the raw-body signature first,
 * dedupes on x-razorpay-event-id, and only applies an event newer than the
 * state we already hold (deliveries can arrive out of order).
 */
export async function applyWebhook(
  deps: { db: Db; config: BillingConfig },
  rawBody: string,
  signature: string | null,
  eventIdHeader: string | null
): Promise<WebhookOutcome> {
  const { db, config } = deps;
  if (!verifyWebhookSignature(config.webhookSecret, rawBody, signature)) {
    throw new BillingError(400, "invalid_webhook_signature");
  }
  let body: {
    event?: string;
    created_at?: number;
    payload?: { subscription?: { entity?: RazorpaySubscription } };
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new BillingError(400, "invalid_json");
  }
  const event = typeof body.event === "string" ? body.event : "";
  const entity = body.payload?.subscription?.entity;
  if (!event.startsWith("subscription.") || !entity?.id) return "ignored";

  const eventId = eventIdHeader ?? `${event}:${entity.id}:${body.created_at ?? ""}`;
  const inserted = await db
    .insert(schema.billingEvents)
    .values({ eventId, event, razorpaySubscriptionId: entity.id })
    .onConflictDoNothing()
    .returning({ eventId: schema.billingEvents.eventId });
  if (inserted.length === 0) return "duplicate";

  const [row] = await db
    .select()
    .from(schema.billingSubscriptions)
    .where(eq(schema.billingSubscriptions.razorpaySubscriptionId, entity.id));
  if (!row) return "unknown_subscription"; // not created by us — never trust notes to attach it

  const eventAt = toDate(body.created_at) ?? new Date();
  if (row.statusAt && eventAt < row.statusAt) return "stale";

  await db
    .update(schema.billingSubscriptions)
    .set({
      status: entity.status,
      statusAt: eventAt,
      currentPeriodEnd: toDate(entity.current_end) ?? row.currentPeriodEnd,
      updatedAt: new Date()
    })
    .where(eq(schema.billingSubscriptions.id, row.id));
  return "applied";
}

/** Cancel the live subscription at the end of the paid period. */
export async function cancelAtCycleEnd(
  deps: { db: Db; rzp: RazorpayClient },
  tenantId: string
): Promise<CurrentPlan> {
  const { db, rzp } = deps;
  const live = await currentPlan(db, tenantId);
  if (live.tier === "free" || !live.razorpaySubscriptionId) throw new BillingError(404, "no_active_subscription");
  await rzp.cancelSubscription(live.razorpaySubscriptionId, true);
  await db
    .update(schema.billingSubscriptions)
    .set({ cancelAtCycleEnd: true, updatedAt: new Date() })
    .where(eq(schema.billingSubscriptions.razorpaySubscriptionId, live.razorpaySubscriptionId));
  return { ...live, cancelAtCycleEnd: true };
}

/** Config from process env (route handlers). Missing keys → billing disabled. */
export function billingConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BillingConfig | null {
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!keyId || !keySecret || !webhookSecret) return null;
  const planIds: Record<string, string | undefined> = {};
  for (const tier of ["pro", "business"] as const)
    for (const cycle of ["monthly", "yearly"] as const)
      for (const currency of ["USD", "INR"] as const) {
        const k = planEnvKey(tier, cycle, currency);
        planIds[k] = env[k];
      }
  return { keyId, keySecret, webhookSecret, planIds };
}
