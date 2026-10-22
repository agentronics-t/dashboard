// agent-nick: `node index.cjs` serves the API + GitHub webhook;
// `node index.cjs job <start|resume|fix> <runId>` runs one step (Cloud Run Job).

import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createDb } from "@agentronics/intel-schema/db";
import { clerkVerifier } from "./auth.ts";
import { loadEnv } from "./env.ts";
import { CloudRunJobExecutor, InlineExecutor, execute, type Executor, type JobAction } from "./executor.ts";
import { GitHub, GitHubApp } from "./github/client.ts";
import { Gemini } from "./llm/gemini.ts";
import { buildPipeline, type Pipeline } from "./pipeline/graph.ts";
import type { FollowupDeps } from "./pipeline/followup.ts";
import { buildServer } from "./server.ts";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);

const githubApp = new GitHubApp({
  appId: env.GITHUB_APP_ID,
  slug: env.GITHUB_APP_SLUG,
  privateKey: env.GITHUB_APP_PRIVATE_KEY,
  clientId: env.GITHUB_APP_CLIENT_ID,
  clientSecret: env.GITHUB_APP_CLIENT_SECRET,
  apiBase: env.GITHUB_API_URL
});
const devToken = env.DRY_RUN ? env.GITHUB_DEV_TOKEN : undefined;
const github = (installationId: number) =>
  devToken !== undefined ? new GitHub(devToken || null, env.GITHUB_API_URL) : githubApp.forInstallation(installationId);
const llm = () => new Gemini(env);

// LangGraph checkpoints live in their own Postgres schema, next to our tables.
let pipelinePromise: Promise<Pipeline> | undefined;
const pipeline = () =>
  (pipelinePromise ??= (async () => {
    const saver = PostgresSaver.fromConnString(env.DATABASE_URL, { schema: "agent_nick_graph" });
    await saver.setup();
    return buildPipeline({ db, github, llm, dryRun: env.DRY_RUN, consoleUrl: env.CONSOLE_URL ?? null }, saver);
  })());

let executor: Executor;
const followup: FollowupDeps = { db, github, llm, pipeline, dispatchFix: (runId) => executor.dispatch("fix", runId) };
const run = (action: JobAction, runId: string) => execute({ db, pipeline, followup }, action, runId);

const [, , mode, action, runId] = process.argv;
if (mode === "job") {
  if (!action || !["start", "resume", "fix"].includes(action) || !runId) {
    console.error("usage: job <start|resume|fix> <runId>");
    process.exit(2);
  }
  run(action as JobAction, runId).then(
    () => process.exit(0),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    }
  );
} else {
  const logger = { error: (o: object, msg: string) => console.error(JSON.stringify({ severity: "ERROR", msg, ...o })) };
  executor =
    env.EXECUTOR === "job"
      ? new CloudRunJobExecutor({ project: env.GCP_PROJECT, region: env.GCP_REGION, job: env.JOB_NAME }, logger)
      : new InlineExecutor(run, logger);

  const app = buildServer({
    db,
    auth: clerkVerifier({ issuer: env.CLERK_ISSUER, jwksUrl: env.CLERK_JWKS_URL }),
    app: githubApp,
    github,
    executor,
    followup,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    requirePlan: env.REQUIRE_PLAN,
    devAuth: env.DEV_AUTH
  });

  app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err, "failed to start agent-nick");
    process.exit(1);
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, async () => {
      app.log.info({ signal }, "shutting down");
      await app.close();
      await executor.drain();
      process.exit(0);
    });
  }
}
