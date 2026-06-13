// Cloudflare adapter: GraphQL Analytics API (automated/bot traffic by day and
// agent) + AI Crawl Control export. Secret = API token (Analytics:Read).
//
// Field names in BOT_TRAFFIC_QUERY and the AI Crawl Control path are pinned at
// the live end-to-end verification with real credentials (see BUILD_LOG STEP 5);
// both are overridable via connector config so a fix never needs a redeploy:
//   config.graphql_query        — full replacement query (same variables)
//   config.ai_crawl_control_path — REST path relative to /client/v4/

import { z } from "zod";
import { fetchWithRetry } from "../lib/http.ts";
import type { ConnectorAdapter, ConnectorContext } from "./types.ts";

const API_BASE = "https://api.cloudflare.com/client/v4";

const BOT_TRAFFIC_QUERY = /* GraphQL */ `
  query BotTraffic($zoneTag: String!, $since: String!, $until: String!) {
    viewer {
      zones(filter: { zoneTag: $zoneTag }) {
        httpRequestsAdaptiveGroups(
          limit: 10000
          filter: {
            date_geq: $since
            date_leq: $until
            botClass_in: ["likelyAutomated", "automated"]
          }
        ) {
          count
          dimensions {
            date
            botClass
            userAgent
            securityAction
          }
        }
      }
    }
  }
`;

const configSchema = z.object({
  zone_tag: z.string().min(1),
  graphql_query: z.string().optional(),
  ai_crawl_control_path: z.string().optional(),
  lookback_days: z.unknown().optional()
});

export const cloudflareAdapter: ConnectorAdapter = {
  source: "cloudflare",

  async pull(ctx: ConnectorContext): Promise<unknown[]> {
    const config = configSchema.parse(ctx.config);
    const headers = {
      Authorization: `Bearer ${ctx.secret}`,
      "Content-Type": "application/json"
    };
    const records: unknown[] = [];

    // 1. GraphQL Analytics — bot/AI traffic with enforcement action
    const gqlRes = await fetchWithRetry(
      `${API_BASE}/graphql`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: config.graphql_query ?? BOT_TRAFFIC_QUERY,
          variables: {
            zoneTag: config.zone_tag,
            since: ctx.window.since,
            until: ctx.window.until
          }
        })
      },
      { fetchFn: ctx.fetchFn }
    );
    const gql = (await gqlRes.json()) as {
      data?: { viewer?: { zones?: { httpRequestsAdaptiveGroups?: unknown[] }[] } };
      errors?: unknown[];
    };
    if (gql.errors?.length) {
      throw new Error(`cloudflare graphql errors: ${JSON.stringify(gql.errors).slice(0, 500)}`);
    }
    for (const group of gql.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? []) {
      records.push({ kind: "graphql_bot_traffic", ...(group as object) });
    }

    // 2. AI Crawl Control export — best-effort: skip (with warning) if the
    //    product is not enabled on the zone (404/403).
    const crawlPath =
      config.ai_crawl_control_path ??
      `zones/${config.zone_tag}/ai_crawl_control/crawlers`;
    const crawlRes = await (ctx.fetchFn ?? fetch)(`${API_BASE}/${crawlPath}`, { headers });
    if (crawlRes.ok) {
      const body = (await crawlRes.json()) as { result?: unknown[] };
      for (const row of body.result ?? []) {
        records.push({ kind: "ai_crawl_control", ...(row as object) });
      }
    } else if (crawlRes.status === 404 || crawlRes.status === 403) {
      ctx.log("ai crawl control not available on zone — skipped", {
        status: crawlRes.status
      });
    } else {
      throw new Error(`cloudflare ai crawl control: HTTP ${crawlRes.status}`);
    }

    ctx.log("cloudflare pull complete", { records: records.length });
    return records;
  }
};
