// The Agent Nick pipeline as a LangGraph graph:
//
//   read_code → detect_framework → find_pages → find_actions → propose_tools
//     → review ⏸ → write_code → validate_code → open_pr
//
// Only `propose` and `write` call the model. `review` pauses the graph
// (interrupt) until the customer approves in the console; the checkpoint lives
// in Postgres, so the run resumes in any process — minutes or days later.

import { Annotation, Command, END, START, StateGraph, interrupt, type BaseCheckpointSaver } from "@langchain/langgraph";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@agentronics/intel-schema/db";
import type { GitHub } from "../github/client.ts";
import type { Llm } from "../llm/gemini.ts";
import { generateCode, type Handler } from "./codegen.ts";
import { countActions, digestPages } from "./extract.ts";
import { detectFramework, discoverPages } from "./framework.ts";
import { writeHandlers } from "./handlers.ts";
import { proposeTools } from "./propose.ts";
import { openPullRequest, prBody } from "./publish.ts";
import { RepoReader } from "./repo.ts";
import { RunReporter, type StepId } from "./reporter.ts";
import type { FileChange, Framework, PageDigest, PageInfo, ReviewDecision, ToolProposal } from "./types.ts";
import { diffStat, validateChanges } from "./validate.ts";

export interface PipelineDeps {
  db: Db;
  github: (installationId: number) => GitHub;
  llm: () => Llm;
  dryRun: boolean;
  /** Console base URL, for links in the PR body. */
  consoleUrl: string | null;
}

const State = Annotation.Root({
  runId: Annotation<string>,
  tenantId: Annotation<string>,
  siteId: Annotation<string>,
  baseSha: Annotation<string>,
  baseTreeSha: Annotation<string>,
  framework: Annotation<Framework>,
  pages: Annotation<PageInfo[]>,
  digests: Annotation<PageDigest[]>,
  tools: Annotation<ToolProposal[]>,
  approved: Annotation<ToolProposal[]>,
  handlers: Annotation<Record<string, Handler>>,
  changes: Annotation<FileChange[]>,
  toolFiles: Annotation<Record<string, string>>,
  manualSteps: Annotation<string[]>,
  skipped: Annotation<{ name: string; reason: string }[]>,
  /** Set when the run stops early on purpose (nothing to do, unsupported…). */
  halted: Annotation<string | null>
});

type S = typeof State.State;
type U = typeof State.Update;

class Halt extends Error {}

export function buildPipeline(deps: PipelineDeps, checkpointer: BaseCheckpointSaver) {
  const { db } = deps;
  const readers = new Map<string, Promise<{ reader: RepoReader; gh: GitHub; site: typeof schema.agentNickSites.$inferSelect }>>();

  async function site(s: S) {
    const [row] = await db.select().from(schema.agentNickSites).where(eq(schema.agentNickSites.id, s.siteId));
    if (!row) throw new Error("site not found");
    return row;
  }

  /** The repo at the run's base commit (tree fetched once per process). */
  function repo(s: S) {
    let p = readers.get(s.runId);
    if (!p) {
      p = (async () => {
        const row = await site(s);
        const gh = deps.github(row.installationId);
        const { entries } = await gh.tree(row.repoFullName, s.baseTreeSha);
        return { reader: new RepoReader(gh, row.repoFullName, entries), gh, site: row };
      })();
      readers.set(s.runId, p);
    }
    return p;
  }

  /** Run a step with start/done/fail reporting and model-usage accounting. */
  function step(id: StepId, title: string, fn: (s: S, r: RunReporter, llm: Llm) => Promise<U>) {
    return async (s: S): Promise<U> => {
      const r = new RunReporter(db, s.runId);
      const llm = deps.llm();
      const before = { ...llm.usage };
      await r.start(id, title);
      try {
        return await fn(s, r, llm);
      } catch (err) {
        if (err instanceof Halt) {
          await r.fail(id, err.message);
          return { halted: err.message };
        }
        // LangGraph's interrupt() works by throwing; let it through untouched.
        if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "GraphInterrupt") throw err;
        const msg = err instanceof Error ? err.message : String(err);
        await r.fail(id, `Something went wrong: ${msg}`);
        return { halted: msg };
      } finally {
        await r.addUsage(before, llm.usage);
      }
    };
  }

  const read = step("read", "Reading the code through GitHub (no clone)", async (s, r) => {
    const row = await site(s);
    const gh = deps.github(row.installationId);
    const head = await gh.branchHead(row.repoFullName, row.defaultBranch);
    const { entries, truncated } = await gh.tree(row.repoFullName, head.treeSha);
    const reader = new RepoReader(gh, row.repoFullName, entries);
    readers.set(s.runId, Promise.resolve({ reader, gh, site: row }));
    await r.update({ baseSha: head.sha });
    await r.done("read", `${reader.files.length} source files on ${row.defaultBranch} @ ${head.sha.slice(0, 7)}`, {
      files: reader.files.length,
      truncated
    });
    return { baseSha: head.sha, baseTreeSha: head.treeSha };
  });

  const framework = step("framework", "Detecting the framework", async (s, r) => {
    const { reader } = await repo(s);
    const fw = await detectFramework(reader);
    await r.update({ framework: fw.label });
    await db.update(schema.agentNickSites).set({ framework: fw.label, updatedAt: new Date() }).where(eq(schema.agentNickSites.id, s.siteId));
    if (!fw.supported) {
      throw new Halt(
        `${fw.label} isn't supported yet. Agent Nick writes code for Next.js (App and Pages Router), React single-page apps and static HTML today.`
      );
    }
    await r.done("framework", `${fw.label}${fw.root ? ` in /${fw.root}` : ""}${fw.typescript ? " · TypeScript" : ""}`, fw);
    return { framework: fw };
  });

  const pages = step("pages", "Finding pages", async (s, r) => {
    const { reader } = await repo(s);
    const found = discoverPages(reader, s.framework);
    if (!found.length) throw new Halt("No pages found in this app.");
    await r.update({ pagesFound: found.length });
    await r.done("pages", `${found.length} page${found.length === 1 ? "" : "s"}`, { routes: found.map((p) => p.route).slice(0, 40) });
    return { pages: found };
  });

  const actions = step("actions", "Finding forms, buttons, API calls and server actions", async (s, r) => {
    const { reader } = await repo(s);
    const digests = await digestPages(reader, s.framework, s.pages);
    const n = countActions(digests);
    if (!n) throw new Halt("No user actions (forms, buttons, API calls) found to turn into tools.");
    await r.update({ actionsFound: n });
    const forms = digests.reduce((a, d) => a + d.forms.length, 0);
    await r.done("actions", `${n} actions on ${digests.length} pages (${forms} forms)`, {
      perPage: digests.map((d) => ({ route: d.route, forms: d.forms.length, buttons: d.buttons.length, calls: d.calls.length, serverActions: d.serverActions.length }))
    });
    return { digests };
  });

  const propose = step("propose", "Proposing tools with Gemini", async (s, r, llm) => {
    const row = await site(s);
    const tools = await proposeTools(llm, row.repoFullName, s.digests);
    if (!tools.length) throw new Halt("Gemini found nothing worth exposing as a tool on this site.");
    const inserted = await db
      .insert(schema.agentNickTools)
      .values(
        tools.map((t) => ({
          runId: s.runId,
          siteId: s.siteId,
          page: t.page,
          name: t.name,
          kind: t.kind,
          description: t.description,
          inputSchema: t.inputSchema,
          risk: t.risk,
          readOnly: t.readOnly,
          consequential: t.consequential,
          auth: t.auth,
          source: { sourceId: t.sourceId, strategy: t.strategy, rationale: t.rationale }
        }))
      )
      .onConflictDoNothing()
      .returning({ id: schema.agentNickTools.id, name: schema.agentNickTools.name });
    const ids = new Map(inserted.map((x) => [x.name, x.id]));
    const withIds = tools.map((t) => ({ ...t, id: ids.get(t.name) ?? "" }));
    await r.update({ toolsProposed: tools.length });
    await r.done("propose", `${tools.length} tools proposed (${tools.filter((t) => t.kind === "form").length} from existing forms)`);
    await r.wait("review", "Waiting for your review: approve tools, set who may use them, pick a plan.", "awaiting_review");
    await db.update(schema.agentNickSites).set({ status: "awaiting_review", updatedAt: new Date() }).where(eq(schema.agentNickSites.id, s.siteId));
    return { tools: withIds };
  });

  // Not wrapped in step(): it must not report "start" again when the graph resumes.
  const review = async (s: S): Promise<U> => {
    const decision = interrupt({ type: "review", runId: s.runId }) as ReviewDecision;
    const r = new RunReporter(db, s.runId);
    const byId = new Map(decision.tools.map((t) => [t.id, t]));
    const approved = s.tools
      .filter((t) => t.id && byId.get(t.id)?.approved)
      .map((t) => ({ ...t, auth: byId.get(t.id ?? "")?.auth ?? t.auth }));
    await db.update(schema.agentNickRuns).set({ status: "running", toolsApproved: approved.length, decision, updatedAt: new Date() }).where(eq(schema.agentNickRuns.id, s.runId));
    if (!approved.length) {
      await r.fail("review", "No tools were approved, so there is nothing to write.");
      return { halted: "nothing approved", approved };
    }
    await r.done("review", `${approved.length} of ${s.tools.length} tools approved`);
    return { approved };
  };

  const write = step("write", "Writing the code", async (s, r, llm) => {
    const { reader } = await repo(s);
    const { handlers, failed } = await writeHandlers(llm, s.approved, s.digests);
    const usable = s.approved.filter((t) => !failed.some((f) => f.name === t.name));
    const gen = await generateCode({ reader, fw: s.framework, digests: s.digests, tools: usable, handlers });
    const skipped = [...gen.skipped, ...failed.map((f) => ({ name: f.name, reason: `Generated code failed checks: ${f.issues.join("; ")}` }))];
    await r.done("write", `${gen.changes.length} files (${gen.changes.filter((c) => c.before === null).length} new)`, {
      files: gen.changes.map((c) => ({ path: c.path, new: c.before === null, reason: c.reason })),
      skipped
    });
    return { handlers, changes: gen.changes, toolFiles: gen.toolFiles, manualSteps: gen.manualSteps, skipped };
  });

  const validate = step("validate", "Checking every changed file", async (s, r) => {
    const { reader } = await repo(s);
    let tools = s.approved.filter((t) => !s.skipped.some((k) => k.name === t.name));
    let { changes, toolFiles, manualSteps } = s;
    const skipped = [...s.skipped];
    // Drop the tools behind any file that fails, regenerate, and re-check (twice at most).
    for (let round = 0; round < 2; round++) {
      const problems = validateChanges(changes);
      if (!problems.length) break;
      const bad = new Set(problems.map((p) => p.path));
      const drop = tools.filter((t) => bad.has(toolFiles[t.name] ?? ""));
      for (const t of drop) skipped.push({ name: t.name, reason: `Failed checks in ${toolFiles[t.name]}: ${problems.find((p) => p.path === toolFiles[t.name])?.issues.join("; ")}` });
      tools = tools.filter((t) => !drop.includes(t));
      if (!drop.length) throw new Error(`Generated files failed checks: ${problems.map((p) => `${p.path}: ${p.issues.join("; ")}`).join(" | ")}`);
      const gen = await generateCode({ reader, fw: s.framework, digests: s.digests, tools, handlers: s.handlers });
      ({ changes, toolFiles, manualSteps } = gen);
    }
    if (!changes.length || !tools.length) throw new Halt("None of the approved tools passed the checks.");
    const stat = diffStat(changes);
    await r.update({ filesChanged: changes.length, additions: stat.additions, deletions: stat.deletions, toolsApproved: tools.length });
    await r.done("validate", `All ${changes.length} files parse; tools follow the WebMCP rules`, { ...stat, skipped: skipped.map((k) => k.name) });
    return { approved: tools, changes, toolFiles, manualSteps, skipped };
  });

  const pr = step("pr", "Opening a pull request", async (s, r) => {
    const { gh, site: row } = await repo(s);
    const branch = `agentronics/agent-nick-${s.runId.slice(0, 8)}`;
    const title = `Make this site agent-ready: ${s.approved.length} WebMCP tool${s.approved.length === 1 ? "" : "s"}`;
    const body = prBody({
      fw: s.framework,
      tools: s.approved,
      changes: s.changes,
      manualSteps: s.manualSteps,
      skipped: s.skipped,
      runUrl: deps.consoleUrl ? `${deps.consoleUrl}/agent-nick/runs/${s.runId}` : null
    });

    for (const t of s.approved) {
      if (!t.id) continue;
      await db.update(schema.agentNickTools).set({ filePath: s.toolFiles[t.name] ?? null }).where(eq(schema.agentNickTools.id, t.id));
    }
    const notApproved = s.tools.filter((t) => t.id && !s.approved.some((a) => a.id === t.id)).map((t) => t.id as string);
    if (notApproved.length) {
      await db.update(schema.agentNickTools).set({ approved: false }).where(and(eq(schema.agentNickTools.runId, s.runId), inArray(schema.agentNickTools.id, notApproved)));
    }

    if (deps.dryRun) {
      await r.update({ status: "ready", branch, finishedAt: new Date() });
      await db.update(schema.agentNickSites).set({ status: "ready", updatedAt: new Date() }).where(eq(schema.agentNickSites.id, s.siteId));
      await r.done("pr", `Dry run: ${s.changes.length} files ready, nothing pushed to GitHub`, {
        title,
        body,
        files: s.changes.map((c) => ({ path: c.path, content: c.content.slice(0, 20_000) }))
      });
      return {};
    }

    const opened = await openPullRequest({
      gh,
      fullName: row.repoFullName,
      baseBranch: row.defaultBranch,
      baseSha: s.baseSha,
      baseTreeSha: s.baseTreeSha,
      branch,
      title,
      body,
      changes: s.changes
    });
    await r.update({
      status: "pr_open",
      step: "ci",
      branch,
      prNumber: opened.number,
      prUrl: opened.url,
      headSha: opened.headSha,
      ciStatus: "pending",
      ...(opened.additions !== null ? { additions: opened.additions } : {}),
      ...(opened.deletions !== null ? { deletions: opened.deletions } : {}),
      ...(opened.changedFiles !== null ? { filesChanged: opened.changedFiles } : {})
    });
    await db.update(schema.agentNickSites).set({ status: "pr_open", updatedAt: new Date() }).where(eq(schema.agentNickSites.id, s.siteId));
    await r.done("pr", `Pull request #${opened.number} opened`, { url: opened.url, branch });
    await r.info("ci", "Waiting for your CI checks on the pull request.");
    return {};
  });

  const next = (to: string) => (s: S) => (s.halted ? END : to);

  return new StateGraph(State)
    .addNode("read_code", read)
    .addNode("detect_framework", framework)
    .addNode("find_pages", pages)
    .addNode("find_actions", actions)
    .addNode("propose_tools", propose)
    .addNode("review", review)
    .addNode("write_code", write)
    .addNode("validate_code", validate)
    .addNode("open_pr", pr)
    .addEdge(START, "read_code")
    .addConditionalEdges("read_code", next("detect_framework"), ["detect_framework", END])
    .addConditionalEdges("detect_framework", next("find_pages"), ["find_pages", END])
    .addConditionalEdges("find_pages", next("find_actions"), ["find_actions", END])
    .addConditionalEdges("find_actions", next("propose_tools"), ["propose_tools", END])
    .addConditionalEdges("propose_tools", next("review"), ["review", END])
    .addConditionalEdges("review", next("write_code"), ["write_code", END])
    .addConditionalEdges("write_code", next("validate_code"), ["validate_code", END])
    .addConditionalEdges("validate_code", next("open_pr"), ["open_pr", END])
    .addEdge("open_pr", END)
    .compile({ checkpointer });
}

export type Pipeline = ReturnType<typeof buildPipeline>;

/** Start a run, or resume it with the customer's review decision. */
export async function drive(
  pipeline: Pipeline,
  db: Db,
  run: { id: string; tenantId: string; siteId: string },
  resume?: ReviewDecision
): Promise<void> {
  const config = { configurable: { thread_id: run.id } };
  try {
    if (resume) await pipeline.invoke(new Command({ resume }), config);
    else await pipeline.invoke({ runId: run.id, tenantId: run.tenantId, siteId: run.siteId, halted: null }, config);
  } catch (err) {
    const msg = `Run crashed: ${err instanceof Error ? err.message : String(err)}`;
    await db
      .update(schema.agentNickRuns)
      .set({ status: "failed", error: msg.slice(0, 2000), finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.agentNickRuns.id, run.id));
    await db.update(schema.agentNickSites).set({ status: "failed", updatedAt: new Date() }).where(eq(schema.agentNickSites.id, run.siteId));
    return;
  }
  const [row] = await db.select({ status: schema.agentNickRuns.status }).from(schema.agentNickRuns).where(eq(schema.agentNickRuns.id, run.id));
  if (row?.status === "failed") {
    await db.update(schema.agentNickRuns).set({ finishedAt: new Date() }).where(eq(schema.agentNickRuns.id, run.id));
    await db.update(schema.agentNickSites).set({ status: "failed", updatedAt: new Date() }).where(eq(schema.agentNickSites.id, run.siteId));
  }
}
