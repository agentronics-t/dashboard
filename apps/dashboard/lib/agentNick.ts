// Agent Nick — console side. Reads come straight from Neon (tenant-scoped);
// anything that touches GitHub or the pipeline goes through the agent-nick
// service, authenticated with the signed-in user's Clerk session token.
import "server-only";
import { schema } from "@agentronics/intel-schema/db";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./tenant";

export const agentNickConfigured = () => !!process.env.AGENT_NICK_URL;
export const githubAppSlug = () => process.env.GITHUB_APP_SLUG || null;

export class NickError extends Error {
  readonly status: number;
  readonly code: string;
  readonly data: Record<string, unknown>;
  constructor(status: number, code: string, message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

/** Call the agent-nick service as the signed-in user. */
export async function nickFetch<T>(path: string, init: { method?: string; body?: unknown; tenantId?: string } = {}): Promise<T> {
  const base = process.env.AGENT_NICK_URL;
  if (!base) throw new NickError(503, "not_configured", "Agent Nick isn't connected to this console yet.");
  let token: string | null = null;
  if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    const { auth } = await import("@clerk/nextjs/server");
    token = await (await auth()).getToken();
  } else if (init.tenantId) {
    token = `dev-tenant:${init.tenantId}`; // local dev without Clerk (service must run with DEV_AUTH=true)
  }
  if (!token) throw new NickError(401, "unauthenticated", "Please sign in again.");
  const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    cache: "no-store"
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new NickError(res.status, data.error ?? "error", data.message ?? friendly(data.error) ?? `Request failed (${res.status})`, data);
  return data as T;
}

const FRIENDLY: Record<string, string> = {
  plan_required: "Pick a plan to approve the tools.",
  admin_required: "Only organization admins can do this.",
  not_awaiting_review: "This run isn't waiting for a review anymore.",
  no_open_pr: "There's no open pull request for this run.",
  github_disconnected: "Agent Nick lost access to this repository — reconnect GitHub.",
  installation_not_yours: "That GitHub installation doesn't belong to your GitHub account.",
  invalid_token: "Your session expired — refresh the page."
};
const friendly = (code: string | undefined) => (code ? FRIENDLY[code] : undefined);

export type Site = typeof schema.agentNickSites.$inferSelect;
export type Run = typeof schema.agentNickRuns.$inferSelect;
export type RunEvent = typeof schema.agentNickEvents.$inferSelect;
export type NickTool = typeof schema.agentNickTools.$inferSelect;

export async function getInstallations(tenantId: string) {
  return db()
    .select()
    .from(schema.githubInstallations)
    .where(and(eq(schema.githubInstallations.tenantId, tenantId), isNull(schema.githubInstallations.deletedAt)))
    .orderBy(asc(schema.githubInstallations.createdAt));
}

export async function getSites(tenantId: string): Promise<{ site: Site; lastRun: Run | null }[]> {
  const sites = await db()
    .select()
    .from(schema.agentNickSites)
    .where(eq(schema.agentNickSites.tenantId, tenantId))
    .orderBy(desc(schema.agentNickSites.updatedAt));
  const runIds = sites.map((s) => s.lastRunId).filter((id): id is string => !!id);
  const runs = runIds.length ? await db().select().from(schema.agentNickRuns).where(inArray(schema.agentNickRuns.id, runIds)) : [];
  const byId = new Map(runs.map((r) => [r.id, r]));
  return sites.map((site) => ({ site, lastRun: site.lastRunId ? (byId.get(site.lastRunId) ?? null) : null }));
}

export async function getSite(tenantId: string, siteId: string) {
  const [site] = await db()
    .select()
    .from(schema.agentNickSites)
    .where(and(eq(schema.agentNickSites.id, siteId), eq(schema.agentNickSites.tenantId, tenantId)));
  if (!site) return null;
  const runs = await db().select().from(schema.agentNickRuns).where(eq(schema.agentNickRuns.siteId, siteId)).orderBy(desc(schema.agentNickRuns.createdAt)).limit(25);
  const liveRun = runs.find((r) => r.status === "merged") ?? null;
  const liveTools = liveRun
    ? await db()
        .select()
        .from(schema.agentNickTools)
        .where(and(eq(schema.agentNickTools.runId, liveRun.id), eq(schema.agentNickTools.approved, true)))
        .orderBy(asc(schema.agentNickTools.page), asc(schema.agentNickTools.name))
    : [];
  return { site, runs, liveRun, liveTools };
}

export async function getRun(tenantId: string, runId: string) {
  const [row] = await db()
    .select({ run: schema.agentNickRuns, site: schema.agentNickSites })
    .from(schema.agentNickRuns)
    .innerJoin(schema.agentNickSites, eq(schema.agentNickRuns.siteId, schema.agentNickSites.id))
    .where(and(eq(schema.agentNickRuns.id, runId), eq(schema.agentNickRuns.tenantId, tenantId)));
  if (!row) return null;
  const [events, tools] = await Promise.all([
    db().select().from(schema.agentNickEvents).where(eq(schema.agentNickEvents.runId, runId)).orderBy(asc(schema.agentNickEvents.id)),
    db().select().from(schema.agentNickTools).where(eq(schema.agentNickTools.runId, runId)).orderBy(asc(schema.agentNickTools.page), asc(schema.agentNickTools.name))
  ]);
  return { ...row, events, tools };
}

export async function getWorkspacePlan(tenantId: string) {
  const [plan] = await db().select().from(schema.workspacePlans).where(eq(schema.workspacePlans.tenantId, tenantId));
  if (!plan) return null;
  const active = plan.status === "active" && (!plan.currentPeriodEnd || plan.currentPeriodEnd > new Date());
  return { ...plan, active };
}

/** "3 min ago" style relative time. */
export function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 45) return "just now";
  const units: [number, string][] = [
    [60, "min"],
    [3600, "h"],
    [86400, "d"],
    [2592000, "mo"]
  ];
  let label = `${Math.round(s / 60)} min`;
  for (const [sec, unit] of units) if (s >= sec) label = `${Math.round(s / sec)}${unit === "min" ? " min" : unit}`;
  return `${label} ago`;
}
