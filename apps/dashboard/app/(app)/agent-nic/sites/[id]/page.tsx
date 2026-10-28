import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardTitle, Kpi, PageHeader, fmt } from "@/components/ui";
import { statusBadgeProps } from "@/components/agent-nick/Pipeline";
import { RerunButton } from "@/components/agent-nick/RunActions";
import { LiveRefresh } from "@/components/LiveRefresh";
import { getSite, timeAgo } from "@/lib/agentNick";
import { getWorkspacePlan } from "@/lib/billing";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const RISK_LABEL: Record<string, string> = { read: "read-only", write: "changes data", payment: "payment", destructive: "irreversible" };

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const tenantId = await getTenantId();
  const [data, { spec: plan }] = await Promise.all([getSite(tenantId, id), getWorkspacePlan(tenantId)]);
  if (!data) notFound();
  const { site, runs, liveRun, liveTools } = data;
  const current = runs[0] ?? null;
  const busy = current && ["queued", "running", "awaiting_review", "pr_open"].includes(current.status);
  const status = busy ? current.status : site.status;
  const b = statusBadgeProps(status);
  const changedSince = !!(site.liveAt && site.lastPushAt && site.lastPushAt > site.liveAt);
  const alerts = plan.limits.agentNickRescanAlerts;

  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <Link href="/agent-nic" className="ag-muted" style={{ fontSize: 13 }}>
          ← Agent Nic
        </Link>
      </div>
      <PageHeader
        title={site.repoFullName}
        subtitle={[site.framework, `default branch ${site.defaultBranch}`, site.homepage].filter(Boolean).join(" · ")}
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {current && ["queued", "running"].includes(current.status) && <LiveRefresh intervalMs={4000} />}
            <Badge kind={b.kind}>{b.label}</Badge>
            {busy ? (
              <Link className="ag-btn" href={`/agent-nic/runs/${current.id}`}>
                {current.status === "awaiting_review" ? "Review tools" : current.status === "pr_open" ? "Open PR" : "Watch run"}
              </Link>
            ) : (
              <RerunButton siteId={site.id} label={site.liveSha ? "Re-scan & update tools" : "Run Agent Nic"} primary={(changedSince && alerts) || !site.liveSha} />
            )}
          </div>
        }
      />

      {changedSince && alerts && (
        <Card style={{ marginBottom: 18, borderColor: "var(--warning)", background: "var(--warning-bg)" }}>
          Your code changed {timeAgo(site.lastPushAt)} — after the tools went live. Re-scan to pick up new pages and actions.
        </Card>
      )}
      {site.liveSha && !alerts && (
        <Card style={{ marginBottom: 18 }}>
          <span className="ag-muted">
            Get told when your code changes after the tools go live, with one-click re-scans — included from the Starter plan.{" "}
            <Link className="ag-link" href="/account">
              Upgrade
            </Link>
          </span>
        </Card>
      )}

      <div className="ag-grid-kpi">
        <Kpi label="Tools live" value={site.liveSha ? fmt(site.liveTools) : "0"} sub={site.liveAt ? `since ${timeAgo(site.liveAt)}` : "not live yet"} />
        <Kpi label="Last push" value={site.lastPushAt ? timeAgo(site.lastPushAt) : "—"} sub={site.lastPushSha ? `${site.lastPushSha.slice(0, 7)}${site.lastPushBy ? ` · ${site.lastPushBy}` : ""}` : "no pushes seen yet"} />
        <Kpi label="Live commit" value={site.liveSha ? site.liveSha.slice(0, 7) : "—"} sub="merge that added the tools" />
        <Kpi label="Runs" value={fmt(runs.length)} sub={current ? `latest ${timeAgo(current.createdAt)}` : "none yet"} />
      </div>

      <Card style={{ marginBottom: 18 }}>
        <CardTitle>
          Live tools
          {liveRun?.prUrl && (
            <a className="ag-link" href={liveRun.prUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, marginLeft: 10 }}>
              from PR #{liveRun.prNumber} ↗
            </a>
          )}
        </CardTitle>
        {liveTools.length === 0 ? (
          <p className="ag-muted" style={{ margin: 0 }}>No tools are live on this site yet.</p>
        ) : (
          <div className="ag-scroll-x">
            <table className="ag-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Page</th>
                  <th>Type</th>
                  <th>Risk</th>
                  <th>Who may use it</th>
                </tr>
              </thead>
              <tbody>
                {liveTools.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <span className="ag-mono" style={{ fontWeight: 600 }}>{t.name}</span>
                      <div className="ag-muted" style={{ fontSize: 12 }}>{t.description}</div>
                    </td>
                    <td className="ag-mono">{t.page === "*" ? "every page" : t.page}</td>
                    <td>{t.kind === "form" ? "Form" : "Script"}</td>
                    <td>{RISK_LABEL[t.risk] ?? t.risk}</td>
                    <td>{t.auth.replace("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Changes by Agent Nic</CardTitle>
        {runs.length === 0 ? (
          <p className="ag-muted" style={{ margin: 0 }}>No runs yet.</p>
        ) : (
          <div className="ag-scroll-x">
            <table className="ag-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Status</th>
                  <th>Found</th>
                  <th>Tools</th>
                  <th>Change</th>
                  <th>CI</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const rb = statusBadgeProps(r.status);
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link className="ag-link" href={`/agent-nic/runs/${r.id}`}>
                          {timeAgo(r.createdAt)}
                        </Link>
                      </td>
                      <td>
                        <Badge kind={rb.kind}>{rb.label}</Badge>
                      </td>
                      <td className="ag-muted" style={{ fontSize: 12.5 }}>
                        {r.pagesFound} pages · {r.actionsFound} actions
                      </td>
                      <td>
                        {r.toolsApproved || r.toolsProposed ? `${r.toolsApproved}/${r.toolsProposed}` : "—"}
                      </td>
                      <td>
                        {r.prUrl ? (
                          <>
                            <a className="ag-link" href={r.prUrl} target="_blank" rel="noreferrer">
                              #{r.prNumber}
                            </a>{" "}
                            <span className="ag-mono ag-muted" style={{ fontSize: 12 }}>
                              {r.filesChanged} files +{r.additions} −{r.deletions}
                            </span>
                          </>
                        ) : r.filesChanged ? (
                          <span className="ag-mono ag-muted" style={{ fontSize: 12 }}>
                            {r.filesChanged} files +{r.additions} −{r.deletions}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{r.ciStatus ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
