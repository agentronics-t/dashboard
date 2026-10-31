// "Is the SDK connected?" for a tracked website: look for the site's
// publishable key on the live site (the page and its own scripts), then send a
// small batch of test events through the same public endpoint the browser SDK
// uses (/v1/pub/traces, the key's allowed origin). The batch touches every
// console page — Detect, Auth, Authz, WebMCP Tools, Memory, Observability and
// Analytics — so a new customer sees each one filled in. It goes out on its own
// as soon as Agent Nic's pull request adds the SDK (before the merge), and again
// from "Send test events". Test events carry
// metadata.test = true and the vendor "Agentronics test".

import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { schema } from "@agentronics/intel-schema/db";
import type { SdkTraceEvent } from "@agentronics/intel-schema";
import { db } from "./tenant";

const API = (process.env.INTEL_API_URL || "https://api.agentronics.dev").replace(/\/+$/, "");
const UA = "AgentronicsConnectionTest/1.0 (+https://www.agentronics.dev)";

export interface SdkTestResult {
  /** The site's publishable key exists (Agent Nic made one, or one allows this origin). */
  hasKey: boolean;
  /** The key (and so the SDK) was found on the live site. */
  live: boolean;
  /** Test events the API accepted. */
  sent: number;
  message: string;
}

/** The publishable key for this site: Agent Nic's, or any active key that allows the site's origin. */
async function keyFor(tenantId: string, origin: string, host: string) {
  const keys = await db()
    .select()
    .from(schema.sdkPublishableKeys)
    .where(and(eq(schema.sdkPublishableKeys.tenantId, tenantId), sql`${schema.sdkPublishableKeys.revokedAt} is null`))
    .orderBy(desc(schema.sdkPublishableKeys.createdAt));
  return keys.find((k) => k.label === `Agent Nic · ${host}`) ?? keys.find((k) => ((k.allowedOrigins as string[]) ?? []).includes(origin)) ?? null;
}

/** Look for the key on the page and in up to 15 of its same-origin scripts. */
export async function keyOnSite(url: string, key: string): Promise<boolean> {
  const get = async (u: string) => {
    const res = await fetch(u, { headers: { "user-agent": UA }, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    return res.ok ? (await res.text()).slice(0, 3_000_000) : "";
  };
  try {
    const html = await get(url);
    if (html.includes(key)) return true;
    const origin = new URL(url).origin;
    const srcs = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
      .map((m) => {
        try {
          return new URL(m[1]!.replace(/&amp;/g, "&"), url);
        } catch {
          return null;
        }
      })
      .filter((u): u is URL => !!u && u.origin === origin);
    const likely = (u: URL) => (/webmcp|agentronics|layout|app|main|index|page/i.test(u.pathname) ? 0 : 1);
    const picked = [...new Map(srcs.map((u) => [u.href, u])).values()].sort((a, b) => likely(a) - likely(b)).slice(0, 15);
    const scripts = await Promise.all(picked.map((u) => get(u.href).catch(() => "")));
    return scripts.some((t) => t.includes(key));
  } catch {
    return false;
  }
}

interface ToolDescriptor {
  name: string;
  title?: string;
  description?: string;
  page?: string | null;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, boolean>;
}

/**
 * The tools for the registry (WebMCP Tools and Memory read it): the site's own
 * tools Agent Nic wrote, or two clearly-labelled samples when there are none.
 */
async function siteTools(agentNickSiteId: string | null): Promise<ToolDescriptor[]> {
  const rows = agentNickSiteId
    ? await db()
        .select({ runId: schema.agentNickTools.runId, name: schema.agentNickTools.name, description: schema.agentNickTools.description, page: schema.agentNickTools.page, inputSchema: schema.agentNickTools.inputSchema, readOnly: schema.agentNickTools.readOnly })
        .from(schema.agentNickTools)
        // Runs that opened a pull request: before that, every proposed tool still counts as approved.
        .innerJoin(schema.agentNickRuns, and(eq(schema.agentNickRuns.id, schema.agentNickTools.runId), isNotNull(schema.agentNickRuns.prNumber)))
        .where(and(eq(schema.agentNickTools.siteId, agentNickSiteId), eq(schema.agentNickTools.approved, true)))
        .orderBy(desc(schema.agentNickTools.createdAt))
        .limit(500)
    : [];
  // Only the latest run's tools: an earlier run's (renamed or dropped since) aren't on the site any more.
  const latest = rows[0]?.runId;
  const real = rows
    .filter((r) => r.runId === latest)
    .map((r) => ({ name: r.name, description: r.description, page: r.page === "*" ? null : r.page, inputSchema: r.inputSchema as Record<string, unknown>, annotations: { readOnlyHint: r.readOnly } }));
  if (real.length) return real;
  return [
    { name: "search_products", title: "Search products (test)", description: "Test tool from the Agentronics connection test: search the catalogue by keyword.", page: "/", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, annotations: { readOnlyHint: true } },
    { name: "contact_us", title: "Contact us (test)", description: "Test tool from the Agentronics connection test: send a message to the team.", page: "/contact", inputSchema: { type: "object", properties: { email: { type: "string" }, message: { type: "string" } }, required: ["email", "message"] }, annotations: { readOnlyHint: false } }
  ];
}

/** The test batch: a few events for every console page. */
export function testEvents(siteId: string, tools: string[]): SdkTraceEvent[] {
  const now = Date.now();
  const t = tools.length ? tools : ["search_products", "contact_us"];
  const tool = (i: number) => t[i % t.length]!;
  const base = { siteId, metadata: { test: true, page: "/" } as Record<string, unknown> };
  const agent = (cls: "webmcp" | "dom" | "screenshot" | "crawler", trust: string, vendor: string) => ({ class: cls, trust, vendor, confidence: 0.9 });
  const sessions = { webmcp: `test-${randomUUID()}`, dom: `test-${randomUUID()}`, vision: `test-${randomUUID()}`, crawler: `test-${randomUUID()}`, human: `test-${randomUUID()}` };
  const ev: Omit<SdkTraceEvent, "id" | "occurredAt">[] = [
    // Detect
    { ...base, sessionId: sessions.webmcp, type: "agent.detected", outcome: "success", agent: agent("webmcp", "declared", "Agentronics test (WebMCP agent)"), durationMs: 12 },
    { ...base, sessionId: sessions.dom, type: "agent.detected", outcome: "success", agent: agent("dom", "detected", "Agentronics test (browser automation)"), durationMs: 18 },
    { ...base, sessionId: sessions.vision, type: "agent.detected", outcome: "success", agent: agent("screenshot", "detected", "Agentronics test (vision agent)"), durationMs: 25 },
    { ...base, sessionId: sessions.crawler, type: "agent.detected", outcome: "success", agent: agent("crawler", "verified", "Agentronics test (crawler)"), durationMs: 4 },
    { ...base, sessionId: sessions.human, type: "agent.missed", outcome: "success", agent: null, durationMs: 9 },
    // Auth
    { ...base, sessionId: sessions.webmcp, type: "auth.identity_presented", outcome: "success", agent: agent("webmcp", "verified", "Agentronics test (WebMCP agent)"), metadata: { ...base.metadata, protocol: "api-key" } },
    { ...base, sessionId: sessions.webmcp, type: "auth.identity_presented", outcome: "success", agent: agent("webmcp", "linked", "Agentronics test (WebMCP agent)"), metadata: { ...base.metadata, protocol: "oauth2" } },
    { ...base, sessionId: sessions.dom, type: "auth.identity_presented", outcome: "success", agent: agent("dom", "verified", "Agentronics test (browser automation)"), metadata: { ...base.metadata, protocol: "web-bot-auth" } },
    { ...base, sessionId: sessions.crawler, type: "auth.identity_presented", outcome: "success", agent: agent("crawler", "verified", "Agentronics test (crawler)"), metadata: { ...base.metadata, protocol: "verified-crawler" } },
    { ...base, sessionId: sessions.vision, type: "auth.identity_presented", outcome: "error", agent: agent("screenshot", "detected", "Agentronics test (vision agent)"), error: "Test: signature expired", metadata: { ...base.metadata, protocol: "web-bot-auth" } },
    // Authz
    { ...base, sessionId: sessions.webmcp, type: "authz.policies_set", outcome: "success", metadata: { ...base.metadata, count: t.length, synced: true } },
    { ...base, sessionId: sessions.webmcp, type: "authz.evaluated", tool: tool(0), outcome: "success", agent: agent("webmcp", "verified", "Agentronics test (WebMCP agent)"), metadata: { ...base.metadata, decision: "allow" }, durationMs: 2 },
    { ...base, sessionId: sessions.dom, type: "authz.evaluated", tool: tool(1), outcome: "blocked", agent: agent("dom", "detected", "Agentronics test (browser automation)"), metadata: { ...base.metadata, decision: "deny" }, durationMs: 1 },
    { ...base, sessionId: sessions.vision, type: "authz.evaluated", tool: tool(2), outcome: "success", agent: agent("screenshot", "detected", "Agentronics test (vision agent)"), metadata: { ...base.metadata, decision: "review" }, durationMs: 3 },
    // WebMCP tools
    ...t.slice(0, 4).map((name) => ({ ...base, sessionId: sessions.webmcp, type: "tool.registered" as const, tool: name, outcome: "success" as const })),
    { ...base, sessionId: sessions.webmcp, type: "tool.surfaced", tool: tool(0), outcome: "success", metadata: { ...base.metadata, state: "published" } },
    { ...base, sessionId: sessions.webmcp, type: "tool.executed", tool: tool(0), outcome: "success", agent: agent("webmcp", "verified", "Agentronics test (WebMCP agent)"), durationMs: 240 },
    { ...base, sessionId: sessions.webmcp, type: "tool.executed", tool: tool(1), outcome: "success", agent: agent("webmcp", "verified", "Agentronics test (WebMCP agent)"), durationMs: 410 },
    { ...base, sessionId: sessions.dom, type: "tool.executed", tool: tool(1), outcome: "error", agent: agent("dom", "detected", "Agentronics test (browser automation)"), error: "Test: required field missing", durationMs: 95 },
    // Memory
    { ...base, sessionId: sessions.webmcp, type: "memory.accessed", outcome: "success", metadata: { ...base.metadata, kind: "site" } },
    { ...base, sessionId: sessions.webmcp, type: "memory.updated", outcome: "success", metadata: { ...base.metadata, kind: "site", operation: "sync" } }
  ];
  // Spread over the last few minutes so charts and the event feed read naturally.
  return ev.map((e, i) => ({ ...e, id: `test_${randomUUID()}`, occurredAt: new Date(now - (ev.length - i) * 7_000).toISOString() }) as SdkTraceEvent);
}

/** Check the site and send the test batch. */
export async function runSdkTest(tenantId: string, url: string, agentNickSiteId: string | null, opts: { requireLive?: boolean } = {}): Promise<SdkTestResult> {
  const u = new URL(url);
  const key = await keyFor(tenantId, u.origin, u.hostname);
  if (!key) return { hasKey: false, live: false, sent: 0, message: "No SDK key for this site yet. Approve the Agentronics SDK in an Agent Nic run (or add a publishable key in Settings)." };
  const live = await keyOnSite(url, key.key);
  if (!live && opts.requireLive) return { hasKey: true, live, sent: 0, message: "The SDK isn't on the live site yet." };
  const tools = await siteTools(agentNickSiteId);
  const headers = { authorization: `Bearer ${key.key}`, origin: u.origin, "content-type": "application/json", "user-agent": UA };
  // The registry first (what the SDK's syncTools() sends), then the events.
  await fetch(`${API}/v1/pub/sites/${encodeURIComponent(u.hostname)}/tools`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ registry: { tools } }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  }).catch(() => null);
  const events = testEvents(u.hostname, tools.map((t) => t.name));
  const res = await fetch(`${API}/v1/pub/traces`, {
    method: "POST",
    headers,
    body: JSON.stringify({ events }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as { accepted?: number; error?: string } | null;
  if (!res?.ok) {
    return { hasKey: true, live, sent: 0, message: `The API didn't take the test events (${body?.error ?? res?.status ?? "no answer"}).` };
  }
  const sent = body?.accepted ?? events.length;
  await seedSiteMemory(tenantId, u, tools).catch(() => {});
  return {
    hasKey: true,
    live,
    sent,
    message: `${live ? "The SDK is live on your site. " : "The SDK isn't on the live site yet (merge the PR and redeploy), but the connection works. "}Sent ${sent} test events: open Detect, Auth, Authz, WebMCP Tools, Memory, Observability or Analytics to see them.`
  };
}

/**
 * Site memory (the Memory page's "Site memory" card) comes from the SDK's
 * provideSiteMemory(), which has no public endpoint. Until the site sends its
 * own, start it with what we know: the site's pages and tools. Never replaces
 * a snapshot the site sent.
 */
async function seedSiteMemory(tenantId: string, u: URL, tools: ToolDescriptor[]) {
  const pages = [...new Set(tools.map((t) => t.page ?? "/"))].sort();
  const snapshot = {
    site: u.hostname,
    url: u.origin,
    pages,
    tools: tools.map((t) => ({ name: t.name, page: t.page ?? "every page", description: t.description ?? "" })),
    source: "Agentronics connection test (replaced when your site's SDK sends its own)"
  };
  await db()
    .insert(schema.sdkSiteMemory)
    .values({ tenantId, siteId: u.hostname, snapshot, score: Math.min(100, 40 + tools.length * 10) })
    .onConflictDoNothing();
}

/** Whether this site already got its test batch. */
export async function sentTestEvents(tenantId: string, host: string): Promise<boolean> {
  const [row] = await db()
    .select({ n: sql<number>`count(*)` })
    .from(schema.sdkEvents)
    .where(and(eq(schema.sdkEvents.tenantId, tenantId), eq(schema.sdkEvents.siteId, host), sql`${schema.sdkEvents.metadata}->>'test' = 'true'`));
  return Number(row?.n ?? 0) > 0;
}

/** Run states after Agent Nic has written its code (the SDK's key exists if it was approved). */
export const SDK_READY = ["pr_open", "merged", "live"];

// Pages poll every few seconds while a run moves; try each website at most once a minute per server instance.
const tried = new Map<string, number>();

/** The test batch for a website, unless it already had one. Quiet when there's no key yet. */
export async function sendTestEventsOnce(tenantId: string, url: string, agentNickSiteId: string | null): Promise<void> {
  const k = `${tenantId}|${url}`;
  if (Date.now() - (tried.get(k) ?? 0) < 60_000) return;
  tried.set(k, Date.now());
  try {
    if (await sentTestEvents(tenantId, new URL(url).hostname)) return;
    await runSdkTest(tenantId, url, agentNickSiteId);
  } catch (err) {
    console.error("sdk test events failed", { url, err: err instanceof Error ? err.message : String(err) });
  }
}
