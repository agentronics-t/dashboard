// Console reads for agent authentication — all tenant-scoped, server-only.
// Source: sdk_events rows of type auth.identity_presented, written by the
// server SDK's toTraceEvent() and the browser SDK. Identity key =
// metadata.subject (verified agent id), else vendor, else session id.
import "server-only";
import { schema } from "@agentronics/intel-schema/db";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { db } from "./tenant";

const AUTH = "auth.identity_presented" as const;
const since = (days: number) => new Date(Date.now() - days * 86_400_000);

const e = schema.sdkEvents;
const identityExpr = sql<string>`coalesce(${e.metadata}->>'subject', ${e.agentVendor}, ${e.sessionId})`;

export interface AgentRow {
  identity: string;
  name: string;
  method: string | null;
  verified: boolean;
  requests: number;
  failures: number;
  firstSeen: Date;
  lastSeen: Date;
  lastError: string | null;
}

/** One row per agent identity seen in the window, most recent first. */
export async function getAgentDirectory(tenantId: string, days = 30, limit = 200): Promise<AgentRow[]> {
  const rows = await db()
    .select({
      identity: identityExpr,
      name: sql<string>`coalesce(max(${e.agentVendor}), max(${identityExpr}))`,
      method: sql<string | null>`(array_agg(${e.protocol} order by ${e.occurredAt} desc))[1]`,
      verified: sql<boolean>`bool_or(${e.outcome} = 'success' and ${e.trust} in ('verified','linked'))`,
      requests: sql<number>`count(*)::int`,
      failures: sql<number>`(count(*) filter (where ${e.outcome} <> 'success'))::int`,
      firstSeen: sql<Date>`min(${e.occurredAt})`,
      lastSeen: sql<Date>`max(${e.occurredAt})`,
      lastError: sql<string | null>`(array_agg(${e.error} order by ${e.occurredAt} desc) filter (where ${e.error} is not null))[1]`
    })
    .from(e)
    .where(and(eq(e.tenantId, tenantId), eq(e.type, AUTH), gte(e.occurredAt, since(days))))
    .groupBy(identityExpr)
    .orderBy(sql`max(${e.occurredAt}) desc`)
    .limit(limit);
  return rows.map((r) => ({ ...r, firstSeen: new Date(r.firstSeen), lastSeen: new Date(r.lastSeen) }));
}

export interface AuthSummary {
  verified: number;
  unverified: number;
  byMethod: { method: string; verified: number; failed: number }[];
  daily: { date: string; verified: number; unverified: number }[];
}

export async function getAuthSummary(tenantId: string, days = 7): Promise<AuthSummary> {
  const where = and(eq(e.tenantId, tenantId), eq(e.type, AUTH), gte(e.occurredAt, since(days)));
  const [totals] = await db()
    .select({
      verified: sql<number>`(count(*) filter (where ${e.outcome} = 'success'))::int`,
      unverified: sql<number>`(count(*) filter (where ${e.outcome} <> 'success'))::int`
    })
    .from(e)
    .where(where);
  const byMethod = await db()
    .select({
      method: sql<string>`coalesce(${e.protocol}, 'unknown')`,
      verified: sql<number>`(count(*) filter (where ${e.outcome} = 'success'))::int`,
      failed: sql<number>`(count(*) filter (where ${e.outcome} <> 'success'))::int`
    })
    .from(e)
    .where(where)
    .groupBy(sql`coalesce(${e.protocol}, 'unknown')`)
    .orderBy(sql`count(*) desc`);
  const daily = await db()
    .select({
      date: sql<string>`to_char(date_trunc('day', ${e.occurredAt}), 'YYYY-MM-DD')`,
      verified: sql<number>`(count(*) filter (where ${e.outcome} = 'success'))::int`,
      unverified: sql<number>`(count(*) filter (where ${e.outcome} <> 'success'))::int`
    })
    .from(e)
    .where(where)
    .groupBy(sql`date_trunc('day', ${e.occurredAt})`)
    .orderBy(sql`date_trunc('day', ${e.occurredAt})`);
  return {
    verified: totals?.verified ?? 0,
    unverified: totals?.unverified ?? 0,
    byMethod,
    daily
  };
}

export interface AuthLogRow {
  id: string;
  occurredAt: Date;
  identity: string;
  vendor: string | null;
  method: string | null;
  trust: string | null;
  outcome: string;
  page: string | null;
  error: string | null;
}

export type OutcomeFilter = "all" | "success" | "error";

export async function getAuthLogs(
  tenantId: string,
  opts: { outcome?: OutcomeFilter; agent?: string; limit?: number } = {}
): Promise<AuthLogRow[]> {
  const conds = [eq(e.tenantId, tenantId), eq(e.type, AUTH)];
  // Anything that isn't a success is unverified — including legacy 'blocked'
  // rows from SDK versions that had access rules (Agentronics never blocks now).
  if (opts.outcome === "success") conds.push(eq(e.outcome, "success"));
  if (opts.outcome === "error") conds.push(ne(e.outcome, "success"));
  if (opts.agent) conds.push(sql`${identityExpr} = ${opts.agent}`);
  return db()
    .select({
      id: e.id,
      occurredAt: e.occurredAt,
      identity: identityExpr,
      vendor: e.agentVendor,
      method: e.protocol,
      trust: e.trust,
      outcome: e.outcome,
      page: e.page,
      error: e.error
    })
    .from(e)
    .where(and(...conds))
    .orderBy(desc(e.occurredAt))
    .limit(Math.min(opts.limit ?? 200, 500));
}

/** Setup progress for the Overview checklist. */
export async function getSetupState(tenantId: string) {
  const [keys] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.sdkIngestKeys)
    .where(eq(schema.sdkIngestKeys.tenantId, tenantId));
  const [events] = await db()
    .select({
      any: sql<number>`count(*)::int`,
      verified: sql<number>`(count(*) filter (where ${e.outcome} = 'success'))::int`
    })
    .from(e)
    .where(and(eq(e.tenantId, tenantId), eq(e.type, AUTH)));
  return {
    ingestKey: (keys?.n ?? 0) > 0,
    receivingEvents: (events?.any ?? 0) > 0,
    verifiedAgent: (events?.verified ?? 0) > 0
  };
}

export async function getAgentKeys(tenantId: string) {
  return db()
    .select({
      id: schema.agentKeys.id,
      agentId: schema.agentKeys.agentId,
      name: schema.agentKeys.name,
      vendor: schema.agentKeys.vendor,
      hashedKey: schema.agentKeys.hashedKey,
      prefix: schema.agentKeys.prefix,
      createdAt: schema.agentKeys.createdAt,
      revokedAt: schema.agentKeys.revokedAt
    })
    .from(schema.agentKeys)
    .where(eq(schema.agentKeys.tenantId, tenantId))
    .orderBy(desc(schema.agentKeys.createdAt));
}

/** "2m ago", "3h ago", "Sep 28". */
export function ago(d: Date, now = new Date()): string {
  const s = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const METHOD_LABEL: Record<string, string> = {
  "web-bot-auth": "Web Bot Auth",
  "api-key": "API key",
  oauth2: "OAuth2",
  "verified-crawler": "Verified crawler",
  sso: "SSO / OIDC",
  spiffe: "SPIFFE",
  "google-agent": "Google agent",
  mtls: "mTLS",
  bearer: "Bearer token",
  extension: "Extension token",
  "session-link": "Session link",
  "x-agent-header": "X-Agent header",
  declaration: "Self-declared",
  detection: "Detection",
  none: "None",
  unknown: "No credential"
};
export const methodLabel = (m: string | null) => (m ? METHOD_LABEL[m] ?? m : "—");
