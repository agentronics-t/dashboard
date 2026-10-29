import Link from "next/link";
import { Badge, Card, CardTitle, Kpi, PageHeader, fmt } from "@/components/ui";
import { statusBadgeProps } from "@/components/agent-nick/Pipeline";
import { RepoPicker } from "@/components/agent-nick/RepoPicker";
import { ConnectGitHubButton, GitHubConnectedSignal, RefreshOnGitHubReturn } from "@/components/agent-nick/GitHubConnect";
import { LiveRefresh } from "@/components/LiveRefresh";
import { AddWebsite, SiteScore, SiteUrlForm, type ScorePoint } from "@/components/agent-nick/SiteScore";
import { after } from "next/server";
import { afterScanDue, getScoreCards, recordScan, type StoredScan } from "@/lib/siteScore";
import { SDK_READY, sendTestEventsOnce } from "@/lib/sdkTest";
import { agentNickConfigured, getInstallations, getSites, githubAppSlug, timeAgo } from "@/lib/agentNick";
import { getPlanUsage, getWorkspacePlan } from "@/lib/billing";
import { limitLabel } from "@agentronics/intel-schema";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  github_state: "That GitHub link expired or didn't start here. Click Connect GitHub again.",
  github_missing_code: "GitHub didn't send back an authorization. Make sure the app asks for user authorization during installation, then try again.",
  installation_not_yours: "That installation isn't visible to your GitHub account.",
  github_not_configured: "The GitHub App isn't configured on this console yet.",
  github_link_failed: "We couldn't link the GitHub installation. Try again.",
  plan_limit: "That's over your plan's limit. Upgrade in Account to continue.",
  not_configured: "The Agent Nic service isn't connected to this console yet."
};

export default async function AgentNickPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tenantId = await getTenantId();
  const [installs, sites, { spec: plan }, usage, scores] = await Promise.all([
    getInstallations(tenantId),
    getSites(tenantId),
    getWorkspacePlan(tenantId),
    getPlanUsage(tenantId),
    getScoreCards(tenantId)
  ]);
  // Agent Nic's PR is merged: score the site again once it has redeployed (retried while it shows no gain).
  for (const card of scores) {
    if (!afterScanDue(card)) continue;
    const { site, pendingAfter } = card;
    after(() => recordScan(tenantId, site.url, "after", pendingAfter!.runId).then(() => {}));
  }
  // Once Agent Nic's pull request has added the SDK (and made its key), send the
  // test events, once per website, so every page has data before the merge.
  for (const card of scores) {
    const nick = sites.find((s) => s.site.id === card.site.agentNickSiteId);
    if (!nick?.lastRun || !SDK_READY.includes(nick.lastRun.status)) continue;
    after(() => sendTestEventsOnce(tenantId, card.site.url, card.site.agentNickSiteId));
  }
  const waitingForRedeploy = scores.some((c) => c.pendingAfter);
  const websiteLimit = plan.limits.scoredWebsites;
  const canAddWebsite = websiteLimit === null || scores.length < websiteLimit;
  const point = (s: StoredScan | null): ScorePoint | null => s && { score: s.score, band: s.result.band.key, at: s.createdAt.toISOString() };
  const runsLeft = plan.limits.agentNickRunsPerMonth === null ? null : Math.max(0, plan.limits.agentNickRunsPerMonth - usage.runs);
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
        title="Agent Nic"
        subtitle="Our agents write WebMCP tools, a sitemap, llms.txt and structured data into your own code and open a pull request. You review, you merge."
        action={active ? <LiveRefresh intervalMs={4000} /> : waitingForRedeploy ? <LiveRefresh intervalMs={30_000} /> : undefined}
      />

      <Card style={{ marginBottom: 18 }}>
        {scores.length ? (
          <div style={{ display: "grid", gap: 16 }}>
            {scores.map((c, i) => (
              <div key={c.site.id} style={i ? { borderTop: "1px solid var(--border)", paddingTop: 16 } : undefined}>
                <SiteScore
                  id={c.site.id}
                  url={c.site.url}
                  before={point(c.before)}
                  after={point(c.after)}
                  waiting={!!c.pendingAfter}
                  latest={(c.after ?? c.before)?.result ?? null}
                />
              </div>
            ))}
            <AddWebsite
              canAdd={canAddWebsite}
              note={`${scores.length} of ${limitLabel(websiteLimit)} website${websiteLimit === 1 ? "" : "s"} on ${plan.name}`}
            />
          </div>
        ) : (
          <SiteUrlForm />
        )}
      </Card>

      <RefreshOnGitHubReturn />
      {sp.connected && <GitHubConnectedSignal />}
      {sp.connected && (
        <Card style={{ marginBottom: 18, borderColor: "var(--success)", background: "var(--success-bg)" }}>
          GitHub connected. Pick a repository below to start.
        </Card>
      )}
      {sp.error && (
        <Card style={{ marginBottom: 18, borderColor: "var(--danger)", background: "var(--danger-bg)" }}>{ERRORS[sp.error] ?? "Something went wrong. Try again."}</Card>
      )}

      <div className="ag-muted" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 13, margin: "-8px 0 16px" }}>
        <span>
          <strong style={{ color: "var(--content)" }}>{plan.name} plan</strong>
        </span>
        <span>
          {usage.runs} of {limitLabel(plan.limits.agentNickRunsPerMonth)} runs this month
        </span>
        <span>
          {usage.sites} of {limitLabel(plan.limits.agentNickSites)} site{plan.limits.agentNickSites === 1 ? "" : "s"}
        </span>
        <span>{limitLabel(plan.limits.agentNickToolsPerSite)} tools per site</span>
        {plan.id !== "enterprise" && (
          <Link className="ag-link" href="/account">
            {runsLeft === 0 ? "Out of runs — upgrade" : "Upgrade"}
          </Link>
        )}
      </div>

      {!installs.length ? (
        <Card style={{ padding: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>Make your site agent-ready without writing the code</div>
          <p className="ag-muted" style={{ margin: "6px 0 0", maxWidth: 640 }}>
            Connect GitHub and pick your website&apos;s repository. Agent Nic reads the code, proposes WebMCP tools for your pages, and — once
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
            <ConnectGitHubButton href="/agent-nic/github/install" />
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
            <Kpi label="Last change" value={lastChange ? timeAgo(lastChange) : "—"} sub="last merge by Agent Nic" />
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
                      <th>Last Agent Nic change</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {sites.map(({ site, lastRun }) => {
                      const status = lastRun && ["queued", "running", "awaiting_review", "pr_open"].includes(lastRun.status) ? lastRun.status : site.status;
                      const b = statusBadgeProps(status);
                      const changedSince = plan.limits.agentNickRescanAlerts && site.liveAt && site.lastPushAt && site.lastPushAt > site.liveAt;
                      return (
                        <tr key={site.id}>
                          <td>
                            <Link href={`/agent-nic/sites/${site.id}`} className="ag-mono" style={{ fontWeight: 600 }}>
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
                              <Link className="ag-btn ag-btn-sm" href={`/agent-nic/runs/${lastRun.id}`}>
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
