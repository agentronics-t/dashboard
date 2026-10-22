// Run the whole Agent Nick pipeline on a public repo without the GitHub App and
// without pushing anything: reads anonymously (or with GITHUB_DEV_TOKEN),
// calls Gemini, auto-approves every proposed tool, and writes the files it
// would commit to ./dry-run-out/<owner>__<repo>/.
//
//   DATABASE_URL=… GCP_PROJECT=… GOOGLE_GENAI_SA_KEY=… \
//     node --experimental-strip-types scripts/dry-run.ts owner/repo
//
// Use a scratch database: it creates a "dev:dry-run" tenant and site rows.
// FAKE_LLM=1 swaps Gemini for a rule-based stand-in (no model calls), to test
// everything around the model.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { asc, eq } from "drizzle-orm";
import { createDb, schema } from "@agentronics/intel-schema/db";
import { GitHub } from "../src/github/client.ts";
import { Gemini, type JsonCall, type Llm } from "../src/llm/gemini.ts";
import { buildPipeline, drive } from "../src/pipeline/graph.ts";

const repoName = process.argv[2];
if (!repoName?.includes("/")) throw new Error("usage: dry-run.ts owner/repo");
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required (use a scratch database)");

const db = createDb(DATABASE_URL);
const gh = new GitHub(process.env.GITHUB_DEV_TOKEN || null);
const gemini = {
  GCP_PROJECT: process.env.GCP_PROJECT ?? "",
  VERTEX_LOCATION: process.env.VERTEX_LOCATION ?? "global",
  GEMINI_MODEL: process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
  GOOGLE_GENAI_SA_KEY: process.env.GOOGLE_GENAI_SA_KEY,
  GOOGLE_ACCESS_TOKEN: process.env.GOOGLE_ACCESS_TOKEN,
  GEMINI_PRICE_IN: 0.75,
  GEMINI_PRICE_OUT: 3.75
};

/** Proposes a tool per named form and per API call; writes a plain fetch body. */
class FakeLlm implements Llm {
  readonly usage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  async json<T>(call: JsonCall<T>): Promise<T> {
    if (call.prompt.startsWith("Site:")) {
      const digests = JSON.parse(call.prompt.slice(call.prompt.indexOf("["))) as {
        route: string;
        forms: { id: string; declarativeReady: boolean; submit: string | null; fields: { name: string | null }[] }[];
        calls: { id: string; method: string; url: string }[];
      }[];
      const tools = digests.flatMap((d) => [
        ...d.forms.map((f) => ({
          page: d.route,
          sourceId: f.id,
          name: `${(f.submit ?? "submit").toLowerCase().replace(/\W+/g, "_")}_${d.route.replace(/\W+/g, "_")}`,
          kind: f.declarativeReady ? "form" : "script",
          strategy: f.declarativeReady ? "form" : "dom",
          description: `Submit the ${f.submit ?? ""} form on ${d.route}.`,
          inputSchemaJson: JSON.stringify({ type: "object", properties: Object.fromEntries(f.fields.filter((x) => x.name).map((x) => [x.name, { type: "string", description: x.name }])) }),
          risk: "write",
          rationale: "fake"
        })),
        ...d.calls.map((c) => ({
          page: d.route,
          sourceId: c.id,
          name: `call_${c.method.toLowerCase()}_${c.id}`,
          kind: "script",
          strategy: "fetch",
          description: `${c.method} ${c.url}`,
          inputSchemaJson: '{"type":"object","properties":{}}',
          risk: c.method === "GET" ? "read" : "write",
          rationale: "fake"
        }))
      ]);
      return call.parse({ tools });
    }
    const tools = JSON.parse(call.prompt.slice(call.prompt.indexOf("["))) as { name: string; source: { url?: string; method?: string } | null }[];
    return call.parse({
      handlers: tools.map((t) => ({
        name: t.name,
        body: `try {\n  const res = await fetch(${JSON.stringify(t.source?.url?.startsWith("/") ? t.source.url : "/")}, { method: ${JSON.stringify(t.source?.method ?? "GET")}, signal });\n  return res.ok ? await res.json() : { error: \`Request failed (\${res.status})\` };\n} catch (err) {\n  if (signal?.aborted) throw err;\n  return { error: String(err) };\n}`
      }))
    });
  }
}
const makeLlm = (): Llm => (process.env.FAKE_LLM === "1" ? new FakeLlm() : new Gemini(gemini));

// DRY_RUN_TENANT=<uuid> attaches the run to an existing tenant (e.g. the console's demo tenant).
const [tenant] = process.env.DRY_RUN_TENANT
  ? [{ id: process.env.DRY_RUN_TENANT }]
  : await db
      .insert(schema.tenants)
      .values({ name: "dev:dry-run", clerkOrgId: "dev:dry-run" })
      .onConflictDoUpdate({ target: schema.tenants.clerkOrgId, set: { name: "dev:dry-run" } })
      .returning({ id: schema.tenants.id });
const repo = await gh.repo(repoName);
const [site] = await db
  .insert(schema.agentNickSites)
  .values({ tenantId: tenant!.id, installationId: 0, repoId: repo.id, repoFullName: repo.fullName, defaultBranch: repo.defaultBranch, isPrivate: repo.private })
  .onConflictDoUpdate({ target: [schema.agentNickSites.tenantId, schema.agentNickSites.repoId], set: { updatedAt: new Date() } })
  .returning({ id: schema.agentNickSites.id });
const [run] = await db.insert(schema.agentNickRuns).values({ tenantId: tenant!.id, siteId: site!.id }).returning();
await db.update(schema.agentNickSites).set({ lastRunId: run!.id, status: "running" }).where(eq(schema.agentNickSites.id, site!.id));

const saver = PostgresSaver.fromConnString(DATABASE_URL, { schema: "agent_nick_graph" });
await saver.setup();
const pipeline = buildPipeline({ db, github: () => gh, llm: makeLlm, dryRun: true, consoleUrl: null }, saver);
const ref = { id: run!.id, tenantId: tenant!.id, siteId: site!.id };

let shown = 0;
const printEvents = async () => {
  const events = await db.select().from(schema.agentNickEvents).where(eq(schema.agentNickEvents.runId, ref.id)).orderBy(asc(schema.agentNickEvents.id));
  for (const e of events.slice(shown)) console.log(`[${e.step}] ${e.kind.padEnd(5)} ${e.message}`);
  shown = events.length;
};

const t0 = Date.now();
await drive(pipeline, db, ref);
await printEvents();

const [paused] = await db.select().from(schema.agentNickRuns).where(eq(schema.agentNickRuns.id, ref.id));
// STOP_AT_REVIEW=1 leaves the run waiting for a review (to try the console's review screen).
if (paused?.status === "awaiting_review" && process.env.STOP_AT_REVIEW !== "1") {
  const tools = await db.select().from(schema.agentNickTools).where(eq(schema.agentNickTools.runId, ref.id));
  console.log(`\nProposed tools:`);
  for (const t of tools) console.log(`  - ${t.name} [${t.kind}/${(t.source as { strategy: string }).strategy}, ${t.risk}, ${t.auth}] on ${t.page}: ${t.description}`);
  console.log("\nAuto-approving all tools…\n");
  await drive(pipeline, db, ref, { tools: tools.map((t) => ({ id: t.id, approved: true, auth: t.auth as "public" })), approvedBy: "dev" });
  await printEvents();
}

const [final] = await db.select().from(schema.agentNickRuns).where(eq(schema.agentNickRuns.id, ref.id));
console.log(
  `\nstatus=${final?.status} pages=${final?.pagesFound} actions=${final?.actionsFound} tools=${final?.toolsProposed}/${final?.toolsApproved} files=${final?.filesChanged} +${final?.additions}/-${final?.deletions}`
);
console.log(`gemini: ${final?.tokensIn} in / ${final?.tokensOut} out tokens ≈ $${final?.costUsd.toFixed(4)} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const [prEvent] = (await db.select().from(schema.agentNickEvents).where(eq(schema.agentNickEvents.runId, ref.id))).filter((e) => e.step === "pr" && e.kind === "done");
const data = prEvent?.data as { body?: string; files?: { path: string; content: string }[] } | undefined;
if (data?.files) {
  const out = join("dry-run-out", repoName.replace("/", "__"));
  for (const f of data.files) {
    mkdirSync(dirname(join(out, f.path)), { recursive: true });
    writeFileSync(join(out, f.path), f.content);
  }
  writeFileSync(join(out, "PR.md"), data.body ?? "");
  console.log(`files written to ${out}/`);
}
await saver.end();
process.exit(0);
