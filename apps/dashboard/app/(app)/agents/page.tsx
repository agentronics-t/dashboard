import Link from "next/link";
import { Card, Kpi, PageHeader, fmt } from "@/components/ui";
import { ConsoleEmpty, FilterPills, Mono, VerifiedBadge, tableCell, tableHead } from "@/components/console";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ago, getAgentDirectory, methodLabel } from "@/lib/console";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const ACTIVE_MS = 15 * 60 * 1000;

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const status = sp.status === "verified" || sp.status === "unverified" ? sp.status : "all";
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 100);
  const tenantId = await getTenantId();
  const all = await getAgentDirectory(tenantId, 30, 500);
  const now = Date.now();

  const rows = all.filter(
    (a) =>
      (status === "all" || (status === "verified") === a.verified) &&
      (!q || a.identity.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
  );
  const active = all.filter((a) => now - a.lastSeen.getTime() < ACTIVE_MS).length;
  const qs = (s: string) => `/agents?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <>
      <PageHeader title="Agents" subtitle="Every agent identity that tried to sign in, last 30 days" action={<LiveRefresh />} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 16 }}>
        <Kpi label="Agents" value={fmt(all.length)} sub="30d" />
        <Kpi label="Verified" value={fmt(all.filter((a) => a.verified).length)} sub="at least one valid credential" />
        <Kpi label="Unverified" value={fmt(all.filter((a) => !a.verified).length)} sub="never presented a valid credential" />
        <Kpi label="Active sessions" value={fmt(active)} sub="seen in the last 15 min" />
      </div>

      {all.length === 0 ? (
        <ConsoleEmpty title="No agents yet" />
      ) : (
        <Card>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <FilterPills
              active={status}
              options={[
                { label: "All", value: "all", href: qs("all") },
                { label: "Verified", value: "verified", href: qs("verified") },
                { label: "Unverified", value: "unverified", href: qs("unverified") }
              ]}
            />
            <form action="/agents" style={{ marginLeft: "auto" }}>
              <input type="hidden" name="status" value={status} />
              <input
                name="q"
                defaultValue={q}
                placeholder="Search agents…"
                aria-label="Search agents"
                style={{ padding: "7px 11px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)", background: "var(--canvas)", color: "var(--content)", fontSize: 13, width: 240 }}
              />
            </form>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={tableHead}>Agent</th>
                  <th style={tableHead}>Method</th>
                  <th style={tableHead}>Status</th>
                  <th style={{ ...tableHead, textAlign: "right" }}>Sign-ins</th>
                  <th style={{ ...tableHead, textAlign: "right" }}>Failed</th>
                  <th style={{ ...tableHead, textAlign: "right" }}>Blocked</th>
                  <th style={tableHead}>First seen</th>
                  <th style={{ ...tableHead, textAlign: "right" }}>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.identity} className="ag-row">
                    <td style={tableCell}>
                      <Link href={`/agents/${encodeURIComponent(a.identity)}`} style={{ color: "var(--content)", fontWeight: 600, textDecoration: "none" }}>
                        {a.name}
                      </Link>
                      {now - a.lastSeen.getTime() < ACTIVE_MS && (
                        <span title="Active now" style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: "var(--success)", marginLeft: 8 }} />
                      )}
                      {a.name !== a.identity && (
                        <div>
                          <Mono muted>{a.identity}</Mono>
                        </div>
                      )}
                    </td>
                    <td style={tableCell}>{methodLabel(a.method)}</td>
                    <td style={tableCell}>
                      <VerifiedBadge verified={a.verified} />
                    </td>
                    <td style={{ ...tableCell, textAlign: "right" }}>{fmt(a.requests - a.failures - a.blocked)}</td>
                    <td style={{ ...tableCell, textAlign: "right", color: a.failures ? "var(--warning)" : "var(--content-muted)" }}>{fmt(a.failures)}</td>
                    <td style={{ ...tableCell, textAlign: "right", color: a.blocked ? "var(--danger)" : "var(--content-muted)" }}>{fmt(a.blocked)}</td>
                    <td style={{ ...tableCell, color: "var(--content-muted)" }}>{a.firstSeen.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                    <td style={{ ...tableCell, textAlign: "right", color: "var(--content-muted)" }}>{ago(a.lastSeen)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ ...tableCell, textAlign: "center", color: "var(--content-muted)" }}>
                      No agents match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
