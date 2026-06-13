// Server-side typed reads from Neon (the serving mirror). All scoped by tenant.
import "server-only";
import { schema } from "@agentronics/intel-schema/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "./tenant";

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
