// After the PR: GitHub webhooks drive the rest of the story — CI results (with
// one automatic fix attempt), merge → live, close, and pushes to the default
// branch ("last push" on the Agent overview).

import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@agentronics/intel-schema/db";
import type { GitHub } from "../github/client.ts";
import { systemPrompt } from "../knowledge/index.ts";
import type { Llm } from "../llm/gemini.ts";
import type { Pipeline } from "./graph.ts";
import { tenantPlan } from "../plan.ts";
import { RunReporter } from "./reporter.ts";
import type { FileChange } from "./types.ts";
import { validateChanges } from "./validate.ts";

export const MAX_FIX_ATTEMPTS = 1;

interface RepoRef {
  id: number;
  full_name: string;
  default_branch?: string;
}

async function runByPr(db: Db, repo: RepoRef, prNumber: number) {
  const [row] = await db
    .select({ run: schema.agentNickRuns, site: schema.agentNickSites })
    .from(schema.agentNickRuns)
    .innerJoin(schema.agentNickSites, eq(schema.agentNickRuns.siteId, schema.agentNickSites.id))
    .where(and(eq(schema.agentNickSites.repoId, repo.id), eq(schema.agentNickRuns.prNumber, prNumber)))
    .orderBy(desc(schema.agentNickRuns.createdAt))
    .limit(1);
  return row ?? null;
}

async function runByHead(db: Db, repo: RepoRef, headSha: string) {
  const [row] = await db
    .select({ run: schema.agentNickRuns, site: schema.agentNickSites })
    .from(schema.agentNickRuns)
    .innerJoin(schema.agentNickSites, eq(schema.agentNickRuns.siteId, schema.agentNickSites.id))
    .where(and(eq(schema.agentNickSites.repoId, repo.id), eq(schema.agentNickRuns.headSha, headSha)))
    .limit(1);
  return row ?? null;
}

/** Mark a merged PR live (shared by the webhook and the console's Accept button). */
export async function markMerged(db: Db, runId: string, siteId: string, mergeSha: string | null, tools: number) {
  const now = new Date();
  const r = new RunReporter(db, runId);
  await r.update({ status: "merged", step: "live", mergedAt: now, finishedAt: now });
  await db
    .update(schema.agentNickSites)
    .set({ status: "live", liveSha: mergeSha, liveAt: now, liveTools: tools, lastRunId: runId, updatedAt: now })
    .where(eq(schema.agentNickSites.id, siteId));
  await r.done("live", `Merged — ${tools} WebMCP tool${tools === 1 ? " is" : "s are"} live once your site deploys.`);
}

export interface FollowupDeps {
  db: Db;
  github: (installationId: number) => GitHub;
  llm: () => Llm;
  pipeline: () => Promise<Pipeline>;
  /** Schedules a CI fix attempt (inline or as a job). */
  dispatchFix: (runId: string) => void;
}

export async function handleWebhook(deps: FollowupDeps, event: string, p: Record<string, unknown>): Promise<string> {
  const { db } = deps;
  const repo = p.repository as RepoRef | undefined;

  if (event === "installation") {
    const inst = (p.installation as { id: number }).id;
    const action = p.action as string;
    const set =
      action === "deleted"
        ? { deletedAt: new Date() }
        : action === "suspend"
          ? { suspendedAt: new Date() }
          : action === "unsuspend"
            ? { suspendedAt: null }
            : null;
    if (set) await db.update(schema.githubInstallations).set(set).where(eq(schema.githubInstallations.installationId, inst));
    return `installation ${action}`;
  }

  if (event === "push" && repo) {
    const ref = p.ref as string;
    if (ref !== `refs/heads/${repo.default_branch}`) return "push to non-default branch";
    const head = p.head_commit as { timestamp?: string } | null;
    const pusher = p.pusher as { name?: string } | undefined;
    await db
      .update(schema.agentNickSites)
      .set({
        lastPushSha: p.after as string,
        lastPushAt: head?.timestamp ? new Date(head.timestamp) : new Date(),
        lastPushBy: pusher?.name ?? null,
        updatedAt: new Date()
      })
      .where(eq(schema.agentNickSites.repoId, repo.id));
    return "push recorded";
  }

  if (event === "pull_request" && repo && p.action === "closed") {
    const pr = p.pull_request as { number: number; merged: boolean; merge_commit_sha: string | null };
    const hit = await runByPr(db, repo, pr.number);
    if (!hit || hit.run.status === "merged") return "not ours";
    if (pr.merged) {
      await markMerged(db, hit.run.id, hit.site.id, pr.merge_commit_sha, hit.run.toolsApproved);
      return "merged";
    }
    const r = new RunReporter(db, hit.run.id);
    await r.update({ status: "closed", finishedAt: new Date() });
    await r.fail("live", "The pull request was closed without merging.");
    await db
      .update(schema.agentNickSites)
      .set({ status: hit.site.liveSha ? "live" : "new", updatedAt: new Date() })
      .where(eq(schema.agentNickSites.id, hit.site.id));
    return "closed";
  }

  if (event === "check_suite" && repo && p.action === "completed") {
    const suite = p.check_suite as { head_sha: string };
    const hit = await runByHead(db, repo, suite.head_sha);
    if (!hit || hit.run.status !== "pr_open") return "not ours";
    const gh = deps.github(hit.site.installationId);
    const { check_runs } = await gh.checkRuns(repo.full_name, suite.head_sha);
    const ours = check_runs.filter((c) => !/agent.?nick/i.test(c.name));
    const pending = ours.some((c) => c.status !== "completed");
    const failedRuns = ours.filter((c) => c.status === "completed" && ["failure", "timed_out", "cancelled"].includes(c.conclusion ?? ""));
    const status = failedRuns.length ? "failure" : pending ? "pending" : ours.length ? "success" : "none";
    if (status === hit.run.ciStatus && status !== "failure") return `ci ${status}`;
    const r = new RunReporter(db, hit.run.id);
    await r.update({ ciStatus: status });
    if (status === "success") await r.done("ci", `All ${ours.length} checks passed`);
    if (status === "failure") {
      await r.info("ci", `${failedRuns.length} check${failedRuns.length === 1 ? "" : "s"} failed: ${failedRuns.map((c) => c.name).join(", ")}`);
      const plan = await tenantPlan(db, hit.run.tenantId);
      if (!plan.limits.agentNickAutoCiFix) {
        await r.info("ci", `Automatic CI fixes are included from the Starter plan — fix it on the PR, or upgrade.`);
      } else if (hit.run.fixAttempts < MAX_FIX_ATTEMPTS) deps.dispatchFix(hit.run.id);
      else {
        await r.fail("ci", "CI is still failing after an automatic fix. Open the PR to see the errors.");
        await r.update({ status: "pr_open", finishedAt: null });
      }
    }
    return `ci ${status}`;
  }

  return "ignored";
}

const FIX_TASK = `A pull request that added WebMCP tools to a website failed the site's CI checks. You get the CI errors and the files the pull request added or changed. Return corrected versions of only the files that need a change to make CI pass, keeping every tool and its behaviour. Never touch other files, never weaken the WebMCP rules from the guides, and if the errors are unrelated to these files return an empty list.`;

const fixResponse = z.object({ files: z.array(z.object({ path: z.string(), content: z.string() })) });

/** One automatic attempt to fix a failing CI run on our PR. */
export async function attemptCiFix(deps: FollowupDeps, runId: string): Promise<void> {
  const { db } = deps;
  const [hit] = await db
    .select({ run: schema.agentNickRuns, site: schema.agentNickSites })
    .from(schema.agentNickRuns)
    .innerJoin(schema.agentNickSites, eq(schema.agentNickRuns.siteId, schema.agentNickSites.id))
    .where(and(eq(schema.agentNickRuns.id, runId), isNull(schema.agentNickRuns.mergedAt)));
  if (!hit?.run.headSha || !hit.run.branch || hit.run.fixAttempts >= MAX_FIX_ATTEMPTS) return;

  const r = new RunReporter(db, runId);
  await r.update({ fixAttempts: hit.run.fixAttempts + 1 });
  await r.start("ci", "Reading the CI errors and fixing the code");
  const gh = deps.github(hit.site.installationId);
  const full = hit.site.repoFullName;

  const { check_runs } = await gh.checkRuns(full, hit.run.headSha);
  const failed = check_runs.filter((c) => ["failure", "timed_out"].includes(c.conclusion ?? ""));
  const errors: string[] = [];
  for (const c of failed.slice(0, 5)) {
    const notes = await gh.checkRunAnnotations(full, c.id).catch(() => []);
    errors.push(
      `## ${c.name}\n${[c.output.title, c.output.summary, c.output.text].filter(Boolean).join("\n").slice(0, 4000)}\n${notes
        .map((a) => `${a.path}:${a.start_line} ${a.annotation_level}: ${a.message}`)
        .join("\n")}`
    );
  }

  const pipeline = await deps.pipeline();
  const state = await pipeline.getState({ configurable: { thread_id: runId } });
  const changes = ((state.values as { changes?: FileChange[] }).changes ?? []).map((c) => ({ path: c.path, content: c.content }));
  const allowed = new Set(changes.map((c) => c.path));

  const llm = deps.llm();
  const before = { ...llm.usage };
  let files: { path: string; content: string }[] = [];
  try {
    files = await llm.json({
      system: systemPrompt(FIX_TASK),
      prompt: `CI errors:\n${errors.join("\n\n") || "(no details reported)"}\n\nFiles in the pull request (JSON):\n${JSON.stringify(changes)}`,
      schema: {
        type: "object",
        properties: { files: { type: "array", items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
        required: ["files"]
      },
      effort: "medium",
      parse: (v) => fixResponse.parse(v).files.filter((f) => allowed.has(f.path))
    });
  } finally {
    await r.addUsage(before, llm.usage);
  }

  const problems = validateChanges(files.map((f) => ({ ...f, before: "", reason: "" })));
  if (!files.length || problems.length) {
    await r.fail("ci", files.length ? "The automatic fix didn't pass our checks — see the PR for the CI errors." : "The CI failure doesn't come from the files Agent Nick changed. Check the PR.");
    // The PR is still open and mergeable — keep the run there.
    await r.update({ status: "pr_open", finishedAt: null });
    return;
  }
  const commit = await gh.request<{ tree: { sha: string } }>("GET", `/repos/${full}/git/commits/${hit.run.headSha}`);
  const sha = await gh.commitFiles({
    fullName: full,
    branch: hit.run.branch,
    parentSha: hit.run.headSha,
    baseTreeSha: commit.tree.sha,
    message: "Fix CI for WebMCP tools\n\nGenerated by Agentronics Agent Nick.",
    files,
    createBranch: false
  });
  await r.update({ headSha: sha, ciStatus: "pending", status: "pr_open" });
  await r.done("ci", `Pushed a fix to ${files.length} file${files.length === 1 ? "" : "s"}; waiting for CI again.`);
}
