import Fastify from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  sdkTraceBatch,
  sdkToolsPush,
  sdkMemoryPush,
  sdkConfigRequest,
  sdkAgentKeyVerify,
  type SdkPolicyRule,
  type SdkEventType,
  type SdkEventOutcome,
  DEFAULT_CONTRACT_RETENTION_DAYS,
  PLANS,
  PLAN_IDS,
  monthStart,
  resolvePlan,
  type PlanId
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
  /** Clock seam for tests. */
  now?: () => Date;
}

export function buildServer(deps: ServerDeps) {
  const { db, auth, internalAuth, intelligence, now = () => new Date() } = deps;

  // Plan + month-to-date usage per tenant, cached briefly so busy sites don't
  // add two queries to every ingest batch.
  const quotaCache = new Map<string, { at: number; plan: PlanId; used: number }>();
  async function monthlyQuota(tenantId: string) {
    let hit = quotaCache.get(tenantId);
    if (!hit || Date.now() - hit.at > 30_000) {
      const [row] = await db.select().from(schema.workspacePlans).where(eq(schema.workspacePlans.tenantId, tenantId));
      const [usage] = await db
        .select({ n: sql<number>`coalesce(sum(${schema.sdkEventDaily.count}), 0)::bigint` })
        .from(schema.sdkEventDaily)
        .where(and(eq(schema.sdkEventDaily.tenantId, tenantId), gte(schema.sdkEventDaily.date, monthStart(now()).date)));
      hit = { at: Date.now(), plan: resolvePlan(row, now()), used: Number(usage?.n ?? 0) };
      quotaCache.set(tenantId, hit);
    }
    const limit = PLANS[hit.plan].limits.requestsPerMonth;
    const room = limit === null ? null : Math.max(0, limit - hit.used);
    return {
      room,
      /** Count what we're about to store so the cache stays close between refreshes. */
      info: { plan: hit.plan, limit, used: hit.used },
      take: (n: number) => {
        if (hit) hit.used += n;
      }
    };
  }

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
    const SDK_INGEST_PATHS = [
      "/v1/sdk/events",
      "/v1/sdk/tools",
      "/v1/sdk/memory",
      "/v1/sdk/config",
      "/v1/sdk/agent-keys/verify"
    ];
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
      // Each workspace keeps raw events for its plan's retention window.
      const at = now();
      const days = (id: PlanId) => PLANS[id].limits.retentionDays ?? DEFAULT_CONTRACT_RETENTION_DAYS;
      const pruned = await db.execute<{ id: string }>(sql`
        DELETE FROM sdk_events e
        USING tenants t
        LEFT JOIN workspace_plans wp ON wp.tenant_id = t.id
        WHERE e.tenant_id = t.id
          AND e.ingested_at < ${at.toISOString()}::timestamptz - make_interval(days => (
            CASE
              WHEN wp.status = 'active' AND (wp.current_period_end IS NULL OR wp.current_period_end > ${at.toISOString()}::timestamptz)
              THEN CASE wp.plan
                WHEN 'starter' THEN ${days("starter")}
                WHEN 'pro' THEN ${days("pro")}
                WHEN 'enterprise' THEN ${days("enterprise")}
                ELSE ${days("free")}
              END
              ELSE ${days("free")}
            END)::int)
        RETURNING e.id`);
      const result = {
        at: at.toISOString(),
        retention_days: Object.fromEntries(PLAN_IDS.map((id) => [id, days(id)])),
        pruned_events: pruned.length
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

      // 0) plan quota: events recorded per UTC month. Never blocks agents —
      //    the SDK still gets a 202; events past the quota just aren't stored.
      const quota = await monthlyQuota(tenantId);
      const events = quota.room === null ? batch.events : batch.events.slice(0, quota.room);
      const dropped = batch.events.length - events.length;
      if (!events.length) {
        return reply.status(202).send({ ok: true, accepted: 0, deduped: 0, dropped, quota: quota.info });
      }

      // 1) raw append-only insert, idempotent on the SDK-provided event id
      const rows = events.map((e) => ({
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
      quota.take(accepted);

      // 2) daily rollups — fold the batch, then UPSERT-increment per key
      const counts = new Map<
        string,
        { date: string; type: SdkEventType; agentClass: string; outcome: SdkEventOutcome; n: number }
      >();
      for (const e of events) {
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

      // 3) WebMCP tool status: the browser reports each registration as a
      //    tool.surfaced event (state published | failed | enabled | disabled).
      //    The latest one per tool wins.
      const STATE_TO_STATUS: Record<string, string> = { published: "callable", enabled: "callable", failed: "failed", disabled: "disabled" };
      const latest = new Map<string, { siteId: string; tool: string; status: string; error: string | null; at: Date }>();
      for (const e of events) {
        if (e.type !== "tool.surfaced" || !e.tool) continue;
        const status = STATE_TO_STATUS[String(e.metadata.state ?? "")];
        if (!status) continue;
        const at = new Date(e.occurredAt);
        const k = `${e.siteId}|${e.tool}`;
        const cur = latest.get(k);
        if (!cur || cur.at <= at) latest.set(k, { siteId: e.siteId, tool: e.tool, status, error: e.error ?? null, at });
      }
      for (const t of latest.values()) {
        await db
          .update(schema.sdkToolRegistry)
          .set({ status: t.status, statusError: t.status === "failed" ? t.error : null, statusAt: t.at })
          .where(
            and(
              eq(schema.sdkToolRegistry.tenantId, tenantId),
              eq(schema.sdkToolRegistry.siteId, t.siteId),
              eq(schema.sdkToolRegistry.toolName, t.tool),
              sql`(${schema.sdkToolRegistry.statusAt} IS NULL OR ${schema.sdkToolRegistry.statusAt} <= ${t.at.toISOString()}::timestamptz)`
            )
          );
      }

      // Note: the tool registry + site-memory snapshot are NOT reconstructed
      // from trace metadata (real SDK traces are lightweight) — they're pushed
      // authoritatively via POST /v1/sdk/tools and /v1/sdk/memory below.
      return reply
        .status(202)
        .send({ ok: true, accepted, deduped: rows.length - accepted, ...(dropped ? { dropped, quota: quota.info } : {}) });
    });

    // ---- SDK tool registry (authoritative; from the SDK's syncTools()) -------
    api.post("/v1/sdk/tools", async (req, reply) => {
      const body = sdkToolsPush.parse(req.body);
      const tenantId = req.tenantId;
      for (const t of body.tools) {
        const row = {
          title: t.title ?? null,
          description: t.description ?? null,
          annotations: t.annotations ?? null,
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

    // ---- console-managed config the SDK pulls (createDashboardSync().pullConfig) ----
    // Authorization rules for this site (site-specific rules override "*" ones
    // for the same tool) + the tool descriptions approved in Procedural memory.
    api.post("/v1/sdk/config", async (req) => {
      const { siteId } = sdkConfigRequest.parse(req.body);
      const tenantId = req.tenantId;
      const rows = await db
        .select()
        .from(schema.sdkPolicies)
        .where(and(eq(schema.sdkPolicies.tenantId, tenantId), inArray(schema.sdkPolicies.siteId, ["*", siteId])));
      const byTool = new Map<string, (typeof rows)[number]>();
      for (const r of rows) if (!byTool.has(r.tool) || r.siteId !== "*") byTool.set(r.tool, r);
      // Most specific patterns first so "cart.checkout" beats "cart.*" beats "*".
      const specificity = (t: string) => (t === "*" ? 0 : t.includes("*") ? 1 : 2);
      const policies: SdkPolicyRule[] = [...byTool.values()]
        .sort((a, b) => specificity(b.tool) - specificity(a.tool) || b.tool.length - a.tool.length)
        .map((r) => {
          const rule: SdkPolicyRule = {
            id: `console:${r.id}`,
            tool: r.tool,
            decision: r.decision as SdkPolicyRule["decision"],
            minTrust: r.minTrust as SdkPolicyRule["minTrust"],
            allowedClasses: (r.allowedClasses as SdkPolicyRule["allowedClasses"]) ?? []
          };
          const rl = r.rateLimit as SdkPolicyRule["rateLimit"] | null;
          if (rl) rule.rateLimit = rl;
          return rule;
        });
      const descriptions = await db
        .select({ tool: schema.sdkToolDescriptions.toolName, text: schema.sdkToolDescriptions.suggested })
        .from(schema.sdkToolDescriptions)
        .where(
          and(
            eq(schema.sdkToolDescriptions.tenantId, tenantId),
            eq(schema.sdkToolDescriptions.siteId, siteId),
            eq(schema.sdkToolDescriptions.status, "approved")
          )
        );
      return {
        policies,
        toolDescriptions: Object.fromEntries(descriptions.map((d) => [d.tool, d.text])),
        fetchedAt: now().toISOString()
      };
    });

    // ---- live agent-key verification (createDashboardSync().keyVerifier) -------
    api.post("/v1/sdk/agent-keys/verify", async (req) => {
      const { key } = sdkAgentKeyVerify.parse(req.body);
      if (!key.startsWith("agk_")) return { valid: false };
      const hashedKey = createHash("sha256").update(key).digest("hex");
      const [row] = await db
        .select({ id: schema.agentKeys.id, agentId: schema.agentKeys.agentId, name: schema.agentKeys.name, vendor: schema.agentKeys.vendor })
        .from(schema.agentKeys)
        .where(and(eq(schema.agentKeys.tenantId, req.tenantId), eq(schema.agentKeys.hashedKey, hashedKey), isNull(schema.agentKeys.revokedAt)));
      if (!row) return { valid: false };
      // Last-used is display-only; don't let it slow the check.
      void db.update(schema.agentKeys).set({ lastUsedAt: now() }).where(eq(schema.agentKeys.id, row.id)).catch(() => undefined);
      return { valid: true, agentId: row.agentId, name: row.name, vendor: row.vendor };
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
