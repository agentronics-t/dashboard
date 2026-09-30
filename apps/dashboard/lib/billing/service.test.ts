// Billing tests: real Postgres (DATABASE_URL — use a throwaway DB, never the
// serving Neon), fake Razorpay. Run: npm test (from apps/dashboard).

import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDb, schema } from "@agentronics/intel-schema/db";
import {
  applyWebhook,
  cancelAtCycleEnd,
  confirmCheckout,
  currentPlan,
  startCheckout,
  type BillingConfig
} from "./service.ts";
import { verifyCheckoutSignature, verifyWebhookSignature, type RazorpayClient, type RazorpaySubscription } from "./razorpay.ts";

const db = createDb();
const config: BillingConfig = {
  keyId: "rzp_test_key",
  keySecret: "test_key_secret",
  webhookSecret: "whsec_test",
  planIds: { RAZORPAY_PLAN_PRO_MONTHLY_USD: "plan_pro_m_usd", RAZORPAY_PLAN_BUSINESS_YEARLY_INR: "plan_biz_y_inr" }
};

class FakeRazorpay implements RazorpayClient {
  subs = new Map<string, RazorpaySubscription>();
  created: Array<{ plan_id: string; total_count: number; notes: Record<string, string> }> = [];
  fetched: string[] = [];
  cancelled: Array<[string, boolean]> = [];
  n = 0;
  async createSubscription(input: { plan_id: string; total_count: number; notes: Record<string, string> }) {
    this.created.push(input);
    const sub = { id: `sub_T${Date.now()}${this.n++}`, plan_id: input.plan_id, status: "created" };
    this.subs.set(sub.id, sub);
    return sub;
  }
  async fetchSubscription(id: string) {
    this.fetched.push(id);
    return { ...this.subs.get(id)!, status: "active", current_end: 1_900_000_000 };
  }
  async cancelSubscription(id: string, atCycleEnd: boolean) {
    this.cancelled.push([id, atCycleEnd]);
    return this.subs.get(id)!;
  }
}

let rzp: FakeRazorpay;
const tenants: string[] = [];
async function newTenant(): Promise<string> {
  const key = `test:billing:${randomUUID()}`;
  const [t] = await db.insert(schema.tenants).values({ name: key, clerkOrgId: key }).returning({ id: schema.tenants.id });
  tenants.push(t!.id);
  return t!.id;
}
const sign = (secret: string, msg: string) => createHmac("sha256", secret).update(msg).digest("hex");
const deps = () => ({ db, rzp, config });

before(() => assert.ok(process.env.DATABASE_URL, "set DATABASE_URL to a throwaway Postgres"));
beforeEach(() => {
  rzp = new FakeRazorpay();
});
after(async () => {
  if (tenants.length) await db.delete(schema.tenants).where(inArray(schema.tenants.id, tenants));
  process.exit(0);
});

// ---- signatures: known answers computed with openssl -------------------------

test("checkout signature matches openssl known answer", () => {
  const sig = "945d4db9fb1ee2774fad526e78a9f6b85b6d296385c522fd155fc92f6ee7bd69";
  assert.equal(verifyCheckoutSignature("test_key_secret", "pay_29QQoUBi66xm2f", "sub_00000000000001", sig), true);
  assert.equal(verifyCheckoutSignature("test_key_secret", "pay_29QQoUBi66xm2f", "sub_00000000000002", sig), false);
  assert.equal(verifyCheckoutSignature("wrong_secret", "pay_29QQoUBi66xm2f", "sub_00000000000001", sig), false);
  assert.equal(verifyCheckoutSignature("test_key_secret", "", "sub_00000000000001", sig), false);
});

test("webhook signature is over the raw body (openssl known answer)", () => {
  const raw = '{"event":"subscription.activated"}';
  const sig = "6c4e19e38460fae8f4601dac74f96160b0e87dcf18b54ff056a6581dd1b8e7ea";
  assert.equal(verifyWebhookSignature("whsec_test", raw, sig), true);
  // re-serialised JSON (different bytes) must NOT verify
  assert.equal(verifyWebhookSignature("whsec_test", '{"event": "subscription.activated"}', sig), false);
  assert.equal(verifyWebhookSignature("whsec_test", raw, null), false);
  assert.equal(verifyWebhookSignature("whsec_test", raw, sig.slice(0, -2)), false);
});

// ---- checkout -------------------------------------------------------------------

test("startCheckout rejects bad input and unconfigured plans", async () => {
  const t = await newTenant();
  await assert.rejects(startCheckout(deps(), t, "user_1", { plan: "free", cycle: "monthly", currency: "USD" }), { code: "invalid_plan" });
  await assert.rejects(startCheckout(deps(), t, "user_1", { plan: "pro", cycle: "weekly", currency: "USD" }), { code: "invalid_plan" });
  await assert.rejects(startCheckout(deps(), t, "user_1", { plan: "pro", cycle: "yearly", currency: "EUR" }), { code: "invalid_plan" });
  await assert.rejects(startCheckout(deps(), t, "user_1", { plan: "business", cycle: "monthly", currency: "USD" }), {
    code: "plan_not_configured"
  });
});

test("startCheckout creates a server-priced subscription and records it", async () => {
  const t = await newTenant();
  const out = await startCheckout(deps(), t, "user_1", { plan: "pro", cycle: "monthly", currency: "USD" });
  assert.equal(out.keyId, "rzp_test_key");
  assert.equal(out.amount, 25);
  assert.equal(rzp.created[0]!.plan_id, "plan_pro_m_usd"); // plan id chosen server-side
  assert.equal(rzp.created[0]!.total_count, 120);
  assert.equal(rzp.created[0]!.notes.tenant_id, t);
  const [row] = await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.tenantId, t));
  assert.equal(row!.status, "created");
  assert.equal((await currentPlan(db, t)).tier, "free", "a created (unpaid) subscription grants nothing");
});

test("confirmCheckout verifies against the STORED subscription and re-reads Razorpay", async () => {
  const t = await newTenant();
  const { subscriptionId } = await startCheckout(deps(), t, "u", { plan: "pro", cycle: "monthly", currency: "USD" });

  await assert.rejects(
    confirmCheckout(deps(), t, { razorpay_payment_id: "pay_1", razorpay_subscription_id: subscriptionId, razorpay_signature: "bad" }),
    { code: "invalid_signature" }
  );
  assert.equal((await currentPlan(db, t)).tier, "free");

  const out = await confirmCheckout(deps(), t, {
    razorpay_payment_id: "pay_1",
    razorpay_subscription_id: subscriptionId,
    razorpay_signature: sign(config.keySecret, `pay_1|${subscriptionId}`)
  });
  assert.deepEqual(out, { status: "active", tier: "pro" });
  assert.deepEqual(rzp.fetched, [subscriptionId]);
  const plan = await currentPlan(db, t);
  assert.equal(plan.tier, "pro");
  assert.equal(plan.currentPeriodEnd?.getTime(), 1_900_000_000_000);
});

test("a tenant cannot confirm another tenant's subscription", async () => {
  const a = await newTenant();
  const b = await newTenant();
  const { subscriptionId } = await startCheckout(deps(), a, "u", { plan: "pro", cycle: "monthly", currency: "USD" });
  await assert.rejects(
    confirmCheckout(deps(), b, {
      razorpay_payment_id: "pay_1",
      razorpay_subscription_id: subscriptionId,
      razorpay_signature: sign(config.keySecret, `pay_1|${subscriptionId}`)
    }),
    { code: "subscription_not_found" }
  );
  assert.equal((await currentPlan(db, b)).tier, "free");
});

test("a second checkout while subscribed is refused", async () => {
  const t = await newTenant();
  const { subscriptionId } = await startCheckout(deps(), t, "u", { plan: "pro", cycle: "monthly", currency: "USD" });
  await confirmCheckout(deps(), t, {
    razorpay_payment_id: "p",
    razorpay_subscription_id: subscriptionId,
    razorpay_signature: sign(config.keySecret, `p|${subscriptionId}`)
  });
  await assert.rejects(startCheckout(deps(), t, "u", { plan: "business", cycle: "yearly", currency: "INR" }), {
    code: "already_subscribed"
  });
});

// ---- webhooks ---------------------------------------------------------------------

function delivery(event: string, sub: Partial<RazorpaySubscription> & { id: string }, createdAt: number) {
  const raw = JSON.stringify({
    entity: "event",
    event,
    contains: ["subscription"],
    payload: { subscription: { entity: { plan_id: "plan_pro_m_usd", ...sub } } },
    created_at: createdAt
  });
  return { raw, sig: sign(config.webhookSecret, raw) };
}

test("webhooks: signature, idempotency, ordering, lifecycle", async () => {
  const t = await newTenant();
  const { subscriptionId: id } = await startCheckout(deps(), t, "u", { plan: "pro", cycle: "monthly", currency: "USD" });
  const d = { db, config };

  const act = delivery("subscription.activated", { id, status: "active", current_end: 1_800_000_000 }, 1_700_000_100);
  await assert.rejects(applyWebhook(d, act.raw, "forged", "evt_1"), { code: "invalid_webhook_signature" });
  assert.equal(await applyWebhook(d, act.raw, act.sig, "evt_1"), "applied");
  assert.equal((await currentPlan(db, t)).tier, "pro");
  assert.equal(await applyWebhook(d, act.raw, act.sig, "evt_1"), "duplicate");

  // an older event delivered late must not regress state
  const old = delivery("subscription.halted", { id, status: "halted" }, 1_700_000_050);
  assert.equal(await applyWebhook(d, old.raw, old.sig, "evt_0"), "stale");
  assert.equal((await currentPlan(db, t)).tier, "pro");

  // payment retry window keeps the plan; halted drops it
  const pend = delivery("subscription.pending", { id, status: "pending" }, 1_700_000_200);
  assert.equal(await applyWebhook(d, pend.raw, pend.sig, "evt_2"), "applied");
  assert.equal((await currentPlan(db, t)).tier, "pro");
  const halt = delivery("subscription.halted", { id, status: "halted" }, 1_700_000_300);
  assert.equal(await applyWebhook(d, halt.raw, halt.sig, "evt_3"), "applied");
  assert.equal((await currentPlan(db, t)).tier, "free");
});

test("webhooks ignore other events and subscriptions we did not create", async () => {
  const d = { db, config };
  const pay = { raw: JSON.stringify({ event: "payment.captured", payload: {} }), sig: "" };
  pay.sig = sign(config.webhookSecret, pay.raw);
  assert.equal(await applyWebhook(d, pay.raw, pay.sig, "evt_pay"), "ignored");
  // a real-looking delivery whose notes claim a tenant must still be ignored
  const t = await newTenant();
  const foreign = delivery("subscription.activated", { id: "sub_ForeignOne", status: "active", notes: { tenant_id: t } }, 1_700_000_000);
  assert.equal(await applyWebhook(d, foreign.raw, foreign.sig, `evt_${randomUUID()}`), "unknown_subscription");
  assert.equal((await currentPlan(db, t)).tier, "free");
});

test("cancelAtCycleEnd cancels at period end and keeps the plan until then", async () => {
  const t = await newTenant();
  const { subscriptionId } = await startCheckout(deps(), t, "u", { plan: "pro", cycle: "monthly", currency: "USD" });
  await confirmCheckout(deps(), t, {
    razorpay_payment_id: "p",
    razorpay_subscription_id: subscriptionId,
    razorpay_signature: sign(config.keySecret, `p|${subscriptionId}`)
  });
  const out = await cancelAtCycleEnd({ db, rzp }, t);
  assert.deepEqual(rzp.cancelled, [[subscriptionId, true]]);
  assert.equal(out.cancelAtCycleEnd, true);
  assert.equal((await currentPlan(db, t)).tier, "pro", "still Pro until the period ends");
  await assert.rejects(cancelAtCycleEnd({ db, rzp }, await newTenant()), { code: "no_active_subscription" });
});
