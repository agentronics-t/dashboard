import { Card, PageHeader } from "@/components/ui";
import { AuthLogTable, ConsoleEmpty, FilterPills } from "@/components/console";
import { LiveRefresh } from "@/components/LiveRefresh";
import { getAuthLogs, type OutcomeFilter } from "@/lib/console";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const OUTCOMES: { label: string; value: OutcomeFilter }[] = [
  { label: "All", value: "all" },
  { label: "Verified", value: "success" },
  { label: "Unverified", value: "error" },
  { label: "Blocked", value: "blocked" }
];

export default async function LogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const outcome = (OUTCOMES.find((o) => o.value === sp.outcome)?.value ?? "all") as OutcomeFilter;
  const tenantId = await getTenantId();
  const rows = await getAuthLogs(tenantId, { outcome, limit: 300 });

  return (
    <>
      <PageHeader title="Auth logs" subtitle="Every agent sign-in and verification, newest first" action={<LiveRefresh />} />
      <div style={{ marginBottom: 12 }}>
        <FilterPills active={outcome} options={OUTCOMES.map((o) => ({ ...o, href: `/logs?outcome=${o.value}` }))} />
      </div>
      {rows.length === 0 ? (
        <ConsoleEmpty title={outcome === "all" ? "No auth logs yet" : "Nothing here"}>
          {outcome === "all" ? undefined : "No sign-ins with this result in the retention window."}
        </ConsoleEmpty>
      ) : (
        <Card>
          <AuthLogTable rows={rows} />
          <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--content-muted)" }}>
            Showing the latest {rows.length}. Reasons are explained in{" "}
            <a href="/help#errors" style={{ color: "var(--brand)" }}>
              Help → error reasons
            </a>
            .
          </p>
        </Card>
      )}
    </>
  );
}
