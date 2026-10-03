// Retired intelligence-platform routes (connectors → imports → jobs).
//
// Agentronics pivoted to agent authentication on 2026-09-30. These routes are
// kept but only mounted when ENABLE_INTELLIGENCE=true (off by default), so a
// normal deploy needs neither Cloud Tasks nor Secret Manager. See
// apps/dashboard/app/_intelligence/README.md for the matching UI.

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { connectorSource } from "@agentronics/intel-schema";
import { schema, type Db } from "@agentronics/intel-schema/db";
import type { SecretStore, TaskQueue } from "./gcp.ts";
import { traceparentFor } from "./otel.ts";

export interface IntelligenceDeps {
  tasks: TaskQueue;
  secrets: SecretStore;
}

const createImportBody = z.object({ connector_id: z.string().uuid() });

const createConnectorBody = z.object({
  type: connectorSource,
  config: z.record(z.string(), z.unknown()).default({}),
  /** Connector credential — written to Secret Manager, never stored in Neon. */
  secret: z.string().min(1).optional()
});

const listJobsQuery = z.object({
  tenant: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export function registerIntelligenceRoutes(
  api: FastifyInstance,
  db: Db,
  { tasks, secrets }: IntelligenceDeps
) {
  api.post("/v1/connectors", async (req, reply) => {
    const body = createConnectorBody.parse(req.body);

    const [connector] = await db
      .insert(schema.connectors)
      .values({ tenantId: req.tenantId, type: body.type, config: body.config })
      .onConflictDoUpdate({
        target: [schema.connectors.tenantId, schema.connectors.type],
        set: { config: body.config }
      })
      .returning();

    let secretRef = connector!.secretRef;
    if (body.secret) {
      secretRef = await secrets.write(`connector-${req.tenantId}-${body.type}`, body.secret);
      await db
        .update(schema.connectors)
        .set({ secretRef })
        .where(eq(schema.connectors.id, connector!.id));
    }

    req.log.info({ connectorId: connector!.id, type: body.type }, "connector upserted");
    return reply.status(201).send({
      id: connector!.id,
      type: connector!.type,
      config: connector!.config,
      secret_ref: secretRef
    });
  });

  api.get("/v1/connectors", async (req) => {
    const rows = await db
      .select({
        id: schema.connectors.id,
        type: schema.connectors.type,
        config: schema.connectors.config,
        secret_ref: schema.connectors.secretRef,
        created_at: schema.connectors.createdAt
      })
      .from(schema.connectors)
      .where(eq(schema.connectors.tenantId, req.tenantId));
    return { connectors: rows };
  });

  api.post("/v1/imports", async (req, reply) => {
    const body = createImportBody.parse(req.body);

    // Internal callers (Scheduler) carry no tenant — the connector defines it.
    const where = req.internal
      ? eq(schema.connectors.id, body.connector_id)
      : and(
          eq(schema.connectors.id, body.connector_id),
          eq(schema.connectors.tenantId, req.tenantId)
        );
    const [connector] = await db.select().from(schema.connectors).where(where);
    if (!connector) {
      return reply.status(404).send({ error: "connector_not_found" });
    }

    const [job] = await db
      .insert(schema.jobs)
      .values({
        tenantId: connector.tenantId,
        connectorId: connector.id,
        type: "import",
        status: "queued"
      })
      .returning({ id: schema.jobs.id });

    await tasks.enqueueImport(job!.id, traceparentFor(req));

    req.log.info({ jobId: job!.id, connectorId: connector.id }, "import enqueued");
    return reply.status(202).send({ job_id: job!.id });
  });

  api.get("/v1/jobs/:id", async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const [job] = await db
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.id, params.id), eq(schema.jobs.tenantId, req.tenantId)));
    if (!job) return reply.status(404).send({ error: "job_not_found" });
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      attempt: job.attempt,
      started_at: job.startedAt,
      finished_at: job.finishedAt,
      error: job.error,
      gcs_paths: job.gcsPaths,
      created_at: job.createdAt
    };
  });

  api.get("/v1/jobs", async (req, reply) => {
    const query = listJobsQuery.parse(req.query);
    // tenant scoping comes from auth; an explicit ?tenant= must match it
    if (query.tenant && query.tenant !== req.tenantId) {
      return reply.status(403).send({ error: "tenant_mismatch" });
    }
    const rows = await db
      .select({
        id: schema.jobs.id,
        type: schema.jobs.type,
        status: schema.jobs.status,
        created_at: schema.jobs.createdAt
      })
      .from(schema.jobs)
      .where(eq(schema.jobs.tenantId, req.tenantId))
      .orderBy(desc(schema.jobs.createdAt))
      .limit(query.limit);
    return { jobs: rows };
  });
}
