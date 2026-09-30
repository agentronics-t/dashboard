import { Badge, Card, CardTitle, PageHeader } from "@/components/ui";
import { CancelPlanButton, PlanPicker } from "@/components/billing/PlanPicker";
import { TIERS, isCurrency, isCycle, isPaidTier } from "@/lib/billing/plans";
import { billingConfigFromEnv, currentPlan } from "@/lib/billing/service";
import { getMonthlyActiveAgents } from "@/lib/queries";
import { db, getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<string, { label: string; kind: string }> = {
  active: { label: "Active", kind: "succeeded" },
  authenticated: { label: "Active", kind: "succeeded" },
  pending: { label: "Payment retrying", kind: "warning" }
};

export default async function BillingPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tenantId = await getTenantId();
  const [plan, maa] = await Promise.all([currentPlan(db(), tenantId), getMonthlyActiveAgents(tenantId)]);
  const tier = TIERS[plan.tier];
  const limit = tier.maa;
  const pct = limit ? Math.min(100, Math.round((maa / limit) * 100)) : 0;
  const enabled = !!billingConfigFromEnv() && !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const now = new Date();
  const resets = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const periodEnd = plan.currentPeriodEnd?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const status = plan.status ? STATUS_COPY[plan.status] : null;

  return (
    <>
      <PageHeader title="Billing" subtitle="Your plan, agent usage and payments" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 16 }}>
        <Card>
          <CardTitle>Current plan</CardTitle>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em" }}>{tier.name}</span>
            {status && <Badge kind={status.kind}>{status.label}</Badge>}
            {plan.cancelAtCycleEnd && <Badge kind="warning">Cancels at period end</Badge>}
          </div>
          <p style={{ margin: "8px 0 14px", fontSize: 14, color: "var(--content-secondary)" }}>
            {plan.tier === "free"
              ? "Free forever — upgrade when agents become a real share of your traffic."
              : plan.cancelAtCycleEnd
                ? `Ends on ${periodEnd ?? "the last day of this period"}; you'll move to Free after that.`
                : `Billed ${plan.cycle} in ${plan.currency}. ${periodEnd ? `Renews ${periodEnd}.` : ""}`}
          </p>
          {plan.tier !== "free" && !plan.cancelAtCycleEnd && <CancelPlanButton />}
        </Card>

        <Card>
          <CardTitle>Monthly active agents</CardTitle>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em" }}>
            {maa.toLocaleString("en-US")}
            <span style={{ fontSize: 14, fontWeight: 500, color: "var(--content-muted)" }}>
              {" "}/ {limit ? limit.toLocaleString("en-US") : "custom"}
            </span>
          </div>
          {limit && (
            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{ marginTop: 10, height: 8, borderRadius: 999, background: "var(--surface-raised)", overflow: "hidden" }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: pct >= 100 ? "var(--danger)" : pct >= 80 ? "var(--accent)" : "var(--brand-solid)"
                }}
              />
            </div>
          )}
          <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--content-muted)" }}>
            Unique agents that authenticated this month · resets{" "}
            {resets.toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Human visitors are always free.
            {pct >= 80 && limit ? " You're close to your plan's limit — agents keep working, but consider upgrading." : ""}
          </p>
        </Card>
      </div>

      <Card>
        <CardTitle>Plans</CardTitle>
        <PlanPicker
          current={plan.tier}
          enabled={enabled}
          initial={{
            plan: isPaidTier(sp.plan) ? sp.plan : null,
            cycle: isCycle(sp.cycle) ? sp.cycle : "monthly",
            currency: isCurrency(sp.currency) ? sp.currency : "USD"
          }}
        />
        <p style={{ margin: "14px 0 0", fontSize: 12, color: "var(--content-muted)" }}>
          Payments are processed by Razorpay; receipts and invoices are emailed after each charge. Prices exclude applicable
          taxes.
        </p>
      </Card>
    </>
  );
}
