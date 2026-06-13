// Scrunch adapter: query + responses APIs (answer-engine monitoring).
// Secret = API key (Bearer). Window clamped to Scrunch's 90-day retention.
//
// base_url/endpoints pinned at live verification (BUILD_LOG STEP 5); overridable:
//   config.base_url        — API origin
//   config.queries_path    — queries endpoint
//   config.responses_path  — responses endpoint

import { z } from "zod";
import { fetchWithRetry } from "../lib/http.ts";
import type { ConnectorAdapter, ConnectorContext, PullWindow } from "./types.ts";

const configSchema = z.object({
  base_url: z.string().url().default("https://api.scrunchai.com"),
  queries_path: z.string().default("/v1/queries"),
  responses_path: z.string().default("/v1/responses"),
  lookback_days: z.unknown().optional()
});

const MAX_WINDOW_DAYS = 90;

function clampWindow(window: PullWindow): PullWindow {
  const day = 24 * 60 * 60 * 1000;
  const until = new Date(`${window.until}T00:00:00Z`);
  const since = new Date(`${window.since}T00:00:00Z`);
  const floor = new Date(until.getTime() - (MAX_WINDOW_DAYS - 1) * day);
  return {
    since: (since < floor ? floor : since).toISOString().slice(0, 10),
    until: window.until
  };
}

export const scrunchAdapter: ConnectorAdapter = {
  source: "scrunch",

  async pull(ctx: ConnectorContext): Promise<unknown[]> {
    const config = configSchema.parse(ctx.config);
    const window = clampWindow(ctx.window);
    if (window.since !== ctx.window.since) {
      ctx.log("scrunch window clamped to 90 days", { ...window });
    }
    const headers = { Authorization: `Bearer ${ctx.secret}` };
    const records: unknown[] = [];

    for (const [kind, path] of [
      ["query", config.queries_path],
      ["response", config.responses_path]
    ] as const) {
      const url = new URL(path, config.base_url);
      url.searchParams.set("start_date", window.since);
      url.searchParams.set("end_date", window.until);
      const res = await fetchWithRetry(
        url.toString(),
        { headers },
        { fetchFn: ctx.fetchFn }
      );
      const body = (await res.json()) as { data?: unknown[] };
      for (const row of body.data ?? []) {
        records.push({ kind, ...(row as object) });
      }
    }

    ctx.log("scrunch pull complete", { records: records.length });
    return records;
  }
};
