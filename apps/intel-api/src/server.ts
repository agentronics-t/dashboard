import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  sdkTraceBatch,
  sdkToolsPush,
  sdkMemoryPush,
  type SdkEventType,
  type SdkEventOutcome
} from "@agentronics/intel-schema";
import { schema, type Db } from "@agentronics/intel-schema/db";
import {
  AuthError,
  generateIngestKey,
  hashIngestKey,
  isIngestKey,
  type AuthVerifier,
  type InternalVerifier
} from "./auth.ts";
import { registerIntelligenceRoutes, type IntelligenceDeps } from "./intelligence.ts";
import { endRequestSpan, startRequestSpan } from "./otel.ts";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
    tenantId: string;
    /** true for service-to-service callers (Cloud Scheduler) — maintenance (+ imports if enabled) */
    internal: boolean;
    /** true for SDK ingest-key callers — POST /v1/sdk/{events,tools,memory} only */
    sdkIngest: boolean;
  }
}

export interface ServerDeps {
  db: Db;
  auth: AuthVerifier;
  /** Optional Google-OIDC path for Cloud Scheduler (STEP 8). */
  internalAuth?: InternalVerifier | undefined;
  /**
   * Retired intelligence routes (connectors/imports/jobs). Only mounted when
   * provided — i.e. ENABLE_INTELLIGENCE=true. Off by default.
   */
  intelligence?: IntelligenceDeps | undefined;
  /** Raw sdk_events older than this are pruned. Default 90. */
  retentionDays?: number;
  /** Clock seam for tests. */
  now?: () => Date;
}

export function buildServer(deps: ServerDeps) {
  const { db, auth, internalAuth, intelligence, retentionDays = 90, now = () => new Date() } = deps;

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
  app.decorateRequest("sdkIngest", false);

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

      // SDK ingest-key path — resolve tenant from the hashed key; no Clerk call.
      if (isIngestKey(token)) {
        const [key] = await db
          .select({
            id: schema.sdkIngestKeys.id,
            tenantId: schema.sdkIngestKeys.tenantId
          })
          .from(schema.sdkIngestKeys)
          .where(
            and(
              eq(schema.sdkIngestKeys.hashedKey, hashIngestKey(token)),
              isNull(schema.sdkIngestKeys.revokedAt)
            )
          );
        if (!key) return reply.status(401).send({ error: "invalid_ingest_key" });
        req.sdkIngest = true;
        req.tenantId = key.tenantId;
        // best-effort last-used bump (don't await — never block ingest)
        void db
          .update(schema.sdkIngestKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(schema.sdkIngestKeys.id, key.id));
        return;
      }

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

    // Internal (Scheduler) callers may only run maintenance (and trigger
    // imports when intelligence is enabled); SDK ingest-key callers may only
    // push telemetry (events/tools/memory). Everything else needs a Clerk session.
    const SDK_INGEST_PATHS = ["/v1/sdk/events", "/v1/sdk/tools", "/v1/sdk/memory"];
    const INTERNAL_PATHS = ["/v1/maintenance/prune", ...(intelligence ? ["/v1/imports"] : [])];
    api.addHook("preHandler", async (req, reply) => {
      if (req.internal && !(req.method === "POST" && INTERNAL_PATHS.includes(req.url))) {
        return reply.status(403).send({ error: "internal_caller_restricted" });
      }
      if (req.sdkIngest && !(req.method === "POST" && SDK_INGEST_PATHS.includes(req.url))) {
        return reply.status(403).send({ error: "ingest_key_write_only" });
      }
      if (!req.internal && req.url.startsWith("/v1/maintenance/")) {
        return reply.status(403).send({ error: "internal_only" });
      }
    });

    if (intelligence) registerIntelligenceRoutes(api, db, intelligence);

    // ---- retention (Cloud Scheduler, daily; internal callers only) ---------
    // Prunes raw sdk_events past the retention window. The sdk_event_daily
    // rollups that power the console charts are kept. (Moved here from
    // intel-worker so a normal deploy is this one service.)
    api.post("/v1/maintenance/prune", async (req) => {
      const cutoff = new Date(now().getTime() - retentionDays * 24 * 60 * 60 * 1000);
      const events = await db
        .delete(schema.sdkEvents)
        .where(lt(schema.sdkEvents.ingestedAt, cutoff))
        .returning({ id: schema.sdkEvents.id });
      const result = {
        cutoff: cutoff.toISOString(),
        retention_days: retentionDays,
        pruned_events: events.length
      };
      req.log.info(result, "prune complete");
      return result;
    });

    // ---- SDK event stream ----------------------------------------------
    // Customer backends push TraceBatches here (Bearer agtx_ik_…). Raw events
    // are stored append-only (idempotent on event id); per-pillar rollups and
    // the tool-registry / site-memory snapshots are maintained at ingest.
    api.post("/v1/sdk/events", async (req, reply) => {
      const batch = sdkTraceBatch.parse(req.body);
      const tenantId = req.tenantId;

      // 1) raw append-only insert, idempotent on the SDK-provided event id
      const rows = batch.events.map((e) => ({
        id: e.id,
        tenantId,
        siteId: e.siteId,
        sessionId: e.sessionId,
        occurredAt: new Date(e.occurredAt),
        type: e.type,
        tool: e.tool ?? null,
        agentClass: e.agent?.class ?? null,
        agentVendor: e.agent?.vendor ?? null,
        trust: e.agent?.trust ?? null,
        outcome: e.outcome,
        durationMs: e.durationMs ?? null,
        page: typeof e.metadata.page === "string" ? e.metadata.page : null,
        protocol: typeof e.metadata.protocol === "string" ? e.metadata.protocol : null,
        error: e.error ?? null,
        metadata: e.metadata
      }));
      const inserted = await db
        .insert(schema.sdkEvents)
        .values(rows)
        .onConflictDoNothing({ target: schema.sdkEvents.id })
        .returning({ id: schema.sdkEvents.id });
      const accepted = inserted.length;

      // 2) daily rollups — fold the batch, then UPSERT-increment per key
      const counts = new Map<
        string,
        { date: string; type: SdkEventType; agentClass: string; outcome: SdkEventOutcome; n: number }
      >();
      for (const e of batch.events) {
        const date = e.occurredAt.slice(0, 10);
        const agentClass = e.agent?.class ?? "none";
        const k = `${date}|${e.type}|${agentClass}|${e.outcome}`;
        const cur = counts.get(k);
        if (cur) cur.n += 1;
        else counts.set(k, { date, type: e.type, agentClass, outcome: e.outcome, n: 1 });
      }
      for (const c of counts.values()) {
        await db
          .insert(schema.sdkEventDaily)
          .values({
            tenantId,
            date: c.date,
            type: c.type,
            agentClass: c.agentClass,
            outcome: c.outcome,
            count: c.n
          })
          .onConflictDoUpdate({
            target: [
              schema.sdkEventDaily.tenantId,
              schema.sdkEventDaily.date,
              schema.sdkEventDaily.type,
              schema.sdkEventDaily.agentClass,
              schema.sdkEventDaily.outcome
            ],
            set: {
              count: sql`${schema.sdkEventDaily.count} + ${c.n}`,
              updatedAt: new Date()
            }
          });
      }

      // Note: the tool registry + site-memory snapshot are NOT reconstructed
      // from trace metadata (real SDK traces are lightweight) — they're pushed
      // authoritatively via POST /v1/sdk/tools and /v1/sdk/memory below.
      return reply
        .status(202)
        .send({ ok: true, accepted, deduped: rows.length - accepted });
    });

    // ---- SDK tool registry (authoritative; from the SDK's syncTools()) -------
    api.post("/v1/sdk/tools", async (req, reply) => {
      const body = sdkToolsPush.parse(req.body);
      const tenantId = req.tenantId;
      for (const t of body.tools) {
        const row = {
          groupName: t.group ?? null,
          page: t.page ?? null,
          inputSchema: t.inputSchema ?? {},
          outputSchema: t.outputSchema ?? null,
          tokens: t.tokens ?? 0
        };
        await db
          .insert(schema.sdkToolRegistry)
          .values({ tenantId, siteId: body.siteId, toolName: t.name, ...row })
          .onConflictDoUpdate({
            target: [
              schema.sdkToolRegistry.tenantId,
              schema.sdkToolRegistry.siteId,
              schema.sdkToolRegistry.toolName
            ],
            set: { ...row, updatedAt: new Date() }
          });
      }
      return reply.status(202).send({ ok: true, tools: body.tools.length });
    });

    // ---- SDK site-memory snapshot (authoritative; from provideSiteMemory) ----
    api.post("/v1/sdk/memory", async (req, reply) => {
      const body = sdkMemoryPush.parse(req.body);
      const mem = { snapshot: body.snapshot, score: body.score ?? null };
      await db
        .insert(schema.sdkSiteMemory)
        .values({ tenantId: req.tenantId, siteId: body.siteId, ...mem })
        .onConflictDoUpdate({
          target: [schema.sdkSiteMemory.tenantId, schema.sdkSiteMemory.siteId],
          set: { ...mem, updatedAt: new Date() }
        });
      return reply.status(202).send({ ok: true, siteId: body.siteId });
    });

    // ---- SDK ingest-key management (Clerk session only) ----------------
    api.post("/v1/sdk/keys", async (req, reply) => {
      const body = z
        .object({ label: z.string().min(1).max(80).default("default") })
        .parse(req.body ?? {});
      const { raw, hash, prefix } = generateIngestKey();
      const [key] = await db
        .insert(schema.sdkIngestKeys)
        .values({ tenantId: req.tenantId, hashedKey: hash, prefix, label: body.label })
        .returning({
          id: schema.sdkIngestKeys.id,
          prefix: schema.sdkIngestKeys.prefix,
          label: schema.sdkIngestKeys.label,
          createdAt: schema.sdkIngestKeys.createdAt
        });
      // The raw key is returned exactly once — never retrievable again.
      return reply.status(201).send({
        id: key!.id,
        key: raw,
        prefix: key!.prefix,
        label: key!.label,
        created_at: key!.createdAt
      });
    });

    api.get("/v1/sdk/keys", async (req) => {
      const rows = await db
        .select({
          id: schema.sdkIngestKeys.id,
          prefix: schema.sdkIngestKeys.prefix,
          label: schema.sdkIngestKeys.label,
          created_at: schema.sdkIngestKeys.createdAt,
          last_used_at: schema.sdkIngestKeys.lastUsedAt,
          revoked_at: schema.sdkIngestKeys.revokedAt
        })
        .from(schema.sdkIngestKeys)
        .where(eq(schema.sdkIngestKeys.tenantId, req.tenantId))
        .orderBy(desc(schema.sdkIngestKeys.createdAt));
      return { keys: rows };
    });

    api.post("/v1/sdk/keys/:id/revoke", async (req, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const [row] = await db
        .update(schema.sdkIngestKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.sdkIngestKeys.id, params.id),
            eq(schema.sdkIngestKeys.tenantId, req.tenantId)
          )
        )
        .returning({ id: schema.sdkIngestKeys.id });
      if (!row) return reply.status(404).send({ error: "key_not_found" });
      return { ok: true };
    });
  });

  return app;
}
