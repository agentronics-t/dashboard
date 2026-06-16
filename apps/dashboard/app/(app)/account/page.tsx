import { AccountActions } from "@/components/AccountActions";
import { Card, CardTitle, fmt, Kpi, PageHeader } from "@/components/ui";
import { getConnectors, getUsage } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

async function getProfile() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return { name: "Demo workspace", email: "demo@agentronics.dev", clerk: false };
  }
  const { currentUser } = await import("@clerk/nextjs/server");
  const user = await currentUser();
  return {
    name: user?.fullName || user?.username || "—",
    email: user?.primaryEmailAddress?.emailAddress || "—",
    clerk: true
  };
}

export default async function AccountPage() {
  const tenantId = await getTenantId();
  const [usage, profile, connectors] = await Promise.all([
    getUsage(tenantId),
    getProfile(),
    getConnectors(tenantId)
  ]);
  const connected = connectors.filter((c) => c.secret_ref).length;

  return (
    <>
      <PageHeader title="Account" subtitle="Profile, plan, and usage" />

      <Card style={{ marginBottom: 18 }}>
        <CardTitle>Profile</CardTitle>
        <Row label="Name" value={profile.name} />
        <Row label="Email" value={profile.email} />
        <Row label="Tenant" value={tenantId} mono />
        <Row label="Auth" value={profile.clerk ? "Clerk" : "Demo (Clerk not configured)"} />
      </Card>

      <CardTitle>Plan &amp; usage</CardTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 4, marginBottom: 18 }}>
        <Kpi label="Plan" value="Free trial" sub="upgrade in billing" />
        <Kpi label="Governed calls" value={fmt(usage.governedCalls)} sub={`period ${usage.period}`} />
        <Kpi label="Connected plugins" value={String(connected)} sub={`${connectors.length} configured`} />
      </div>

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

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 4px", borderBottom: "1px solid var(--border)" }}>
      <span style={{ color: "var(--content-muted)", fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 500, fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)" }}>{value}</span>
    </div>
  );
}
