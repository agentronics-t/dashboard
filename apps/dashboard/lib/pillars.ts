// Per-pillar reads for the SDK pages (Detect, Auth, Authz, WebMCP Tools,
// Procedural memory, Observability, Analytics). Tenant-scoped, server-only.
import "server-only";
import { schema } from "@agentronics/intel-schema/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "./tenant";

const since = (days: number) => new Date(Date.now() - days * 86400_000);
const n = (v: unknown) => Number(v ?? 0);

// ---- Authentication -------------------------------------------------------------

/** The four methods we ship, in the order the Auth page shows them. */
export const AUTH_METHODS = [
  { id: "verified-crawler", label: "Verified crawlers", proves: "The crawler really belongs to its vendor (published IP ranges or reverse DNS).", plan: "free" },
  { id: "api-key", label: "Agent API keys", proves: "A key you issued to this agent.", plan: "free" },
  { id: "web-bot-auth", label: "Web Bot Auth", proves: "The agent's operator, by an RFC 9421 signature on every request.", plan: "starter" },
  { id: "oauth2", label: "OAuth 2.1", proves: "The agent's client, and the user it acts for when delegated.", plan: "starter" }
] as const;
export type AuthMethodId = (typeof AUTH_METHODS)[number]["id"];

/** Coming later — shown greyed on the Auth page. */
export const AUTH_METHODS_LATER = [
  { label: "Enterprise agent SSO", detail: "ID-JAG / Cross App Access — Okta, Entra Agent ID, Auth0" },
  { label: "Workload identity", detail: "SPIFFE, incl. Google Agent Identity" },
  { label: "mTLS", detail: "Client certificates, server-side" }
];

export interface MethodStats {
  method: string;
  verified: number;
  failed: number;
  delegated: number;
  agents: number;
}

/** Identity events by auth method (metadata.protocol) over the window. */
export async function getAuthMethodStats(tenantId: string, days = 30): Promise<MethodStats[]> {
  const e = schema.sdkEvents;
  const rows = await db()
    .select({
      method: sql<string>`coalesce(${e.protocol}, 'none')`,
      verified: sql<number>`count(*) filter (where ${e.outcome} = 'success' and ${e.trust} in ('verified','linked'))`,
      failed: sql<number>`count(*) filter (where ${e.outcome} = 'error')`,
      delegated: sql<number>`count(*) filter (where ${e.trust} = 'linked')`,
      agents: sql<number>`count(distinct ${e.sessionId}) filter (where ${e.outcome} = 'success')`
    })
    .from(e)
    .where(and(eq(e.tenantId, tenantId), eq(e.type, "auth.identity_presented"), gte(e.occurredAt, since(days))))
    .groupBy(sql`1`);
  return rows.map((r) => ({ method: r.method, verified: n(r.verified), failed: n(r.failed), delegated: n(r.delegated), agents: n(r.agents) }));
}

/** Why verifications failed (error text), most common first. */
export async function getAuthFailureReasons(tenantId: string, days = 30, limit = 8) {
  const e = schema.sdkEvents;
  const rows = await db()
    .select({ reason: e.error, count: sql<number>`count(*)` })
    .from(e)
    .where(and(eq(e.tenantId, tenantId), eq(e.type, "auth.identity_presented"), eq(e.outcome, "error"), gte(e.occurredAt, since(days))))
    .groupBy(e.error)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows.map((r) => ({ reason: r.reason ?? "unknown", count: n(r.count) }));
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
      lastUsedAt: schema.agentKeys.lastUsedAt,
      revokedAt: schema.agentKeys.revokedAt
    })
    .from(schema.agentKeys)
    .where(eq(schema.agentKeys.tenantId, tenantId))
    .orderBy(desc(schema.agentKeys.createdAt));
}

// ---- Detection ------------------------------------------------------------------

export interface DetectionSource {
  source: string;
  count: number;
}

/**
 * How agents were found: WebMCP activity, vision behaviour, DOM/headless,
 * crawler UA — from agent.detected events — plus self-declared identities.
 */
export async function getDetectionSources(tenantId: string, days = 30): Promise<DetectionSource[]> {
  const e = schema.sdkEvents;
  const detected = await db()
    .select({ cls: e.agentClass, count: sql<number>`count(*)` })
    .from(e)
    .where(and(eq(e.tenantId, tenantId), eq(e.type, "agent.detected"), gte(e.occurredAt, since(days))))
    .groupBy(e.agentClass);
  const [declared] = await db()
    .select({ count: sql<number>`count(*)` })
    .from(e)
    .where(
      and(
        eq(e.tenantId, tenantId),
        eq(e.type, "auth.identity_presented"),
        sql`(${e.protocol} in ('declaration','x-agent-header') or ${e.trust} = 'declared')`,
        gte(e.occurredAt, since(days))
      )
    );
  const LABEL: Record<string, string> = { webmcp: "WebMCP", screenshot: "Vision model", dom: "DOM / headless", crawler: "Crawler" };
  return [
    { source: "Self-declared", count: n(declared?.count) },
    ...detected.map((d) => ({ source: LABEL[d.cls ?? ""] ?? d.cls ?? "unknown", count: n(d.count) }))
  ];
}

// ---- Authorization -----------------------------------------------------------------

export async function getPolicies(tenantId: string) {
  return db()
    .select()
    .from(schema.sdkPolicies)
    .where(eq(schema.sdkPolicies.tenantId, tenantId))
    .orderBy(schema.sdkPolicies.siteId, schema.sdkPolicies.tool);
}

/** allowed / denied / reviewed (approved vs refused) over the window. */
export async function getDecisionStats(tenantId: string, days = 30) {
  const e = schema.sdkEvents;
  const [r] = await db()
    .select({
      allowed: sql<number>`count(*) filter (where ${e.outcome} = 'success' and coalesce(${e.metadata}->>'review','false') <> 'true')`,
      denied: sql<number>`count(*) filter (where ${e.outcome} = 'blocked' and coalesce(${e.metadata}->>'review','false') <> 'true')`,
      approved: sql<number>`count(*) filter (where ${e.metadata}->>'review' = 'true' and ${e.metadata}->>'approved' = 'true')`,
      refused: sql<number>`count(*) filter (where ${e.metadata}->>'review' = 'true' and ${e.metadata}->>'approved' = 'false')`
    })
    .from(e)
    .where(and(eq(e.tenantId, tenantId), eq(e.type, "authz.evaluated"), gte(e.occurredAt, since(days))));
  return { allowed: n(r?.allowed), denied: n(r?.denied), approved: n(r?.approved), refused: n(r?.refused) };
}

// ---- WebMCP tools ----------------------------------------------------------------

export interface ToolRow {
  siteId: string;
  toolName: string;
  title: string | null;
  description: string | null;
  groupName: string | null;
  page: string | null;
  inputSchema: unknown;
  outputSchema: unknown;
  annotations: Record<string, boolean> | null;
  tokens: number;
  status: string;
  statusError: string | null;
  statusAt: Date | null;
  updatedAt: Date;
}

export async function getTools(tenantId: string): Promise<ToolRow[]> {
  const t = schema.sdkToolRegistry;
  const rows = await db()
    .select({
      siteId: t.siteId,
      toolName: t.toolName,
      title: t.title,
      description: t.description,
      groupName: t.groupName,
      page: t.page,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      annotations: t.annotations,
      tokens: t.tokens,
      status: t.status,
      statusError: t.statusError,
      statusAt: t.statusAt,
      updatedAt: t.updatedAt
    })
    .from(t)
    .where(eq(t.tenantId, tenantId))
    .orderBy(t.siteId, t.page, t.toolName);
  return rows.map((r) => ({ ...r, annotations: (r.annotations as Record<string, boolean> | null) ?? null }));
}

export interface ToolHealth {
  calls: number;
  ok: number;
  errors: number;
  denied: number;
  p50: number | null;
  p95: number | null;
  lastError: string | null;
  lastCalledAt: Date | null;
}

/** Call outcomes + latency per site·tool from tool.executed events. */
export async function getToolHealth(tenantId: string, days = 30): Promise<Map<string, ToolHealth>> {
  const e = schema.sdkEvents;
  const rows = await db()
    .select({
      siteId: e.siteId,
      tool: e.tool,
      calls: sql<number>`count(*)`,
      ok: sql<number>`count(*) filter (where ${e.outcome} = 'success')`,
      errors: sql<number>`count(*) filter (where ${e.outcome} = 'error')`,
      denied: sql<number>`count(*) filter (where ${e.outcome} = 'blocked')`,
      p50: sql<number | null>`percentile_cont(0.5) within group (order by ${e.durationMs}) filter (where ${e.durationMs} is not null)`,
      p95: sql<number | null>`percentile_cont(0.95) within group (order by ${e.durationMs}) filter (where ${e.durationMs} is not null)`,
      lastError: sql<string | null>`(array_agg(${e.error} order by ${e.occurredAt} desc) filter (where ${e.outcome} = 'error'))[1]`,
      lastCalledAt: sql<Date | null>`max(${e.occurredAt})`
    })
    .from(e)
    .where(and(eq(e.tenantId, tenantId), eq(e.type, "tool.executed"), gte(e.occurredAt, since(days))))
    .groupBy(e.siteId, e.tool);
  const map = new Map<string, ToolHealth>();
  for (const r of rows) {
    if (!r.tool) continue;
    map.set(`${r.siteId}|${r.tool}`, {
      calls: n(r.calls),
      ok: n(r.ok),
      errors: n(r.errors),
      denied: n(r.denied),
      p50: r.p50 === null ? null : Math.round(Number(r.p50)),
      p95: r.p95 === null ? null : Math.round(Number(r.p95)),
      lastError: r.lastError,
      lastCalledAt: r.lastCalledAt ? new Date(r.lastCalledAt) : null
    });
  }
  return map;
}

// ---- Procedural memory -----------------------------------------------------------

export async function getToolDescriptions(tenantId: string) {
  return db()
    .select()
    .from(schema.sdkToolDescriptions)
    .where(eq(schema.sdkToolDescriptions.tenantId, tenantId));
}

// ---- Observability -------------------------------------------------------------

export interface EventFilters {
  type?: string;
  outcome?: string;
  agentClass?: string;
  tool?: string;
  session?: string;
}

export async function getFilteredEvents(tenantId: string, f: EventFilters, limit = 200) {
  const e = schema.sdkEvents;
  const conds = [eq(e.tenantId, tenantId)];
  if (f.type) conds.push(sql`${e.type}::text = ${f.type}`);
  if (f.outcome) conds.push(sql`${e.outcome}::text = ${f.outcome}`);
  if (f.agentClass) conds.push(eq(e.agentClass, f.agentClass));
  if (f.tool) conds.push(eq(e.tool, f.tool));
  if (f.session) conds.push(eq(e.sessionId, f.session));
  return db()
    .select({
      id: e.id,
      siteId: e.siteId,
      sessionId: e.sessionId,
      occurredAt: e.occurredAt,
      type: e.type,
      tool: e.tool,
      agentClass: e.agentClass,
      agentVendor: e.agentVendor,
      trust: e.trust,
      outcome: e.outcome,
      durationMs: e.durationMs,
      page: e.page,
      protocol: e.protocol,
      error: e.error
    })
    .from(e)
    .where(and(...conds))
    .orderBy(desc(e.occurredAt))
    .limit(limit);
}

export interface SessionRow {
  sessionId: string;
  siteId: string;
  agentClass: string | null;
  vendor: string | null;
  trust: string | null;
  events: number;
  toolCalls: number;
  errors: number;
  startedAt: Date;
  endedAt: Date;
}

/** Agent sessions (one SDK session id each), most recent first. */
export async function getSessions(tenantId: string, days = 7, limit = 25): Promise<SessionRow[]> {
  const e = schema.sdkEvents;
  const rows = await db()
    .select({
      sessionId: e.sessionId,
      siteId: sql<string>`max(${e.siteId})`,
      agentClass: sql<string | null>`(array_agg(${e.agentClass} order by ${e.occurredAt} desc) filter (where ${e.agentClass} is not null))[1]`,
      vendor: sql<string | null>`(array_agg(${e.agentVendor} order by ${e.occurredAt} desc) filter (where ${e.agentVendor} is not null))[1]`,
      trust: sql<string | null>`(array_agg(${e.trust} order by ${e.occurredAt} desc) filter (where ${e.trust} is not null))[1]`,
      events: sql<number>`count(*)`,
      toolCalls: sql<number>`count(*) filter (where ${e.type} = 'tool.executed')`,
      errors: sql<number>`count(*) filter (where ${e.outcome} = 'error')`,
      startedAt: sql<Date>`min(${e.occurredAt})`,
      endedAt: sql<Date>`max(${e.occurredAt})`
    })
    .from(e)
    .where(and(eq(e.tenantId, tenantId), gte(e.occurredAt, since(days)), sql`${e.agentClass} is not null`))
    .groupBy(e.sessionId)
    .orderBy(desc(sql`max(${e.occurredAt})`))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    events: n(r.events),
    toolCalls: n(r.toolCalls),
    errors: n(r.errors),
    startedAt: new Date(r.startedAt),
    endedAt: new Date(r.endedAt)
  }));
}

/** Tool-call latency + error rate over the window. */
export async function getLatency(tenantId: string, days = 7) {
  const e = schema.sdkEvents;
  const [r] = await db()
    .select({
      total: sql<number>`count(*)`,
      errors: sql<number>`count(*) filter (where ${e.outcome} = 'error')`,
      toolCalls: sql<number>`count(*) filter (where ${e.type} = 'tool.executed')`,
      p50: sql<number | null>`percentile_cont(0.5) within group (order by ${e.durationMs}) filter (where ${e.type} = 'tool.executed' and ${e.durationMs} is not null)`,
      p95: sql<number | null>`percentile_cont(0.95) within group (order by ${e.durationMs}) filter (where ${e.type} = 'tool.executed' and ${e.durationMs} is not null)`
    })
    .from(e)
    .where(and(eq(e.tenantId, tenantId), gte(e.occurredAt, since(days))));
  return {
    total: n(r?.total),
    errors: n(r?.errors),
    toolCalls: n(r?.toolCalls),
    p50: r?.p50 == null ? null : Math.round(Number(r.p50)),
    p95: r?.p95 == null ? null : Math.round(Number(r.p95))
  };
}

// ---- Analytics -----------------------------------------------------------------

/** Top values of one column over the window (vendors, tools, pages, methods). */
export async function getTop(
  tenantId: string,
  column: "agentVendor" | "tool" | "page" | "protocol" | "agentClass",
  opts: { days?: number; type?: string; limit?: number } = {}
) {
  const e = schema.sdkEvents;
  const col = e[column];
  const conds = [eq(e.tenantId, tenantId), gte(e.occurredAt, since(opts.days ?? 30)), sql`${col} is not null`];
  if (opts.type) conds.push(sql`${e.type}::text = ${opts.type}`);
  const rows = await db()
    .select({ label: col, count: sql<number>`count(*)` })
    .from(e)
    .where(and(...conds))
    .groupBy(col)
    .orderBy(desc(sql`count(*)`))
    .limit(opts.limit ?? 8);
  return rows.map((r) => ({ label: String(r.label), value: n(r.count) }));
}
