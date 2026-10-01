// Plan catalog for billing. Prices + MAA limits mirror
// landing_page/lib/catalog.ts and landing_page/docs/plan-entitlements.md —
// change all three together. All prices are in US dollars (USD only).

export type Tier = "free" | "pro" | "business" | "enterprise";
export type PaidTier = "pro" | "business";
export type Cycle = "monthly" | "yearly";
export type Currency = "USD";

export const PAID_TIERS: PaidTier[] = ["pro", "business"];
export const CYCLES: Cycle[] = ["monthly", "yearly"];
export const CURRENCIES: Currency[] = ["USD"];

export interface TierInfo {
  name: string;
  /** Monthly active agents included; null = custom. */
  maa: number | null;
  /** USD prices; null = free or custom. */
  prices: Record<Cycle, number> | null;
}

export const TIERS: Record<Tier, TierInfo> = {
  free: { name: "Free", maa: 1_000, prices: null },
  pro: {
    name: "Pro",
    maa: 10_000,
    prices: { monthly: 25, yearly: 250 }
  },
  business: {
    name: "Business",
    maa: 50_000,
    prices: { monthly: 99, yearly: 990 }
  },
  enterprise: { name: "Enterprise", maa: null, prices: null }
};

/** Razorpay subscription statuses that keep a paid plan in force. */
export const LIVE_STATUSES = ["active", "authenticated", "pending"] as const;

export const isPaidTier = (v: unknown): v is PaidTier => v === "pro" || v === "business";
export const isCycle = (v: unknown): v is Cycle => v === "monthly" || v === "yearly";
export const isCurrency = (v: unknown): v is Currency => v === "USD";

/** Env var holding the Razorpay plan id, e.g. RAZORPAY_PLAN_PRO_MONTHLY_USD. */
export const planEnvKey = (tier: PaidTier, cycle: Cycle, currency: Currency) =>
  `RAZORPAY_PLAN_${tier.toUpperCase()}_${cycle.toUpperCase()}_${currency}`;

/** Billing cycles to authorise up front (Razorpay requires a total_count). */
export const totalCount = (cycle: Cycle) => (cycle === "monthly" ? 120 : 10);

export function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(amount);
}
