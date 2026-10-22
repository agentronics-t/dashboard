// Where pipeline work runs. `inline` runs it in this process (local dev, or a
// Cloud Run service with CPU always allocated). `job` starts one Cloud Run Job
// execution per step — the same image, invoked as `node index.cjs job <action> <runId>`.

import { eq } from "drizzle-orm";
import { schema, type Db } from "@agentronics/intel-schema/db";
import { drive, type Pipeline } from "./pipeline/graph.ts";
import { attemptCiFix, type FollowupDeps } from "./pipeline/followup.ts";
import type { ReviewDecision } from "./pipeline/types.ts";

export type JobAction = "start" | "resume" | "fix";

type Logger = { error: (o: object, msg: string) => void };

export interface Executor {
  dispatch(action: JobAction, runId: string): void;
  /** Wait for in-flight inline work (graceful shutdown). */
  drain(): Promise<void>;
}

/** Run one action to completion — used by both executors and the job entrypoint. */
export async function execute(
  deps: { db: Db; pipeline: () => Promise<Pipeline>; followup: FollowupDeps },
  action: JobAction,
  runId: string
): Promise<void> {
  const [run] = await deps.db.select().from(schema.agentNickRuns).where(eq(schema.agentNickRuns.id, runId));
  if (!run) throw new Error(`run ${runId} not found`);
  if (action === "fix") return attemptCiFix(deps.followup, runId);
  const pipeline = await deps.pipeline();
  const ref = { id: run.id, tenantId: run.tenantId, siteId: run.siteId };
  if (action === "start") return drive(pipeline, deps.db, ref);
  if (!run.decision) throw new Error(`run ${runId} has no review decision to resume with`);
  return drive(pipeline, deps.db, ref, run.decision as ReviewDecision);
}

export class InlineExecutor implements Executor {
  private readonly inflight = new Set<Promise<void>>();
  private readonly busy = new Set<string>();
  private readonly run: (action: JobAction, runId: string) => Promise<void>;
  private readonly log: Logger;

  constructor(run: (action: JobAction, runId: string) => Promise<void>, log: Logger) {
    this.run = run;
    this.log = log;
  }

  dispatch(action: JobAction, runId: string) {
    if (this.busy.has(runId)) return; // a run never executes twice at once
    this.busy.add(runId);
    const p = this.run(action, runId)
      .catch((err: unknown) => this.log.error({ err, runId, action }, "agent nick step failed"))
      .finally(() => {
        this.busy.delete(runId);
        this.inflight.delete(p);
      });
    this.inflight.add(p);
  }

  async drain() {
    await Promise.allSettled([...this.inflight]);
  }
}

export class CloudRunJobExecutor implements Executor {
  private clientPromise: Promise<InstanceType<typeof import("@google-cloud/run").JobsClient>> | undefined;
  private readonly cfg: { project: string; region: string; job: string };
  private readonly log: Logger;

  constructor(cfg: { project: string; region: string; job: string }, log: Logger) {
    this.cfg = cfg;
    this.log = log;
  }

  dispatch(action: JobAction, runId: string) {
    this.clientPromise ??= import("@google-cloud/run").then(({ JobsClient }) => new JobsClient());
    void this.clientPromise
      .then((client) =>
        client.runJob({
          name: `projects/${this.cfg.project}/locations/${this.cfg.region}/jobs/${this.cfg.job}`,
          overrides: { containerOverrides: [{ args: ["index.cjs", "job", action, runId] }] }
        })
      )
      .catch((err: unknown) => this.log.error({ err, runId, action }, "could not start Cloud Run job"));
  }

  async drain() {}
}
