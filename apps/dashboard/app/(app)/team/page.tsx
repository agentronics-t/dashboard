import { Card, CardTitle, PageHeader } from "@/components/ui";
import { TeamManager } from "@/components/TeamManager";
import { getWorkspacePlan } from "@/lib/billing";
import { seatUsage } from "@/lib/seats";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const tenantId = await getTenantId();
  const { spec } = await getWorkspacePlan(tenantId);
  const clerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const orgId = clerk ? (await (await import("@clerk/nextjs/server")).auth()).orgId : null;
  const { used, limit } = await seatUsage(orgId, spec.id);
  const full = limit !== null && used >= limit;

  return (
    <>
      <PageHeader title="Team" subtitle="Invite teammates to a shared workspace. Each plan includes a number of seats." />
      <Card style={{ marginBottom: 18 }}>
        <CardTitle>Seats</CardTitle>
        <p style={{ margin: 0, fontSize: 14, color: "var(--content-secondary)" }}>
          <strong style={{ color: "var(--content)" }}>
            {used} of {limit === null ? "unlimited" : limit}
          </strong>{" "}
          seat{limit === 1 ? "" : "s"} used on {spec.name}.{" "}
          {!orgId
            ? "This is your personal workspace. Create a team to invite people."
            : full
              ? "Every seat is taken. Upgrade on Account to invite more people."
              : "Invite people from the members list below."}
        </p>
      </Card>
      <Card>
        {clerk ? <TeamManager inTeam={!!orgId} /> : <p className="ag-muted" style={{ margin: 0 }}>Teams need Clerk, which isn&apos;t configured on this console.</p>}
      </Card>
    </>
  );
}
