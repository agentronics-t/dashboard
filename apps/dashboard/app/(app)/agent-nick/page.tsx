import Link from "next/link";
import { Badge, Card, CardTitle, Kpi, PageHeader, fmt } from "@/components/ui";
import { statusBadgeProps } from "@/components/agent-nick/Pipeline";
import { RepoPicker } from "@/components/agent-nick/RepoPicker";
import { LiveRefresh } from "@/components/LiveRefresh";
import { agentNickConfigured, getInstallations, getSites, githubAppSlug, timeAgo } from "@/lib/agentNick";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  github_state: "That GitHub link expired or didn't start here. Click Connect GitHub again.",
  github_missing_code: "GitHub didn't send back an authorization. Make sure the app asks for user authorization during installation, then try again.",
  installation_not_yours: "That installation isn't visible to your GitHub account.",
  github_not_configured: "The GitHub App isn't configured on this console yet.",
  github_link_failed: "We couldn't link the GitHub installation. Try again.",
  not_configured: "The Agent Nick service isn't connected to this console yet."
};

export default async function AgentNickPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tenantId = await getTenantId();
  const [installs, sites] = await Promise.all([getInstallations(tenantId), getSites(tenantId)]);
  const configured = agentNickConfigured() && !!githubAppSlug();

  const live = sites.filter((s) => s.site.status === "live" || s.site.liveSha);
  const liveTools = sites.reduce((n, s) => n + (s.site.liveSha ? s.site.liveTools : 0), 0);
  const openPrs = sites.filter((s) => s.lastRun?.status === "pr_open").length;
  const lastChange = sites.map((s) => s.site.liveAt).filter(Boolean).sort((a, b) => +b! - +a!)[0] ?? null;
  const active = sites.some((s) => s.lastRun && ["queued", "running"].includes(s.lastRun.status));

  const manageLinks = installs.map((i) => ({
    label: installs.length > 1 ? `Repo access · ${i.accountLogin}` : "Manage repo access",
    href:
      i.accountType === "Organization"
        ? `https://github.com/organizations/${i.accountLogin}/settings/installations/${i.installationId}`
        : `https://github.com/settings/installations/${i.installationId}`
  }));

  return (
    <>
      <PageHeader
        title="Agent Nick"
        subtitle="Our agents write WebMCP tools into your own code and open a pull request. You review, you merge."
        action={active ? <LiveRefresh intervalMs={4000} /> : undefined}
      />

      {sp.connected && (
        <Card style={{ marginBottom: 18, borderColor: "var(--success)", background: "var(--success-bg)" }}>
          GitHub connected. Pick a repository below to start.
        </Card>
      )}
      {sp.error && (
        <Card style={{ marginBottom: 18, borderColor: "var(--danger)", background: "var(--danger-bg)" }}>{ERRORS[sp.error] ?? "Something went wrong. Try again."}</Card>
      )}

      {!installs.length ? (
        <Card style={{ padding: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>Make your site agent-ready without writing the code</div>
          <p className="ag-muted" style={{ margin: "6px 0 0", maxWidth: 640 }}>
            Connect GitHub and pick your website&apos;s repository. Agent Nick reads the code, proposes WebMCP tools for your pages, and — once
            you approve — opens a pull request with the changes.
          </p>
          <div className="ag-hero-steps">
            {[
              ["1", "Connect GitHub", "Install the Agentronics app on the repositories you choose. Nothing is cloned."],
              ["2", "Review the tools", "See every proposed tool, decide who may use it, pick a plan."],
              ["3", "Accept the PR", "Your CI checks it; you merge; the tools go live on your site."]
            ].map(([n, title, body]) => (
              <div key={n} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 14 }}>
                <div className="ag-dot" style={{ marginBottom: 8 }}>{n}</div>
                <div style={{ fontWeight: 700 }}>{title}</div>
                <div className="ag-muted" style={{ fontSize: 13, marginTop: 3 }}>{body}</div>
              </div>
            ))}
          </div>
          {configured ? (
            <a className="ag-btn ag-btn-primary" href="/agent-nick/github/install">
              Connect GitHub
            </a>
          ) : (
            <p className="ag-muted" style={{ margin: 0 }}>{ERRORS.not_configured}</p>
          )}
        </Card>
      ) : (
        <>
          <div className="ag-grid-kpi">
            <Kpi label="Sites live" value={fmt(live.length)} sub={`of ${sites.length} connected`} />
            <Kpi label="Tools live" value={fmt(liveTools)} sub="WebMCP tools merged" />
            <Kpi label="Open PRs" value={fmt(openPrs)} sub="waiting for you" />
            <Kpi label="Last change" value={lastChange ? timeAgo(lastChange) : "—"} sub="last merge by Agent Nick" />
          </div>

          {sites.length > 0 && (
            <Card style={{ marginBottom: 18 }}>
              <CardTitle>Your sites</CardTitle>
              <div className="ag-scroll-x">
                <table className="ag-table">
                  <thead>
                    <tr>
                      <th>Repository</th>
                      <th>Status</th>
                      <th>Tools live</th>
                      <th>Last push</th>
                      <th>Last Agent Nick change</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {sites.map(({ site, lastRun }) => {
                      const status = lastRun && ["queued", "running", "awaiting_review", "pr_open"].includes(lastRun.status) ? lastRun.status : site.status;
                      const b = statusBadgeProps(status);
                      const changedSince = site.liveAt && site.lastPushAt && site.lastPushAt > site.liveAt;
                      return (
                        <tr key={site.id}>
                          <td>
                            <Link href={`/agent-nick/sites/${site.id}`} className="ag-mono" style={{ fontWeight: 600 }}>
                              {site.repoFullName}
                            </Link>
                            {site.framework && <div className="ag-muted" style={{ fontSize: 12 }}>{site.framework}</div>}
                          </td>
                          <td>
                            <Badge kind={b.kind}>{b.label}</Badge>
                          </td>
                          <td>{site.liveSha ? fmt(site.liveTools) : "—"}</td>
                          <td>
                            {site.lastPushAt ? (
                              <>
                                {timeAgo(site.lastPushAt)}
                                <div className="ag-muted ag-mono" style={{ fontSize: 12 }}>
                                  {site.lastPushSha?.slice(0, 7)}
                                  {site.lastPushBy ? ` · ${site.lastPushBy}` : ""}
                                </div>
                                {changedSince && <div style={{ fontSize: 12, color: "var(--warning)" }}>Code changed since the tools went live</div>}
                              </>
                            ) : (
                              <span className="ag-muted">—</span>
                            )}
                          </td>
                          <td>
                            {lastRun?.prUrl ? (
                              <>
                                <a className="ag-link" href={lastRun.prUrl} target="_blank" rel="noreferrer">
                                  PR #{lastRun.prNumber}
                                </a>{" "}
                                <span className="ag-muted ag-mono" style={{ fontSize: 12 }}>
                                  +{lastRun.additions} −{lastRun.deletions} · {lastRun.filesChanged} files
                                </span>
                                <div className="ag-muted" style={{ fontSize: 12 }}>
                                  {lastRun.toolsApproved} tools · {timeAgo(lastRun.mergedAt ?? lastRun.updatedAt)}
                                </div>
                              </>
                            ) : (
                              <span className="ag-muted">—</span>
                            )}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {lastRun && (
                              <Link className="ag-btn ag-btn-sm" href={`/agent-nick/runs/${lastRun.id}`}>
                                {["queued", "running"].includes(lastRun.status) ? "Watch" : lastRun.status === "awaiting_review" ? "Review" : "Open run"}
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card>
            <CardTitle>{sites.length ? "Add another site" : "Pick your website's repository"}</CardTitle>
            <RepoPicker manageLinks={manageLinks} />
          </Card>
        </>
      )}
    </>
  );
}
