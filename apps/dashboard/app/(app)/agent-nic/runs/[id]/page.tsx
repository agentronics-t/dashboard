import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardTitle, PageHeader, fmt } from "@/components/ui";
import { Pipeline, RunLog, statusBadgeProps } from "@/components/agent-nick/Pipeline";
import { ReviewPanel, type ReviewPlan, type ReviewSiteFix, type ReviewTool } from "@/components/agent-nick/ReviewPanel";
import { AcceptButton, RerunButton } from "@/components/agent-nick/RunActions";
import { LiveRefresh } from "@/components/LiveRefresh";
import { upgradeFor } from "@agentronics/intel-schema";
import { getRun, timeAgo } from "@/lib/agentNick";
import { billingConfigured, getWorkspacePlan } from "@/lib/billing";
import { planCards } from "@/lib/planCards";
import { siteUrlForRepo } from "@/lib/siteScore";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const PLAN_NOTE: Record<string, string> = {
  active: "Payment received — your new plan is active. Pick the tools and approve to continue.",
  pending: "Your payment is still being confirmed. This page updates as soon as it clears.",
  failed: "That payment didn't go through. Nothing was charged.",
  unknown: "We couldn't confirm the payment yet. If you completed checkout, it will show up here shortly."
};

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const tenantId = await getTenantId();
  const data = await getRun(tenantId, id);
  if (!data) notFound();
  const { run, site, events, tools } = data;
  const plan = run.status === "awaiting_review" ? (await getWorkspacePlan(tenantId)).spec : null;
  const reviewPlan: ReviewPlan | null = plan && {
    id: plan.id,
    name: plan.name,
    toolsPerSite: plan.limits.agentNickToolsPerSite,
    strategies: plan.limits.agentNickStrategies,
    unlockedBy: Object.fromEntries(
      (["form", "dom", "fetch", "server_action"] as const).map((s) => [s, upgradeFor((p) => p.limits.agentNickStrategies.includes(s))?.name ?? ""])
    )
  };

  const b = statusBadgeProps(run.status);
  const moving = ["queued", "running"].includes(run.status) || (run.status === "pr_open" && run.ciStatus === "pending");
  const approvedTools = tools.filter((t) => t.approved);
  const reviewTools: ReviewTool[] = tools.map((t) => {
    const src = (t.source ?? {}) as { strategy?: string; rationale?: string };
    return {
      id: t.id,
      page: t.page,
      name: t.name,
      kind: t.kind,
      strategy: src.strategy ?? t.kind,
      description: t.description,
      risk: t.risk,
      auth: t.auth as ReviewTool["auth"],
      rationale: src.rationale ?? "",
      inputSchema: t.inputSchema
    };
  });
  // The "Site files" step's drafts, and what the review approved.
  const siteStep = events.find((e) => e.step === "site" && e.kind === "done")?.data as
    | { fixes?: ReviewSiteFix[]; facts?: { url?: string | null; urlSource?: string | null } }
    | undefined;
  // The address for the review: what Agent Nic found (the saved website comes first there), else the saved website.
  const savedUrl = run.status === "awaiting_review" ? await siteUrlForRepo(tenantId, site.id) : null;
  const detectedUrl = siteStep?.facts?.url ?? savedUrl ?? site.homepage ?? null;
  const detectedSource = siteStep?.facts?.url ? (siteStep.facts.urlSource ?? null) : savedUrl ? "the website you saved in the console" : site.homepage ? "the repository's website on GitHub" : null;
  const siteFixes = siteStep?.fixes ?? [];
  const decision = (run.decision ?? {}) as { siteFiles?: { kind: string; approved: boolean }[] };
  const siteApproved = siteFixes.filter((f) => decision.siteFiles?.some((d) => d.kind === f.kind && d.approved)).map((f) => f.title);
  const shipped = [run.toolsApproved ? `${run.toolsApproved} WebMCP tool${run.toolsApproved === 1 ? "" : "s"}` : "", ...siteApproved].filter(Boolean).join(", ");
  const dryRun = run.status === "ready" ? events.find((e) => e.step === "pr" && e.kind === "done")?.data as { files?: { path: string; content: string }[] } | undefined : undefined;

  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <Link href={`/agent-nic/sites/${site.id}`} className="ag-muted" style={{ fontSize: 13 }}>
          ← {site.repoFullName}
        </Link>
      </div>
      <PageHeader
        title={run.status === "awaiting_review" ? (tools.length ? "Review the proposed tools" : "Review the site files") : "Agent Nic run"}
        subtitle={`${site.repoFullName}${run.framework ? ` · ${run.framework}` : ""} · started ${timeAgo(run.createdAt)}`}
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {moving && <LiveRefresh intervalMs={2500} />}
            <Badge kind={b.kind}>{b.label}</Badge>
          </div>
        }
      />

      {sp.plan && PLAN_NOTE[sp.plan] && run.status === "awaiting_review" && (
        <Card style={{ marginBottom: 18, borderColor: sp.plan === "active" ? "var(--success)" : "var(--warning)", background: sp.plan === "active" ? "var(--success-bg)" : "var(--warning-bg)" }}>
          {PLAN_NOTE[sp.plan]}
        </Card>
      )}

      <Card style={{ marginBottom: 18 }}>
        <CardTitle>Pipeline</CardTitle>
        <Pipeline run={run} events={events} />
      </Card>

      {run.status === "awaiting_review" && (
        <Card style={{ marginBottom: 18 }}>
          <CardTitle>Your review</CardTitle>
          <p className="ag-muted" style={{ margin: "-6px 0 16px", fontSize: 13.5 }}>
            Found {fmt(run.pagesFound)} pages and {fmt(run.actionsFound)} actions. Untick anything you don&apos;t want agents to use, and choose who may use each
            tool. Read-only tools run without asking; payments and irreversible actions always ask the visitor first.
            {siteFixes.length > 0 &&
              " Site fixes cover the rest of your Agent Readiness Score (AI rules, llms.txt, sitemap, structured data, Markdown pages, labels) and connect the Agentronics SDK, so events show up here as soon as you merge. Everything starts ticked."}
          </p>
          {reviewPlan && (
            <ReviewPanel
              runId={run.id}
              tools={reviewTools}
              siteFixes={siteFixes}
              detectedUrl={detectedUrl}
              detectedSource={detectedSource}
              plan={reviewPlan}
              plans={planCards()}
              billingReady={billingConfigured()}
            />
          )}
        </Card>
      )}

      {run.status === "pr_open" && (
        <Card style={{ marginBottom: 18 }}>
          <CardTitle>Pull request ready</CardTitle>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <a className="ag-link" href={run.prUrl ?? "#"} target="_blank" rel="noreferrer" style={{ fontSize: 16 }}>
                #{run.prNumber} · {shipped || "changes"} ↗
              </a>
              <div className="ag-muted ag-mono" style={{ fontSize: 12.5, marginTop: 4 }}>
                {run.branch} · {run.filesChanged} files · +{run.additions} −{run.deletions}
              </div>
              <div style={{ fontSize: 13, marginTop: 6 }}>
                CI:{" "}
                <strong style={{ color: run.ciStatus === "success" ? "var(--success)" : run.ciStatus === "failure" ? "var(--danger)" : "var(--content-secondary)" }}>
                  {run.ciStatus === "success" ? "passing" : run.ciStatus === "failure" ? "failing" : run.ciStatus === "none" ? "no checks" : "running"}
                </strong>
                {run.fixAttempts > 0 && <span className="ag-muted"> · Agent Nic pushed {run.fixAttempts} fix</span>}
              </div>
            </div>
            <AcceptButton runId={run.id} />
          </div>
        </Card>
      )}

      {run.status === "merged" && (
        <Card style={{ marginBottom: 18, borderColor: "var(--success)" }}>
          <CardTitle>Live</CardTitle>
          <p style={{ margin: 0 }}>
            {shipped || "The changes"} {shipped.includes(",") || run.toolsApproved > 1 ? "were" : "was"} merged {timeAgo(run.mergedAt)}. They go live with your next deploy.{" "}
            <Link className="ag-link" href={`/agent-nic/sites/${site.id}`}>
              See the site
            </Link>
          </p>
        </Card>
      )}

      {["failed", "closed", "cancelled"].includes(run.status) && (
        <Card style={{ marginBottom: 18, borderColor: run.status === "failed" ? "var(--danger)" : "var(--border)" }}>
          <CardTitle>{run.status === "failed" ? "This run stopped" : run.status === "closed" ? "Pull request closed" : "Run cancelled"}</CardTitle>
          {run.error && <p style={{ margin: "0 0 12px" }}>{run.error}</p>}
          <RerunButton siteId={site.id} primary />
        </Card>
      )}

      {dryRun?.files && (
        <Card style={{ marginBottom: 18 }}>
          <CardTitle>Dry run — files Agent Nic would commit</CardTitle>
          {dryRun.files.map((f) => (
            <details key={f.path} style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
              <summary className="ag-mono" style={{ cursor: "pointer", fontSize: 13 }}>{f.path}</summary>
              <pre style={{ margin: "8px 0 0", background: "var(--code-bg)", color: "var(--code-fg)", borderRadius: "var(--radius-md)", padding: 12, fontSize: 12, overflowX: "auto", maxHeight: 420 }}>
                {f.content}
              </pre>
            </details>
          ))}
        </Card>
      )}

      {run.status !== "awaiting_review" && approvedTools.length > 0 && (
        <Card style={{ marginBottom: 18 }}>
          <CardTitle>Tools in this change</CardTitle>
          <div className="ag-scroll-x">
            <table className="ag-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Page</th>
                  <th>Risk</th>
                  <th>Who may use it</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {approvedTools.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <span className="ag-mono" style={{ fontWeight: 600 }}>{t.name}</span>
                      <div className="ag-muted" style={{ fontSize: 12 }}>{t.description}</div>
                    </td>
                    <td className="ag-mono">{t.page === "*" ? "every page" : t.page}</td>
                    <td>{t.risk}</td>
                    <td>{t.auth.replace("_", " ")}</td>
                    <td className="ag-mono ag-muted" style={{ fontSize: 12 }}>{t.filePath ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardTitle>Activity</CardTitle>
        <RunLog events={events} />
      </Card>
    </>
  );
}
