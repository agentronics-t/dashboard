import Link from "next/link";
import { Card, CardTitle, Kpi, PageHeader, fmt } from "@/components/ui";
import { AuthLogTable, ConsoleEmpty, Mono, VerifiedBadge, tableCell, tableHead } from "@/components/console";
import { LiveRefresh } from "@/components/LiveRefresh";
import { TIERS } from "@/lib/billing/plans";
import { currentPlan } from "@/lib/billing/service";
import { ago, getAgentDirectory, getAuthLogs, getAuthSummary, getSetupState, methodLabel } from "@/lib/console";
import { getMonthlyActiveAgents } from "@/lib/queries";
import { db, getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const tenantId = await getTenantId();
  const [summary, agents, logs, setup, maa, plan] = await Promise.all([
    getAuthSummary(tenantId, 7),
    getAgentDirectory(tenantId, 30, 8),
    getAuthLogs(tenantId, { limit: 8 }),
    getSetupState(tenantId),
    getMonthlyActiveAgents(tenantId),
    currentPlan(db(), tenantId)
  ]);
  const limit = TIERS[plan.tier].maa;
  const total = summary.verified + summary.unverified;
  const verifiedPct = total ? Math.round((summary.verified / total) * 100) : 0;

  const steps = [
    { done: setup.ingestKey, label: "Create an ingest key", href: "/configure/api-keys" },
    { done: setup.receivingEvents, label: "Add the middleware and stream auth events", href: "https://agentronics.dev/docs/getting-started" },
    { done: setup.verifiedAgent, label: "Verify your first agent", href: "/configure/authentication" },
    { done: plan.tier !== "free", label: "Choose a plan", href: "/billing", optional: true }
  ];
  const required = steps.filter((s) => !s.optional);
  const remaining = required.filter((s) => !s.done).length;

  return (
    <>
      <PageHeader title="Overview" subtitle="Agents authenticating on your sites" action={<LiveRefresh />} />

      {remaining > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <CardTitle>Get set up · {required.length - remaining} of {required.length} done</CardTitle>
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
            {steps.map((s, i) => (
              <li key={s.label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    flex: "none",
                    borderRadius: 999,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    background: s.done ? "var(--success-bg)" : "var(--surface-raised)",
                    color: s.done ? "var(--success)" : "var(--content-muted)"
                  }}
                >
                  {s.done ? "✓" : i + 1}
                </span>
                <a href={s.href} style={{ color: s.done ? "var(--content-muted)" : "var(--content)", textDecoration: s.done ? "line-through" : "none", fontWeight: 550 }}>
                  {s.label}
                </a>
                {s.optional && <span style={{ fontSize: 12, color: "var(--content-muted)" }}>optional</span>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 16 }}>
        <Kpi label="Monthly active agents" value={fmt(maa)} sub={limit ? `of ${fmt(limit)} on ${TIERS[plan.tier].name}` : TIERS[plan.tier].name} />
        <Kpi label="Verified sign-ins" value={fmt(summary.verified)} sub={`${verifiedPct}% of agent traffic · 7d`} />
        <Kpi label="Unverified" value={fmt(summary.unverified)} sub="no valid credential — browsed as normal · 7d" />
        <Kpi label="Methods in use" value={fmt(summary.byMethod.filter((m) => m.verified > 0).length)} sub="with a verified sign-in · 7d" />
      </div>

      {total === 0 ? (
        <ConsoleEmpty title="No agent sign-ins yet" />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16 }}>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <CardTitle>Recently active agents</CardTitle>
              <Link href="/agents" style={{ fontSize: 13, color: "var(--brand)" }}>
                All agents →
              </Link>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={tableHead}>Agent</th>
                  <th style={tableHead}>Method</th>
                  <th style={tableHead}>Status</th>
                  <th style={{ ...tableHead, textAlign: "right" }}>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.identity} className="ag-row">
                    <td style={tableCell}>
                      <Link href={`/agents/${encodeURIComponent(a.identity)}`} style={{ color: "var(--content)", fontWeight: 600, textDecoration: "none" }}>
                        {a.name}
                      </Link>
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
                    <td style={{ ...tableCell, textAlign: "right", color: "var(--content-muted)" }}>{ago(a.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <CardTitle>Sign-ins by method · 7d</CardTitle>
            <div style={{ display: "grid", gap: 10 }}>
              {summary.byMethod.map((m) => {
                const t = m.verified + m.failed;
                return (
                  <div key={m.method}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{methodLabel(m.method)}</span>
                      <span style={{ color: "var(--content-muted)" }}>
                        {fmt(m.verified)} verified · {fmt(m.failed)} failed
                      </span>
                    </div>
                    <div style={{ height: 8, borderRadius: 999, background: "var(--surface-raised)", overflow: "hidden", display: "flex" }}>
                      <div style={{ width: `${(m.verified / t) * 100}%`, background: "var(--success)" }} />
                      <div style={{ width: `${(m.failed / t) * 100}%`, background: "var(--warning)" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card style={{ gridColumn: "1 / -1" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <CardTitle>Latest auth logs</CardTitle>
              <Link href="/logs" style={{ fontSize: 13, color: "var(--brand)" }}>
                All logs →
              </Link>
            </div>
            <AuthLogTable rows={logs} />
          </Card>
        </div>
      )}
    </>
  );
}
