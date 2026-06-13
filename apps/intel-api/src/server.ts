import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { connectorSource } from "@agentronics/intel-schema";
import { schema, type Db } from "@agentronics/intel-schema/db";
import { AuthError, type AuthVerifier, type InternalVerifier } from "./auth.ts";
import type { SecretStore, TaskQueue } from "./gcp.ts";
import { endRequestSpan, startRequestSpan, traceparentFor } from "./otel.ts";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
    tenantId: string;
    /** true for service-to-service callers (Cloud Scheduler) — imports only */
    internal: boolean;
  }
}

export interface ServerDeps {
  db: Db;
  auth: AuthVerifier;
  tasks: TaskQueue;
  secrets: SecretStore;
  /** Optional Google-OIDC path for Cloud Scheduler (STEP 8). */
  internalAuth?: InternalVerifier | undefined;
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

export function buildServer(deps: ServerDeps) {
  const { db, auth, tasks, secrets, internalAuth } = deps;

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      formatters: {
        level(label) {
          return { severity: label.toUpperCase() };
        }
      },
      redact: ["req.headers.authorization"]
    },
    genReqId: (req) =>
      (req.headers["x-request-id"] as string | undefined) ?? randomUUID()
  });

  app.decorateRequest("userId", "");
  app.decorateRequest("tenantId", "");
  app.decorateRequest("internal", false);

  app.addHook("onRequest", async (req) => startRequestSpan(req));
  app.addHook("onResponse", async (req, reply) => endRequestSpan(req, reply));

  // NOTE: Google's frontend intercepts the literal path /healthz on run.app
  // URLs (returns its own 404, request never reaches the container). /health
  // is the externally reachable check; /healthz kept for local/docker use.
  const health = async () => ({ status: "ok", service: "intel-api" });
  app.get("/health", health);
  app.get("/healthz", health);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: "validation_failed", detail: err.issues });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "internal_error", request_id: req.id });
  });

  // ---- authenticated API ----
  app.register(async (api) => {
    api.addHook("preHandler", async (req, reply) => {
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        return reply.status(401).send({ error: "missing_bearer_token" });
      }
      const token = header.slice("Bearer ".length);
      let ctx;
      try {
        ctx = await auth.verify(token);
      } catch (err) {
        if (!(err instanceof AuthError)) throw err;
        // Not a Clerk session — try the service-to-service path (Scheduler).
        if (internalAuth) {
          try {
            const internal = await internalAuth.verify(token);
            req.internal = true;
            req.userId = `internal:${internal.email}`;
            return; // no tenant — internal routes resolve tenant per resource
          } catch (internalErr) {
            if (!(internalErr instanceof AuthError)) throw internalErr;
            req.log.info(
              { clerk: err.message, internal: internalErr.message },
              "auth rejected"
            );
            return reply.status(401).send({ error: "invalid_token" });
          }
        }
        req.log.info({ reason: err.message }, "auth rejected");
        return reply.status(401).send({ error: "invalid_token" });
      }

      // Resolve (or bootstrap) the tenant for this Clerk org.
      const [tenant] = await db
        .insert(schema.tenants)
        .values({ name: ctx.orgKey, clerkOrgId: ctx.orgKey })
        .onConflictDoUpdate({
          target: schema.tenants.clerkOrgId,
          set: { clerkOrgId: ctx.orgKey }
        })
        .returning({ id: schema.tenants.id });

      req.userId = ctx.userId;
      req.tenantId = (tenant as { id: string }).id;
    });

    // Internal (Scheduler) callers may only trigger imports.
    api.addHook("preHandler", async (req, reply) => {
      if (req.internal && !(req.method === "POST" && req.url === "/v1/imports")) {
        return reply.status(403).send({ error: "internal_caller_imports_only" });
      }
    });

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
        secretRef = await secrets.write(
          `connector-${req.tenantId}-${body.type}`,
          body.secret
        );
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
        .where(
          and(eq(schema.jobs.id, params.id), eq(schema.jobs.tenantId, req.tenantId))
        );
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
  });

  return app;
}
