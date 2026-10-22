// Workspace plans via Dodo Payments (merchant of record). Server only: the API
// key and webhook key never reach the browser. Prices mirror agentronics.dev/pricing.
import "server-only";
import DodoPayments from "dodopayments";

export type PlanId = "lite" | "starter" | "team";

export const PLANS: { id: PlanId; name: string; price: number; tools: string; blurb: string }[] = [
  { id: "lite", name: "Lite", price: 29, tools: "Up to 10 WebMCP tools", blurb: "Make one site agent-ready." },
  { id: "starter", name: "Starter", price: 89, tools: "Unlimited WebMCP tools", blurb: "Serve and govern agents on your site." },
  { id: "team", name: "Team", price: 199, tools: "Unlimited tools · 10 seats", blurb: "Full governance for growing agent traffic." }
];

/** Monthly subscription product ids created in the Dodo dashboard. */
export function planProductId(plan: PlanId): string | null {
  const ids: Record<PlanId, string | undefined> = {
    lite: process.env.DODO_PRODUCT_LITE,
    starter: process.env.DODO_PRODUCT_STARTER,
    team: process.env.DODO_PRODUCT_TEAM
  };
  return ids[plan] || null;
}

export const isPlanId = (v: unknown): v is PlanId => v === "lite" || v === "starter" || v === "team";

/** test_mode unless explicitly live — a missing or misspelled variable can never charge real cards. */
const environment = (): "live_mode" | "test_mode" => (process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode");

export function dodo(): DodoPayments | null {
  const bearerToken = process.env.DODO_PAYMENTS_API_KEY;
  if (!bearerToken) return null;
  return new DodoPayments({ bearerToken, environment: environment(), webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY ?? null });
}

export const billingConfigured = () => !!process.env.DODO_PAYMENTS_API_KEY && PLANS.every((p) => planProductId(p.id));

/** Map a Dodo subscription status onto ours (active | on_hold | cancelled | failed | expired | pending). */
export function planStatus(dodoStatus: string): string {
  if (dodoStatus === "active") return "active";
  if (["on_hold", "cancelled", "failed", "expired", "pending"].includes(dodoStatus)) return dodoStatus;
  return "pending";
}

export function planFromProduct(productId: string): PlanId | null {
  return PLANS.find((p) => planProductId(p.id) === productId)?.id ?? null;
}
