// Server-side typed reads from Neon (the serving mirror). All scoped by tenant.
import "server-only";
import { schema } from "@agentronics/intel-schema/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./tenant";

const sinceDate = (days: number) =>
  new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

export interface TrafficDay {
  date: string;
  webmcp: number;
  webbotauth: number;
  stealth: number;
  blocked: number;
  allowed: number;
  requests: number;
}

/** Daily traffic for the last `days`, split by lane + blocked/allowed. */
export async function getTrafficSeries(tenantId: string, days = 30): Promise<TrafficDay[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const rows = await db()
    .select({
      date: schema.agentTrafficDaily.date,
      lane: schema.agentTrafficDaily.agentLane,
      requests: sql<number>`sum(${schema.agentTrafficDaily.requests})::int`,
      blocked: sql<number>`sum(${schema.agentTrafficDaily.blocked})::int`,
      allowed: sql<number>`sum(${schema.agentTrafficDaily.allowed})::int`
    })
    .from(schema.agentTrafficDaily)
    .where(
      and(
        eq(schema.agentTrafficDaily.tenantId, tenantId),
        gte(schema.agentTrafficDaily.date, since)
      )
    )
    .groupBy(schema.agentTrafficDaily.date, schema.agentTrafficDaily.agentLane);

  const byDate = new Map<string, TrafficDay>();
  for (const r of rows) {
    const d =
      byDate.get(r.date) ??
      { date: r.date, webmcp: 0, webbotauth: 0, stealth: 0, blocked: 0, allowed: 0, requests: 0 };
    d[r.lane as "webmcp" | "webbotauth" | "stealth"] += Number(r.requests);
    d.blocked += Number(r.blocked);
    d.allowed += Number(r.allowed);
    d.requests += Number(r.requests);
    byDate.set(r.date, d);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface TopAgent {
  agent: string;
  requests: number;
  blocked: number;
  lane: string;
}

export async function getTopAgents(tenantId: string, days = 30, limit = 8): Promise<TopAgent[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const rows = await db()
    .select({
      agent: schema.agentTrafficDaily.agentName,
      lane: sql<string>`max(${schema.agentTrafficDaily.agentLane})`,
      requests: sql<number>`sum(${schema.agentTrafficDaily.requests})::int`,
      blocked: sql<number>`sum(${schema.agentTrafficDaily.blocked})::int`
    })
    .from(schema.agentTrafficDaily)
    .where(
      and(
        eq(schema.agentTrafficDaily.tenantId, tenantId),
        gte(schema.agentTrafficDaily.date, since)
      )
    )
    .groupBy(schema.agentTrafficDaily.agentName)
    .orderBy(desc(sql`sum(${schema.agentTrafficDaily.requests})`))
    .limit(limit);
  return rows.map((r) => ({ ...r, requests: Number(r.requests), blocked: Number(r.blocked) }));
}

export interface ForecastPoint {
  metric: string;
  horizon_date: string;
  p10: number;
  p50: number;
  p90: number;
  model_version: string;
}

export async function getForecasts(tenantId: string): Promise<ForecastPoint[]> {
  const rows = await db()
    .select({
      metric: schema.forecasts.metric,
      horizon_date: schema.forecasts.horizonDate,
      p10: schema.forecasts.p10,
      p50: schema.forecasts.p50,
      p90: schema.forecasts.p90,
      model_version: schema.forecasts.modelVersion
    })
    .from(schema.forecasts)
    .where(eq(schema.forecasts.tenantId, tenantId))
    .orderBy(schema.forecasts.metric, schema.forecasts.horizonDate);
  return rows.map((r) => ({
    ...r,
    p10: Number(r.p10),
    p50: Number(r.p50),
    p90: Number(r.p90)
  }));
}

export async function getInsights(tenantId: string, limit = 30) {
  return db()
    .select({
      id: schema.insights.id,
      kind: schema.insights.kind,
      title: schema.insights.title,
      body_md: schema.insights.bodyMd,
      severity: schema.insights.severity,
      created_at: schema.insights.createdAt
    })
    .from(schema.insights)
    .where(eq(schema.insights.tenantId, tenantId))
    .orderBy(desc(schema.insights.createdAt))
    .limit(limit);
}

export async function getJobs(tenantId: string, limit = 25) {
  return db()
    .select({
      id: schema.jobs.id,
      type: schema.jobs.type,
      status: schema.jobs.status,
      attempt: schema.jobs.attempt,
      error: schema.jobs.error,
      started_at: schema.jobs.startedAt,
      finished_at: schema.jobs.finishedAt,
      created_at: schema.jobs.createdAt
    })
    .from(schema.jobs)
    .where(eq(schema.jobs.tenantId, tenantId))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(limit);
}

export async function getConnectors(tenantId: string) {
  return db()
    .select({
      id: schema.connectors.id,
      type: schema.connectors.type,
      config: schema.connectors.config,
      secret_ref: schema.connectors.secretRef,
      created_at: schema.connectors.createdAt
    })
    .from(schema.connectors)
    .where(eq(schema.connectors.tenantId, tenantId));
}

// ---- SDK event stream (pushed via POST /v1/sdk/events) --------------------

export interface SdkDailyRow {
  date: string;
  type: string;
  agentClass: string;
  outcome: string;
  count: number;
}

/** Per-pillar daily rollup for the last `days`. Pages aggregate as needed. */
export async function getSdkEventDaily(tenantId: string, days = 30): Promise<SdkDailyRow[]> {
  const rows = await db()
    .select({
      date: schema.sdkEventDaily.date,
      type: schema.sdkEventDaily.type,
      agentClass: schema.sdkEventDaily.agentClass,
      outcome: schema.sdkEventDaily.outcome,
      count: sql<number>`sum(${schema.sdkEventDaily.count})::int`
    })
    .from(schema.sdkEventDaily)
    .where(
      and(
        eq(schema.sdkEventDaily.tenantId, tenantId),
        gte(schema.sdkEventDaily.date, sinceDate(days))
      )
    )
    .groupBy(
      schema.sdkEventDaily.date,
      schema.sdkEventDaily.type,
      schema.sdkEventDaily.agentClass,
      schema.sdkEventDaily.outcome
    );
  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}

/** Totals per event type over the window (KPIs / Analytics). */
export async function getSdkEventTotals(tenantId: string, days = 30): Promise<Record<string, number>> {
  const rows = await db()
    .select({
      type: schema.sdkEventDaily.type,
      count: sql<number>`sum(${schema.sdkEventDaily.count})::int`
    })
    .from(schema.sdkEventDaily)
    .where(
      and(
        eq(schema.sdkEventDaily.tenantId, tenantId),
        gte(schema.sdkEventDaily.date, sinceDate(days))
      )
    )
    .groupBy(schema.sdkEventDaily.type);
  return Object.fromEntries(rows.map((r) => [r.type, Number(r.count)]));
}

export interface SdkEventRow {
  id: string;
  siteId: string;
  sessionId: string;
  occurredAt: Date;
  type: string;
  tool: string | null;
  agentClass: string | null;
  agentVendor: string | null;
  trust: string | null;
  outcome: string;
  durationMs: number | null;
  page: string | null;
  protocol: string | null;
  error: string | null;
}

/** Recent raw events (Logs feed + per-pillar drill-down), optionally by type. */
export async function getSdkRecentEvents(
  tenantId: string,
  opts: { types?: string[]; limit?: number } = {}
): Promise<SdkEventRow[]> {
  const { types, limit = 100 } = opts;
  const where = types?.length
    ? and(
        eq(schema.sdkEvents.tenantId, tenantId),
        inArray(schema.sdkEvents.type, types as (typeof schema.sdkEvents.$inferSelect.type)[])
      )
    : eq(schema.sdkEvents.tenantId, tenantId);
  return db()
    .select({
      id: schema.sdkEvents.id,
      siteId: schema.sdkEvents.siteId,
      sessionId: schema.sdkEvents.sessionId,
      occurredAt: schema.sdkEvents.occurredAt,
      type: schema.sdkEvents.type,
      tool: schema.sdkEvents.tool,
      agentClass: schema.sdkEvents.agentClass,
      agentVendor: schema.sdkEvents.agentVendor,
      trust: schema.sdkEvents.trust,
      outcome: schema.sdkEvents.outcome,
      durationMs: schema.sdkEvents.durationMs,
      page: schema.sdkEvents.page,
      protocol: schema.sdkEvents.protocol,
      error: schema.sdkEvents.error
    })
    .from(schema.sdkEvents)
    .where(where)
    .orderBy(desc(schema.sdkEvents.occurredAt))
    .limit(limit);
}

/** Latest synced tool registry (WebMCP Tools page). */
export async function getSdkToolRegistry(tenantId: string) {
  return db()
    .select({
      siteId: schema.sdkToolRegistry.siteId,
      toolName: schema.sdkToolRegistry.toolName,
      groupName: schema.sdkToolRegistry.groupName,
      page: schema.sdkToolRegistry.page,
      inputSchema: schema.sdkToolRegistry.inputSchema,
      outputSchema: schema.sdkToolRegistry.outputSchema,
      tokens: schema.sdkToolRegistry.tokens,
      updatedAt: schema.sdkToolRegistry.updatedAt
    })
    .from(schema.sdkToolRegistry)
    .where(eq(schema.sdkToolRegistry.tenantId, tenantId))
    .orderBy(schema.sdkToolRegistry.page, schema.sdkToolRegistry.toolName);
}

/** Latest site-memory snapshots + scores (Knaph page). */
export async function getSdkSiteMemory(tenantId: string) {
  return db()
    .select({
      siteId: schema.sdkSiteMemory.siteId,
      snapshot: schema.sdkSiteMemory.snapshot,
      score: schema.sdkSiteMemory.score,
      updatedAt: schema.sdkSiteMemory.updatedAt
    })
    .from(schema.sdkSiteMemory)
    .where(eq(schema.sdkSiteMemory.tenantId, tenantId))
    .orderBy(desc(schema.sdkSiteMemory.updatedAt));
}

/** SDK ingest keys for the Settings page (never returns the raw key). */
export async function getSdkIngestKeys(tenantId: string) {
  return db()
    .select({
      id: schema.sdkIngestKeys.id,
      prefix: schema.sdkIngestKeys.prefix,
      label: schema.sdkIngestKeys.label,
      createdAt: schema.sdkIngestKeys.createdAt,
      lastUsedAt: schema.sdkIngestKeys.lastUsedAt,
      revokedAt: schema.sdkIngestKeys.revokedAt
    })
    .from(schema.sdkIngestKeys)
    .where(eq(schema.sdkIngestKeys.tenantId, tenantId))
    .orderBy(desc(schema.sdkIngestKeys.createdAt));
}

/** SDK volume forecasts (sdk_forecasts) — separate from web-traffic forecasts. */
export async function getSdkForecasts(tenantId: string): Promise<ForecastPoint[]> {
  const rows = await db()
    .select({
      metric: schema.sdkForecasts.metric,
      horizon_date: schema.sdkForecasts.horizonDate,
      p10: schema.sdkForecasts.p10,
      p50: schema.sdkForecasts.p50,
      p90: schema.sdkForecasts.p90,
      model_version: schema.sdkForecasts.modelVersion
    })
    .from(schema.sdkForecasts)
    .where(eq(schema.sdkForecasts.tenantId, tenantId))
    .orderBy(schema.sdkForecasts.metric, schema.sdkForecasts.horizonDate);
  return rows.map((r) => ({ ...r, p10: Number(r.p10), p50: Number(r.p50), p90: Number(r.p90) }));
}

/** SDK AI insights (sdk_insights) — separate from the web-traffic Insights feed. */
export async function getSdkInsights(tenantId: string, limit = 20) {
  return db()
    .select({
      id: schema.sdkInsights.id,
      kind: schema.sdkInsights.kind,
      title: schema.sdkInsights.title,
      body_md: schema.sdkInsights.bodyMd,
      severity: schema.sdkInsights.severity,
      created_at: schema.sdkInsights.createdAt
    })
    .from(schema.sdkInsights)
    .where(eq(schema.sdkInsights.tenantId, tenantId))
    .orderBy(desc(schema.sdkInsights.createdAt))
    .limit(limit);
}

export async function getUsage(tenantId: string) {
  const period = new Date().toISOString().slice(0, 7);
  const [row] = await db()
    .select({ governed_calls: schema.billingUsage.governedCalls })
    .from(schema.billingUsage)
    .where(
      and(
        eq(schema.billingUsage.tenantId, tenantId),
        eq(schema.billingUsage.period, period)
      )
    );
  return { period, governedCalls: Number(row?.governed_calls ?? 0) };
}
