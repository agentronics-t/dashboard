// Adapter unit tests against recorded fixtures with an injected fetch stub.

import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudflareAdapter } from "./cloudflare.ts";
import { profoundAdapter } from "./profound.ts";
import { scrunchAdapter } from "./scrunch.ts";
import { computeWindow } from "./types.ts";

const noopLog = () => {};
const WINDOW = { since: "2026-06-05", until: "2026-06-11" };

const CF_GRAPHQL_FIXTURE = {
  data: {
    viewer: {
      zones: [
        {
          httpRequestsAdaptiveGroups: [
            {
              count: 120,
              dimensions: {
                date: "2026-06-10",
                botClass: "automated",
                userAgent: "GPTBot/1.2",
                securityAction: "block"
              }
            },
            {
              count: 45,
              dimensions: {
                date: "2026-06-10",
                botClass: "likelyAutomated",
                userAgent: "ClaudeBot/1.0",
                securityAction: "allow"
              }
            }
          ]
        }
      ]
    }
  }
};

const CF_CRAWL_FIXTURE = {
  result: [{ crawler: "PerplexityBot", requests: 33, action: "allow" }]
};

function fetchStub(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    for (const [match, route] of Object.entries(routes)) {
      if (url.includes(match)) {
        return new Response(JSON.stringify(route.body), {
          status: route.status ?? 200,
          headers: { "content-type": "application/json" }
        });
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fn, calls };
}

test("cloudflare: graphql + ai crawl control merged with kind tags", async () => {
  const { fn } = fetchStub({
    "/graphql": { body: CF_GRAPHQL_FIXTURE },
    "ai_crawl_control": { body: CF_CRAWL_FIXTURE }
  });
  const records = await cloudflareAdapter.pull({
    config: { zone_tag: "zone123" },
    secret: "cf-token",
    window: WINDOW,
    fetchFn: fn,
    log: noopLog
  });
  assert.equal(records.length, 3);
  const kinds = records.map((r) => (r as { kind: string }).kind);
  assert.deepEqual(kinds.sort(), ["ai_crawl_control", "graphql_bot_traffic", "graphql_bot_traffic"]);
  const blocked = records.find(
    (r) => (r as { dimensions?: { userAgent?: string } }).dimensions?.userAgent === "GPTBot/1.2"
  ) as { count: number };
  assert.equal(blocked.count, 120);
});

test("cloudflare: missing ai crawl control product is skipped, not fatal", async () => {
  const { fn } = fetchStub({
    "/graphql": { body: CF_GRAPHQL_FIXTURE },
    "ai_crawl_control": { status: 404, body: {} }
  });
  const records = await cloudflareAdapter.pull({
    config: { zone_tag: "zone123" },
    secret: "cf-token",
    window: WINDOW,
    fetchFn: fn,
    log: noopLog
  });
  assert.equal(records.length, 2);
});

test("cloudflare: graphql errors are fatal", async () => {
  const { fn } = fetchStub({
    "/graphql": { body: { errors: [{ message: "zone not found" }] } }
  });
  await assert.rejects(
    () =>
      cloudflareAdapter.pull({
        config: { zone_tag: "bad" },
        secret: "t",
        window: WINDOW,
        fetchFn: fn,
        log: noopLog
      }),
    /graphql errors/
  );
});

test("profound: follows cursor pagination to the end", async () => {
  let page = 0;
  const fn = (async () => {
    page++;
    return new Response(
      JSON.stringify(
        page === 1
          ? { data: [{ platform: "ChatGPT", url: "/a" }], next_cursor: "c2" }
          : { data: [{ platform: "Perplexity", url: "/b" }], next_cursor: null }
      ),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const records = await profoundAdapter.pull({
    config: {},
    secret: "pf-key",
    window: WINDOW,
    fetchFn: fn,
    log: noopLog
  });
  assert.equal(records.length, 2);
  assert.equal(page, 2);
  assert.equal((records[0] as { kind: string }).kind, "answer_request");
});

test("scrunch: pulls queries + responses and clamps window to 90 days", async () => {
  const seen: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push(url);
    return new Response(JSON.stringify({ data: [{ model: "Claude" }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  const wide = { since: "2025-01-01", until: "2026-06-11" };
  const records = await scrunchAdapter.pull({
    config: {},
    secret: "sc-key",
    window: wide,
    fetchFn: fn,
    log: noopLog
  });
  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((r) => (r as { kind: string }).kind),
    ["query", "response"]
  );
  // clamped: 90 days ending 2026-06-11 starts 2026-03-14
  assert.match(seen[0]!, /start_date=2026-03-14/);
});

test("computeWindow: lookback ending yesterday UTC", () => {
  const now = new Date("2026-06-12T08:00:00Z");
  assert.deepEqual(computeWindow({}, { now }), {
    since: "2026-06-05",
    until: "2026-06-11"
  });
  assert.deepEqual(computeWindow({ lookback_days: 1 }, { now }), {
    since: "2026-06-11",
    until: "2026-06-11"
  });
});
