// Public browser API for the SDK (/v1/pub/*), authenticated with publishable
// keys (agtx_pk_…). It replaces the retired gateway.agentronics.dev:
//
//   GET  /v1/pub/health                       key check (client.ping())
//   GET  /v1/pub/sites/:siteId/policies       authorization rules (syncPolicies)
//   GET  /v1/pub/sites/:siteId/memory         site-memory snapshot (syncSiteMemory)
//   GET  /v1/pub/sites/:siteId/config         rules + approved descriptions + memory
//   GET  /v1/pub/detector-signatures          detector signature updates
//   PUT  /v1/pub/sites/:siteId/tools          tool registry (syncTools)
//   POST /v1/pub/traces                       trace batches (trace.gateway)
//
// Publishable keys ship in page source, so: reads only return what agents are
// meant to see anyway (rules, tool text, site memory); writes are accepted only
// from the key's allowed origins and are rate-limited per key; GETs are cached
// with ETags.

import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { isPublishableKey, sdkToolDescriptor, sdkTraceBatch, type SdkToolDescriptor, type SdkTraceEvent } from "@agentronics/intel-schema";
import { schema, type Db } from "@agentronics/intel-schema/db";

export interface PublicDeps {
  db: Db;
  ingestEvents(tenantId: string, events: SdkTraceEvent[]): Promise<{ accepted: number; deduped: number; dropped: number }>;
  upsertTools(tenantId: string, siteId: string, tools: SdkToolDescriptor[]): Promise<void>;
  siteConfig(
    tenantId: string,
    siteId: string
  ): Promise<{ policies: unknown[]; toolDescriptions: Record<string, string>; siteMemory: Record<string, unknown> | null; fetchedAt: string }>;
  /** Writes per minute per key and visitor (client IP). Default 120. */
  writesPerMinute?: number;
  /** Writes per minute per key, all visitors together. Default 20000. */
  keyWritesPerMinute?: number;
}

interface ResolvedKey {
  id: string;
  tenantId: string;
  allowedOrigins: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    pubKey?: ResolvedKey;
  }
}

const siteParam = z.object({ siteId: z.string().min(1).max(120) });
const toolsBody = z.object({ registry: z.object({ tools: z.array(sdkToolDescriptor).max(1000) }) });
const MAX_EVENTS_PER_BATCH = 100;

const etagOf = (body: unknown) => `"${createHash("sha1").update(JSON.stringify(body)).digest("base64url")}"`;

/** Send `body` with an ETag; 304 when the caller already has it. */
function cached(req: FastifyRequest, reply: FastifyReply, body: unknown) {
  const etag = etagOf(body);
  reply.header("etag", etag).header("cache-control", "private, max-age=30");
  if (req.headers["if-none-match"] === etag) return reply.status(304).send();
  return reply.send(body);
}

/** The visitor's address: the first X-Forwarded-For hop (Cloud Run's front end sets it), else the socket. */
function clientIp(req: FastifyRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return first || req.ip || "unknown";
}

export function registerPublicRoutes(app: FastifyInstance, deps: PublicDeps) {
  const { db } = deps;
  const keyCache = new Map<string, { value: ResolvedKey | null; until: number }>();
  const writes = new Map<string, { windowStart: number; count: number }>();
  const writeLimit = deps.writesPerMinute ?? 120;
  const keyWriteLimit = deps.keyWritesPerMinute ?? 20_000;

  async function resolveKey(key: string): Promise<ResolvedKey | null> {
    const hit = keyCache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const [row] = await db
      .select({ id: schema.sdkPublishableKeys.id, tenantId: schema.sdkPublishableKeys.tenantId, allowedOrigins: schema.sdkPublishableKeys.allowedOrigins })
      .from(schema.sdkPublishableKeys)
      .where(and(eq(schema.sdkPublishableKeys.key, key), isNull(schema.sdkPublishableKeys.revokedAt)));
    const value = row ? { id: row.id, tenantId: row.tenantId, allowedOrigins: (row.allowedOrigins as string[]) ?? [] } : null;
    if (keyCache.size > 5000) keyCache.delete(keyCache.keys().next().value as string);
    keyCache.set(key, { value, until: Date.now() + 60_000 });
    if (value) void db.update(schema.sdkPublishableKeys).set({ lastUsedAt: new Date() }).where(eq(schema.sdkPublishableKeys.id, value.id)).catch(() => undefined);
    return value;
  }

  /** Writes: origin must be on the key's list, and stay under the per-key rate. */
  function writeAllowed(req: FastifyRequest, reply: FastifyReply): boolean {
    const key = req.pubKey!;
    const origin = req.headers.origin;
    if (!origin || !key.allowedOrigins.includes(origin)) {
      reply.status(403).send({ error: "origin_not_allowed", detail: "Add this site's origin to the publishable key in the console (Settings)." });
      return false;
    }
    // A publishable key is shared by every visitor of a site, so the limit is
    // per visitor (client IP) — one busy page can't use up a whole site's —
    // with a much higher ceiling for the key as a whole.
    const now = Date.now();
    const over = (id: string, limit: number) => {
      const w = writes.get(id);
      if (!w || now - w.windowStart > 60_000) {
        if (writes.size > 50_000) writes.clear();
        writes.set(id, { windowStart: now, count: 1 });
        return false;
      }
      return ++w.count > limit;
    };
    if (over(`${key.id}|${clientIp(req)}`, writeLimit) || over(key.id, keyWriteLimit)) {
      reply.status(429).header("retry-after", "60").send({ error: "rate_limited" });
      return false;
    }
    return true;
  }

  app.register(
    async (pub) => {
      // CORS: any origin may read with a valid key; writes are origin-checked above.
      pub.addHook("onRequest", async (req, reply) => {
        const origin = req.headers.origin;
        if (origin) {
          reply
            .header("access-control-allow-origin", origin)
            .header("vary", "Origin")
            .header("access-control-expose-headers", "etag");
        }
        if (req.method === "OPTIONS") {
          return reply
            .header("access-control-allow-methods", "GET, POST, PUT, OPTIONS")
            .header("access-control-allow-headers", "authorization, content-type, if-none-match")
            .header("access-control-max-age", "600")
            .status(204)
            .send();
        }
      });

      pub.addHook("preHandler", async (req, reply) => {
        if (req.method === "OPTIONS") return;
        const header = req.headers.authorization;
        const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
        if (!token || !isPublishableKey(token)) return reply.status(401).send({ error: "missing_publishable_key" });
        const key = await resolveKey(token);
        if (!key) return reply.status(401).send({ error: "invalid_publishable_key" });
        req.pubKey = key;
      });

      // Preflight for every path under /v1/pub.
      pub.options("/*", async () => undefined);

      pub.get("/health", async () => ({ status: "ok", service: "agentronics-api" }));

      pub.get("/sites/:siteId/config", async (req, reply) => {
        const { siteId } = siteParam.parse(req.params);
        const { fetchedAt: _f, ...config } = await deps.siteConfig(req.pubKey!.tenantId, siteId);
        return cached(req, reply, config);
      });

      pub.get("/sites/:siteId/policies", async (req, reply) => {
        const { siteId } = siteParam.parse(req.params);
        const { policies } = await deps.siteConfig(req.pubKey!.tenantId, siteId);
        return cached(req, reply, { policies });
      });

      pub.get("/sites/:siteId/memory", async (req, reply) => {
        const { siteId } = siteParam.parse(req.params);
        const { siteMemory } = await deps.siteConfig(req.pubKey!.tenantId, siteId);
        return cached(req, reply, { memory: siteMemory ?? {} });
      });

      // Detection rules ship inside the SDK; this feed carries updates between releases.
      pub.get("/detector-signatures", async (req, reply) => cached(req, reply, { signatures: [] }));

      pub.put("/sites/:siteId/tools", async (req, reply) => {
        if (!writeAllowed(req, reply)) return reply;
        const { siteId } = siteParam.parse(req.params);
        const { registry } = toolsBody.parse(req.body);
        await deps.upsertTools(req.pubKey!.tenantId, siteId, registry.tools);
        return reply.status(202).send({ ok: true, tools: registry.tools.length });
      });

      pub.post("/traces", async (req, reply) => {
        if (!writeAllowed(req, reply)) return reply;
        const batch = sdkTraceBatch.parse(req.body);
        const r = await deps.ingestEvents(req.pubKey!.tenantId, batch.events.slice(0, MAX_EVENTS_PER_BATCH));
        return reply.status(202).send({ ok: true, accepted: r.accepted, deduped: r.deduped, ...(r.dropped ? { dropped: r.dropped } : {}) });
      });
    },
    { prefix: "/v1/pub" }
  );
}
