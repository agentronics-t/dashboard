import { AccountActions } from "@/components/AccountActions";
import { ManageBillingButton, PlanChooser } from "@/components/PlanChooser";
import { Card, CardTitle, PageHeader, fmt } from "@/components/ui";
import { billingConfigured, getPlanUsage, getWorkspacePlan, yearlyAvailable } from "@/lib/billing";
import { planCards } from "@/lib/planCards";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

async function getProfile() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return { name: "Demo user", email: "demo@agentronics.dev", workspace: "Demo workspace" };
  }
  const { auth, currentUser } = await import("@clerk/nextjs/server");
  const [user, { orgId, orgSlug }] = await Promise.all([currentUser(), auth()]);
  return {
    name: user?.fullName || user?.username || "—",
    email: user?.primaryEmailAddress?.emailAddress || "—",
    // An organization's workspace is shared with its members; otherwise it's yours alone.
    workspace: orgSlug ? `Team (${orgSlug})` : orgId ? "Team" : "Personal"
  };
}

const PLAN_NOTE: Record<string, string> = {
  active: "Payment received — your new plan is active.",
  pending: "Your payment is still being confirmed. Your plan switches as soon as it clears.",
  failed: "That payment didn't go through. Nothing was charged.",
  unknown: "We couldn't confirm the payment yet. If you completed checkout, it will show up here shortly."
};

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tenantId = await getTenantId();
  const [profile, { spec, row }, usage] = await Promise.all([getProfile(), getWorkspacePlan(tenantId), getPlanUsage(tenantId)]);
  const l = spec.limits;
  const renews = spec.id !== "free" && row?.currentPeriodEnd ? row.currentPeriodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

  return (
    <>
      <PageHeader title="Account" subtitle="Profile, plan, and usage" />

      {sp.plan && PLAN_NOTE[sp.plan] && (
        <Card style={{ marginBottom: 18, borderColor: sp.plan === "active" ? "var(--success)" : "var(--warning)", background: sp.plan === "active" ? "var(--success-bg)" : "var(--warning-bg)" }}>
          {PLAN_NOTE[sp.plan]}
        </Card>
      )}

      <Card style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--content-muted)" }}>Current plan</div>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 4 }}>
              {spec.name}
              <span className="ag-muted" style={{ fontSize: 14, fontWeight: 600, marginLeft: 8 }}>
                {spec.priceUsd === null
                  ? "custom"
                  : spec.priceUsd === 0
                    ? "free"
                    : row?.billingInterval === "year"
                      ? `$${spec.priceUsdYearly}/yr`
                      : `$${spec.priceUsd}/mo`}
              </span>
            </div>
            {renews && <div className="ag-muted" style={{ fontSize: 12.5, marginTop: 2 }}>Renews {renews}</div>}
            {row && row.status !== "active" && row.status !== "pending" && (
              <div style={{ fontSize: 12.5, marginTop: 2, color: "var(--warning)" }}>Your subscription is {row.status.replace("_", " ")} — you&apos;re on Free until it&apos;s active again.</div>
            )}
          </div>
          {row?.dodoCustomerId && <ManageBillingButton />}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          <Meter label="Agent requests recorded" used={usage.requests} limit={l.requestsPerMonth} sub="this month · agents are never blocked" />
          <Meter label="Agent Nic runs" used={usage.runs} limit={l.agentNickRunsPerMonth} sub="this month" />
          <Meter label="Agent Nic sites" used={usage.sites} limit={l.agentNickSites} sub="connected repositories" />
          <Meter label="History kept" text={l.retentionDays === null ? "Custom" : `${l.retentionDays} days`} sub="raw events" />
        </div>
      </Card>

      <Card style={{ marginBottom: 18 }}>
        <CardTitle>Plans</CardTitle>
        <PlanChooser
          plans={planCards()}
          current={spec.id}
          currentInterval={row?.billingInterval === "year" ? "year" : "month"}
          next="/account"
          billingReady={billingConfigured()}
          yearlyReady={yearlyAvailable()}
        />
      </Card>

      <Card style={{ marginBottom: 18 }}>
        <CardTitle>Profile</CardTitle>
        <Row label="Name" value={profile.name} />
        <Row label="Email" value={profile.email} />
        <Row label="Workspace" value={profile.workspace} />
      </Card>

      <Card>
        <CardTitle>Session</CardTitle>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 14, color: "var(--content-secondary)" }}>Sign out of this device.</span>
          <AccountActions />
        </div>
      </Card>
    </>
  );
}

function Meter({ label, used, limit, text, sub }: { label: string; used?: number; limit?: number | null; text?: string; sub: string }) {
  const pct = used !== undefined && limit ? Math.min(100, Math.round((used / limit) * 100)) : null;
  const tone = pct === null ? "var(--brand)" : pct >= 100 ? "var(--danger)" : pct >= 80 ? "var(--warning)" : "var(--brand)";
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--content-muted)" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 6 }}>
        {text ?? (
          <>
            {fmt(used ?? 0)}
            <span className="ag-muted" style={{ fontSize: 13, fontWeight: 600 }}> / {limit === null || limit === undefined ? "unlimited" : fmt(limit)}</span>
          </>
        )}
      </div>
      {pct !== null && (
        <div style={{ height: 6, borderRadius: 999, background: "var(--surface-raised)", marginTop: 8, overflow: "hidden" }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
          <div style={{ width: `${pct}%`, height: "100%", background: tone }} />
        </div>
      )}
      <div className="ag-muted" style={{ fontSize: 12, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 4px", borderBottom: "1px solid var(--border)" }}>
      <span style={{ color: "var(--content-muted)", fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 500, fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)" }}>{value}</span>
    </div>
  );
}
