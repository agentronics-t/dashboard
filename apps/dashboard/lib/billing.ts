// Workspace plans via Dodo Payments (merchant of record). Server only: the API
// key and webhook key never reach the browser. Plans and limits come from
// @agentronics/intel-schema (the same table agentronics.dev/pricing shows).
import "server-only";
import DodoPayments from "dodopayments";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { PLANS, monthStart, resolvePlan, type BillingInterval, type PaidPlanId, type PlanSpec } from "@agentronics/intel-schema";
import { schema } from "@agentronics/intel-schema/db";
import { db } from "./tenant";

export const PAID_PLANS: PlanSpec[] = [PLANS.starter, PLANS.pro];

/**
 * Subscription products in Dodo: monthly ($19 / $49) and yearly ($180 / $465,
 * 21% off). Test and live mode have different IDs, so they come from env.
 */
export function planProductId(plan: PaidPlanId, interval: BillingInterval = "month"): string | null {
  const ids: Record<BillingInterval, Record<PaidPlanId, string | undefined>> = {
    month: { starter: process.env.DODO_PRODUCT_STARTER, pro: process.env.DODO_PRODUCT_PRO },
    year: { starter: process.env.DODO_PRODUCT_STARTER_YEARLY, pro: process.env.DODO_PRODUCT_PRO_YEARLY }
  };
  return ids[interval][plan] || null;
}

/** Which plan and billing interval a Dodo product is. */
export function planFromProduct(productId: string): { plan: PaidPlanId; interval: BillingInterval } | null {
  for (const interval of ["month", "year"] as const)
    for (const plan of ["starter", "pro"] as const) if (planProductId(plan, interval) === productId) return { plan, interval };
  return null;
}

export const yearlyAvailable = () => !!planProductId("starter", "year") && !!planProductId("pro", "year");

/** test_mode unless explicitly live — a missing or misspelled variable can never charge real cards. */
const environment = (): "live_mode" | "test_mode" => (process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode");

export function dodo(): DodoPayments | null {
  const bearerToken = process.env.DODO_PAYMENTS_API_KEY;
  if (!bearerToken) return null;
  // The SDK's default (60 s, two retries) can outlast the page itself; fail fast instead.
  return new DodoPayments({ bearerToken, environment: environment(), webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY ?? null, timeout: 15_000, maxRetries: 1 });
}

export const billingConfigured = () => !!process.env.DODO_PAYMENTS_API_KEY && !!planProductId("starter") && !!planProductId("pro");

/** Map a Dodo subscription status onto ours (active | on_hold | cancelled | failed | expired | pending). */
export function planStatus(dodoStatus: string): string {
  if (dodoStatus === "active") return "active";
  if (["on_hold", "cancelled", "failed", "expired", "pending"].includes(dodoStatus)) return dodoStatus;
  return "pending";
}

export interface ScheduledPlan {
  plan: PaidPlanId;
  interval: BillingInterval;
  /** ISO date the switch happens (the next billing date). */
  at: string;
}

/** A plan switch waiting for the next billing date, read live from Dodo (null if none or unknown). */
export async function getScheduledPlan(subscriptionId: string | null | undefined): Promise<ScheduledPlan | null> {
  const client = dodo();
  if (!client || !subscriptionId) return null;
  try {
    // Only a note on the Account page: never hold the page up for it.
    const sub = await client.subscriptions.retrieve(subscriptionId, { timeout: 3_000, maxRetries: 0 });
    const change = sub.scheduled_change;
    const target = change ? planFromProduct(change.product_id) : null;
    return change && target ? { ...target, at: change.effective_at } : null;
  } catch {
    return null;
  }
}

/** The workspace's effective plan (Free unless a paid subscription is active) and its billing row. */
export async function getWorkspacePlan(tenantId: string) {
  const [row] = await db().select().from(schema.workspacePlans).where(eq(schema.workspacePlans.tenantId, tenantId));
  return { spec: PLANS[resolvePlan(row)], row: row ?? null };
}

/** Month-to-date usage against the plan's metered limits. */
export async function getPlanUsage(tenantId: string) {
  const month = monthStart();
  const [[requests], [runs], [sites]] = await Promise.all([
    db()
      .select({ n: sql<number>`coalesce(sum(${schema.sdkEventDaily.count}), 0)::bigint` })
      .from(schema.sdkEventDaily)
      .where(and(eq(schema.sdkEventDaily.tenantId, tenantId), gte(schema.sdkEventDaily.date, month.date))),
    db()
      .select({ n: count() })
      .from(schema.agentNickRuns)
      .where(and(eq(schema.agentNickRuns.tenantId, tenantId), gte(schema.agentNickRuns.createdAt, month.at))),
    db().select({ n: count() }).from(schema.agentNickSites).where(eq(schema.agentNickSites.tenantId, tenantId))
  ]);
  return { requests: Number(requests?.n ?? 0), runs: runs?.n ?? 0, sites: sites?.n ?? 0, since: month.date };
}
