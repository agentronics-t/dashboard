// Plans and their limits — the one source of truth for the console, the
// agent-nick service and intel-api. agentronics.dev/pricing mirrors this table
// (landing_page/components/sections/Pricing); change both together.
//
// Limits never block agents on a customer's site: at a limit the SDK keeps
// verifying and serving tools, and only recording / console features stop.

export const PLAN_IDS = ["free", "starter", "pro", "enterprise"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type PaidPlanId = "starter" | "pro";
export type BillingInterval = "month" | "year";
export const isBillingInterval = (v: unknown): v is BillingInterval => v === "month" || v === "year";

/** How an Agent Nic tool reaches its action (see agent-nick ToolProposal.strategy). */
export type ToolStrategy = "form" | "dom" | "fetch" | "server_action";

export interface PlanSpec {
  id: PlanId;
  name: string;
  /** USD per month; null = custom (contact sales). */
  priceUsd: number | null;
  /** USD per year when billed yearly (21% off twelve months); null = custom. */
  priceUsdYearly: number | null;
  tagline: string;
  limits: {
    /** null = unlimited (or set per contract). */
    agentNickSites: number | null;
    agentNickRunsPerMonth: number | null;
    agentNickToolsPerSite: number | null;
    agentNickStrategies: ToolStrategy[];
    agentNickAutoCiFix: boolean;
    agentNickRescanAlerts: boolean;
    /** SDK events recorded per calendar month (UTC). */
    requestsPerMonth: number | null;
    /** Raw event retention; null = per contract (defaults to 365). */
    retentionDays: number | null;
    agentApiKeys: number | null;
    /** 0 = authorization not included. */
    authzPolicies: number | null;
    /** Team members who can sign in to the console ("seats"). */
    seats: number | null;
  };
  features: {
    toolGroups: boolean;
    signatureUpdates: "monthly" | "weekly" | "live";
    webBotAuthAndOAuth: boolean;
    advancedAuth: boolean;
    customIdentityProvider: boolean;
    rateLimits: boolean;
    domEnforcement: boolean;
    toolAccessEnforced: boolean;
    siteMemory: boolean;
    webhookExport: boolean;
    auditAndTraceExport: boolean;
    consoleSso: boolean;
    support: string;
  };
}

const NO = false;
const YES = true;

export const PLANS: Record<PlanId, PlanSpec> = {
  free: {
    id: "free",
    name: "Free",
    priceUsd: 0,
    priceUsdYearly: 0,
    tagline: "See your site through an agent's eyes.",
    limits: {
      agentNickSites: 1,
      agentNickRunsPerMonth: 1,
      agentNickToolsPerSite: 5,
      agentNickStrategies: ["form"],
      agentNickAutoCiFix: NO,
      agentNickRescanAlerts: NO,
      requestsPerMonth: 5_000,
      retentionDays: 7,
      agentApiKeys: 3,
      authzPolicies: 0,
      seats: 1
    },
    features: {
      toolGroups: NO,
      signatureUpdates: "monthly",
      webBotAuthAndOAuth: NO,
      advancedAuth: NO,
      customIdentityProvider: NO,
      rateLimits: NO,
      domEnforcement: NO,
      toolAccessEnforced: NO,
      siteMemory: NO,
      webhookExport: NO,
      auditAndTraceExport: NO,
      consoleSso: NO,
      support: "Community"
    }
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceUsd: 19,
    priceUsdYearly: 180,
    tagline: "Make your site agent-ready.",
    limits: {
      agentNickSites: 1,
      agentNickRunsPerMonth: 5,
      agentNickToolsPerSite: 15,
      agentNickStrategies: ["form", "dom", "fetch"],
      agentNickAutoCiFix: YES,
      agentNickRescanAlerts: YES,
      requestsPerMonth: 50_000,
      retentionDays: 30,
      agentApiKeys: 25,
      authzPolicies: 5,
      seats: 2
    },
    features: {
      toolGroups: YES,
      signatureUpdates: "weekly",
      webBotAuthAndOAuth: YES,
      advancedAuth: NO,
      customIdentityProvider: NO,
      rateLimits: NO,
      domEnforcement: NO,
      toolAccessEnforced: YES,
      siteMemory: YES,
      webhookExport: NO,
      auditAndTraceExport: NO,
      consoleSso: NO,
      support: "Email"
    }
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsd: 49,
    priceUsdYearly: 465,
    tagline: "Govern every agent across your sites.",
    limits: {
      agentNickSites: 3,
      agentNickRunsPerMonth: 30,
      agentNickToolsPerSite: null,
      agentNickStrategies: ["form", "dom", "fetch", "server_action"],
      agentNickAutoCiFix: YES,
      agentNickRescanAlerts: YES,
      requestsPerMonth: 250_000,
      retentionDays: 90,
      agentApiKeys: null,
      authzPolicies: null,
      seats: 5
    },
    features: {
      toolGroups: YES,
      signatureUpdates: "live",
      webBotAuthAndOAuth: YES,
      advancedAuth: YES,
      customIdentityProvider: NO,
      rateLimits: YES,
      domEnforcement: YES,
      toolAccessEnforced: YES,
      siteMemory: YES,
      webhookExport: YES,
      auditAndTraceExport: NO,
      consoleSso: NO,
      support: "Priority email"
    }
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    priceUsd: null,
    priceUsdYearly: null,
    tagline: "Custom limits, SSO and an SLA.",
    limits: {
      agentNickSites: null,
      agentNickRunsPerMonth: null,
      agentNickToolsPerSite: null,
      agentNickStrategies: ["form", "dom", "fetch", "server_action"],
      agentNickAutoCiFix: YES,
      agentNickRescanAlerts: YES,
      requestsPerMonth: null,
      retentionDays: null,
      agentApiKeys: null,
      authzPolicies: null,
      seats: null
    },
    features: {
      toolGroups: YES,
      signatureUpdates: "live",
      webBotAuthAndOAuth: YES,
      advancedAuth: YES,
      customIdentityProvider: YES,
      rateLimits: YES,
      domEnforcement: YES,
      toolAccessEnforced: YES,
      siteMemory: YES,
      webhookExport: YES,
      auditAndTraceExport: YES,
      consoleSso: YES,
      support: "Dedicated + Slack, SLA"
    }
  }
};

/** Retention for "per contract" plans until a contract sets one. */
export const DEFAULT_CONTRACT_RETENTION_DAYS = 365;

export const isPlanId = (v: unknown): v is PlanId => typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
export const isPaidPlanId = (v: unknown): v is PaidPlanId => v === "starter" || v === "pro";

/**
 * The plan a workspace is on, from its workspace_plans row: a paid plan only
 * while the subscription is active and inside its period; otherwise Free.
 */
export function resolvePlan(row: { plan: string; status: string; currentPeriodEnd: Date | null } | null | undefined, now = new Date()): PlanId {
  if (!row || row.status !== "active" || !isPlanId(row.plan)) return "free";
  if (row.currentPeriodEnd && row.currentPeriodEnd <= now) return "free";
  return row.plan;
}

/** The cheapest plan that allows `ok(plan)` — for "upgrade to …" hints. */
export function upgradeFor(ok: (p: PlanSpec) => boolean): PlanSpec | null {
  return PLAN_IDS.map((id) => PLANS[id]).find(ok) ?? null;
}

/** "unlimited" / formatted number, for UI copy. */
export const limitLabel = (n: number | null, unit = "") => (n === null ? "Unlimited" : `${n.toLocaleString("en-US")}${unit}`);

/** First day of the current UTC month (YYYY-MM-DD and Date). */
export function monthStart(now = new Date()): { date: string; at: Date } {
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { date: at.toISOString().slice(0, 10), at };
}
