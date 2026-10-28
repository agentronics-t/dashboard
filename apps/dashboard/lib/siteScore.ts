// The workspace site's Agent Readiness Score, before and after Agent Nic.
//
// Scans run the landing page's scanner (POST, so the CDN never answers with a
// cached result) and are stored in site_scans: the first one when the address
// is saved, one when each Agent Nic run starts, and one after its PR is merged.
// A merge isn't live until the site redeploys, so the after-scan is retried
// for a while when it shows no gain yet.

import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { schema } from "@agentronics/intel-schema/db";
import { db } from "./tenant";

const SCAN_API = process.env.SCAN_API_URL || "https://www.agentronics.dev/api/scan";

export type ScanKind = "first" | "before" | "after" | "manual";

export interface ScanCheck {
  id: string;
  group: string;
  title: string;
  weight: number;
  pass: boolean;
  /** Doesn't apply to this page: half points, shown amber. */
  partial?: boolean;
  detail?: string;
  fix?: string;
}

export interface ScanResult {
  url: string;
  host: string;
  score: number;
  band: { key: "not" | "partly" | "ready"; label: string; message: string };
  groups: Record<string, { label: string; question: string; score: number }>;
  checks: ScanCheck[];
  passed: number;
  total: number;
}

export interface StoredScan {
  id: string;
  url: string;
  kind: ScanKind;
  runId: string | null;
  score: number;
  result: ScanResult;
  createdAt: Date;
}

/** "Shop.example/" → "https://shop.example"; null if it isn't a public web address. */
export function normaliseSiteUrl(raw: string): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || /(^|\.)localhost$|^127\.|^0\.0\.0\.0$/.test(u.hostname)) return null;
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** Scan a site with the public scanner. Throws with the scanner's message on failure. */
export async function scanSite(url: string): Promise<ScanResult> {
  const res = await fetch(SCAN_API, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ url }),
    cache: "no-store",
    signal: AbortSignal.timeout(35_000)
  });
  const data = (await res.json().catch(() => null)) as (ScanResult & { error?: string }) | null;
  if (!res.ok || !data || data.error || typeof data.score !== "number") throw new Error(data?.error || `The scanner answered ${res.status}.`);
  return data;
}

/** Scan and store; returns null (and logs) if the scan fails. */
export async function recordScan(tenantId: string, url: string, kind: ScanKind, runId: string | null = null): Promise<StoredScan | null> {
  try {
    const result = await scanSite(url);
    const [row] = await db().insert(schema.siteScans).values({ tenantId, url, kind, runId, score: result.score, result }).returning();
    return row ? toStored(row) : null;
  } catch (err) {
    console.error(`[site-score] ${kind} scan of ${url} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

const toStored = (row: typeof schema.siteScans.$inferSelect): StoredScan => ({
  id: row.id,
  url: row.url,
  kind: row.kind as ScanKind,
  runId: row.runId,
  score: row.score,
  result: row.result as ScanResult,
  createdAt: row.createdAt
});

export interface TrackedSite {
  id: string;
  url: string;
  /** The Agent Nic site (repo) that builds it, if linked. */
  agentNickSiteId: string | null;
}

export async function getTrackedSites(tenantId: string): Promise<TrackedSite[]> {
  return db()
    .select({ id: schema.trackedSites.id, url: schema.trackedSites.url, agentNickSiteId: schema.trackedSites.agentNickSiteId })
    .from(schema.trackedSites)
    .where(eq(schema.trackedSites.tenantId, tenantId))
    .orderBy(asc(schema.trackedSites.createdAt));
}

/**
 * The website an Agent Nic repo builds: the tracked site linked to it, or —
 * when the workspace tracks exactly one site that isn't linked yet — that one,
 * which is then linked to the repo.
 */
export async function siteUrlForRepo(tenantId: string, agentNickSiteId: string): Promise<string | null> {
  const sites = await getTrackedSites(tenantId);
  const linked = sites.find((s) => s.agentNickSiteId === agentNickSiteId);
  if (linked) return linked.url;
  const free = sites.filter((s) => !s.agentNickSiteId);
  if (sites.length === 1 && free.length === 1) {
    await db().update(schema.trackedSites).set({ agentNickSiteId }).where(eq(schema.trackedSites.id, free[0]!.id));
    return free[0]!.url;
  }
  return null;
}

/** Remember the address given in a review as the repo's website (within the plan's limit). */
export async function linkSiteToRepo(tenantId: string, url: string, agentNickSiteId: string, limit: number | null): Promise<void> {
  const sites = await getTrackedSites(tenantId);
  for (const s of sites.filter((s) => s.agentNickSiteId === agentNickSiteId && s.url !== url)) {
    await db().update(schema.trackedSites).set({ agentNickSiteId: null }).where(eq(schema.trackedSites.id, s.id));
  }
  const existing = sites.find((s) => s.url === url);
  if (existing) {
    await db().update(schema.trackedSites).set({ agentNickSiteId }).where(eq(schema.trackedSites.id, existing.id));
  } else if (limit === null || sites.length < limit) {
    await db().insert(schema.trackedSites).values({ tenantId, url, agentNickSiteId }).onConflictDoNothing();
  }
}

export interface ScoreCard {
  site: TrackedSite;
  /** The baseline: the scan taken when the latest run started (or the first scan). */
  before: StoredScan | null;
  /** The newest scan after the baseline, if any. */
  after: StoredScan | null;
  /** A merged run whose after-scan shows no gain yet: the page (re)scans it. */
  pendingAfter: { runId: string; mergedAt: Date; lastScanAt: Date | null } | null;
}

const AFTER_FIRST_DELAY_MS = 2 * 60_000; // give the site time to redeploy
const AFTER_RETRY_MS = 3 * 60_000;
const AFTER_GIVE_UP_MS = 45 * 60_000;

/** Before → after for every tracked website. */
export async function getScoreCards(tenantId: string): Promise<ScoreCard[]> {
  const sites = await getTrackedSites(tenantId);
  return Promise.all(sites.map((site) => scoreCardFor(tenantId, site)));
}

async function scoreCardFor(tenantId: string, site: TrackedSite): Promise<ScoreCard> {
  const rows = (
    await db()
      .select()
      .from(schema.siteScans)
      .where(and(eq(schema.siteScans.tenantId, tenantId), eq(schema.siteScans.url, site.url)))
      .orderBy(desc(schema.siteScans.createdAt))
      .limit(40)
  ).map(toStored);
  const before = rows.find((r) => r.kind === "before") ?? rows.find((r) => r.kind === "first") ?? rows[rows.length - 1] ?? null;
  const latest = rows[0] ?? null;
  const after = latest && before && latest.id !== before.id && latest.createdAt > before.createdAt ? latest : null;

  // After the repo's PR is merged, scan once the site has had time to redeploy, and again while it shows no gain.
  let pendingAfter: ScoreCard["pendingAfter"] = null;
  if (site.agentNickSiteId) {
    const [merged] = await db()
      .select({ id: schema.agentNickRuns.id, mergedAt: schema.agentNickRuns.mergedAt })
      .from(schema.agentNickRuns)
      .where(and(eq(schema.agentNickRuns.siteId, site.agentNickSiteId), eq(schema.agentNickRuns.status, "merged")))
      .orderBy(desc(schema.agentNickRuns.mergedAt))
      .limit(1);
    if (merged?.mergedAt && Date.now() - merged.mergedAt.getTime() < AFTER_GIVE_UP_MS) {
      const lastAfter = rows.find((r) => r.runId === merged.id && r.kind === "after");
      const improved = !!lastAfter && !!before && lastAfter.score > before.score;
      if (!improved) pendingAfter = { runId: merged.id, mergedAt: merged.mergedAt, lastScanAt: lastAfter?.createdAt ?? null };
    }
  }
  return { site, before, after, pendingAfter };
}

/** Whether the page should start the after-scan now (see getScoreCard). */
export function afterScanDue(card: ScoreCard): boolean {
  const p = card.pendingAfter;
  if (!p || Date.now() - p.mergedAt.getTime() < AFTER_FIRST_DELAY_MS) return false;
  return !p.lastScanAt || Date.now() - p.lastScanAt.getTime() >= AFTER_RETRY_MS;
}
