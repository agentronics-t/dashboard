import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { rawPath, type ConnectorSource } from "@agentronics/intel-schema";
import { schema, type Db } from "@agentronics/intel-schema/db";
import type { AdapterRegistry } from "./connectors/registry.ts";
import { computeWindow } from "./connectors/types.ts";
import { toRawRows, writeRawParquet } from "./lib/parquet.ts";
import type { SecretReader } from "./lib/secrets.ts";
import type { ObjectStorage } from "./lib/storage.ts";
import type { MlTrigger } from "./mlTrigger.ts";
import { endRequestSpan, startRequestSpan } from "./otel.ts";

/** Cloud Tasks attempts beyond this mark the job permanently failed. */
const MAX_TASK_RETRIES = 4;

/** Jobs stuck in `running` longer than this are failed by the watchdog. */
const STUCK_JOB_HOURS = 2;

export interface WorkerDeps {
  db: Db;
  storage: ObjectStorage;
  secrets: SecretReader;
  ml: MlTrigger;
  adapters: AdapterRegistry;
  now?: () => Date;
  /** Raw sdk_events (and finished jobs) older than this are pruned. Default 90. */
  retentionDays?: number;
}

const taskBody = z.object({
  job_id: z.string().uuid(),
  /** W3C trace context from the API — joins the end-to-end trace. */
  traceparent: z.string().optional()
});

export function buildServer(deps: WorkerDeps) {
  const { db, storage, secrets, ml, adapters } = deps;
  const now = deps.now ?? (() => new Date());
  const retentionDays = deps.retentionDays ?? 90;

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      formatters: {
        level(label) {
          return { severity: label.toUpperCase() };
        }
      }
    },
    genReqId: (req) =>
      (req.headers["x-request-id"] as string | undefined) ?? randomUUID()
  });

  // /healthz is intercepted by Google's frontend on run.app — /health is the
  // externally reachable check; /healthz kept for local/docker use.
  const health = async () => ({ status: "ok", service: "intel-worker" });
  app.get("/health", health);
  app.get("/healthz", health);

  // traceparent arrives as a task header (set by the API at enqueue time), so
  // the request span joins the API's trace via normal W3C extraction.
  app.addHook("onRequest", async (req) => startRequestSpan(req));
  app.addHook("onResponse", async (req, reply) => endRequestSpan(req, reply));

  // Cloud Tasks HTTP target. Infra-level auth: the service is deployed
  // --no-allow-unauthenticated and only the intel-api SA holds run.invoker,
  // so only OIDC-signed Cloud Tasks requests arrive here.
  app.post("/tasks/import", async (req, reply) => {
    const parsed = taskBody.safeParse(req.body);
    if (!parsed.success) {
      // malformed payload will never become valid — ack so Tasks stops retrying
      req.log.error({ body: req.body }, "malformed task payload — dropped");
      return reply.status(200).send({ outcome: "dropped_malformed" });
    }
    const jobId = parsed.data.job_id;
    const retryCount = Number(req.headers["x-cloudtasks-taskretrycount"] ?? 0);
    const log = req.log.child({ jobId, retryCount });

    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    if (!job) {
      log.error("unknown job — dropped");
      return reply.status(200).send({ outcome: "dropped_unknown_job" });
    }
    if (job.type !== "import") {
      log.error({ type: job.type }, "not an import job — dropped");
      return reply.status(200).send({ outcome: "dropped_wrong_type" });
    }
    // Idempotency: a retried task for a finished job is a no-op.
    if (job.status === "succeeded") {
      log.info("job already succeeded — no-op");
      return reply.status(200).send({ outcome: "already_succeeded" });
    }
    if (job.status === "failed") {
      log.info("job already failed permanently — no-op");
      return reply.status(200).send({ outcome: "already_failed" });
    }

    await db
      .update(schema.jobs)
      .set({
        status: "running",
        attempt: job.attempt + 1,
        startedAt: now(),
        error: null
      })
      .where(eq(schema.jobs.id, jobId));

    try {
      if (!job.connectorId) throw new Error("import job has no connector");
      const [connector] = await db
        .select()
        .from(schema.connectors)
        .where(eq(schema.connectors.id, job.connectorId));
      if (!connector) throw new Error(`connector ${job.connectorId} not found`);
      if (!connector.secretRef) throw new Error("connector has no secret_ref");

      const source = connector.type as ConnectorSource;
      const adapter = adapters[source];
      const secret = await secrets.read(connector.secretRef);
      const config = (connector.config ?? {}) as Record<string, unknown>;
      const window = computeWindow(config, { now: now() });

      const records = await adapter.pull({
        config,
        secret,
        window,
        log: (msg, extra) => log.info(extra ?? {}, msg)
      });

      const gcsPaths: { raw: string[] } = { raw: [] };
      if (records.length > 0) {
        const rows = toRawRows({ records, jobId, source, ingestedAt: now() });
        const key = rawPath({
          source,
          tenantId: job.tenantId,
          dt: now().toISOString().slice(0, 10),
          jobId
        });
        await storage.put(key, await writeRawParquet(rows));
        gcsPaths.raw.push(storage.uri(key));
        log.info({ key, records: records.length }, "raw parquet written");
      } else {
        log.warn("no records in window — nothing written");
      }

      await db
        .update(schema.jobs)
        .set({ gcsPaths })
        .where(eq(schema.jobs.id, jobId));

      // Trigger ML stage. Until the intel-ml job is deployed (STEP 6), a
      // NOT_FOUND here must not fail the import — the data is safely in raw/.
      const traceparent =
        parsed.data.traceparent ??
        (typeof req.headers.traceparent === "string"
          ? req.headers.traceparent
          : undefined);
      try {
        await ml.trigger(jobId, traceparent);
        log.info("ml job triggered");
      } catch (err) {
        const code = (err as { code?: number }).code;
        if (code === 5 /* NOT_FOUND */) {
          log.warn("intel-ml job not deployed yet — skipping trigger");
        } else {
          throw err;
        }
      }

      await db
        .update(schema.jobs)
        .set({ status: "succeeded", finishedAt: now() })
        .where(eq(schema.jobs.id, jobId));
      log.info("import succeeded");
      return reply.status(200).send({ outcome: "succeeded", records_path: gcsPaths });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const exhausted = retryCount >= MAX_TASK_RETRIES;
      await db
        .update(schema.jobs)
        .set(
          exhausted
            ? { status: "failed", error: message, finishedAt: now() }
            : { status: "queued", error: message }
        )
        .where(eq(schema.jobs.id, jobId));

      if (exhausted) {
        log.error({ err: message }, "import failed permanently — retries exhausted");
        await writePipelineFailureInsight(job.tenantId, jobId, message);
        // 200 acks the task so Cloud Tasks stops retrying a permanent failure
        return reply.status(200).send({ outcome: "failed_permanently" });
      }
      log.error({ err: message }, "import attempt failed — Cloud Tasks will retry");
      return reply.status(500).send({ outcome: "retry" });
    }
  });

  // Watchdog (Cloud Scheduler, hourly): fail jobs stuck in `running` > 2h.
  // Infra-level auth like /tasks/import — only OIDC-verified SAs reach here.
  app.post("/tasks/watchdog", async (req) => {
    const cutoff = new Date(now().getTime() - STUCK_JOB_HOURS * 60 * 60 * 1000);
    const stuck = await db
      .update(schema.jobs)
      .set({
        status: "failed",
        error: `watchdog: stuck in running > ${STUCK_JOB_HOURS}h`,
        finishedAt: now()
      })
      .where(
        and(eq(schema.jobs.status, "running"), lt(schema.jobs.startedAt, cutoff))
      )
      .returning({ id: schema.jobs.id, tenantId: schema.jobs.tenantId });

    for (const job of stuck) {
      await writePipelineFailureInsight(
        job.tenantId,
        job.id,
        `Job was stuck in running for over ${STUCK_JOB_HOURS} hours and was marked failed by the watchdog.`
      );
    }
    if (stuck.length > 0) {
      req.log.warn({ jobs: stuck.map((j) => j.id) }, "watchdog failed stuck jobs");
    }
    return { checked_at: now().toISOString(), failed: stuck.length };
  });

  // Retention (Cloud Scheduler, daily): prune raw sdk_events past RETENTION_DAYS
  // (the sdk_event_daily rollups that power charts are kept), and drop finished
  // job rows past the same window so the jobs table stays bounded. Same private
  // OIDC path as the watchdog. The rollups/forecasts/insights are unaffected.
  app.post("/tasks/prune", async (req) => {
    const cutoff = new Date(now().getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const events = await db
      .delete(schema.sdkEvents)
      .where(lt(schema.sdkEvents.ingestedAt, cutoff))
      .returning({ id: schema.sdkEvents.id });

    const jobs = await db
      .delete(schema.jobs)
      .where(
        and(
          inArray(schema.jobs.status, ["succeeded", "failed"]),
          lt(schema.jobs.finishedAt, cutoff)
        )
      )
      .returning({ id: schema.jobs.id });

    const result = {
      cutoff: cutoff.toISOString(),
      retention_days: retentionDays,
      pruned_events: events.length,
      pruned_jobs: jobs.length
    };
    req.log.info(result, "prune complete");
    return result;
  });

  /** Dead-letter visibility: permanent failures surface in the insights feed. */
  async function writePipelineFailureInsight(
    tenantId: string,
    jobId: string,
    message: string
  ): Promise<void> {
    await db
      .insert(schema.insights)
      .values({
        tenantId,
        jobId,
        kind: "pipeline_failure",
        title: "Data import failed",
        bodyMd:
          `An import job failed permanently and needs attention.\n\n` +
          `**Job:** \`${jobId}\`\n**Error:** ${message.slice(0, 500)}`,
        severity: "critical"
      })
      .onConflictDoUpdate({
        target: [schema.insights.jobId, schema.insights.kind],
        set: { bodyMd: `Job \`${jobId}\` failed: ${message.slice(0, 500)}` }
      });
  }

  return app;
}
