// Profound adapter: per-request answer-engine visibility records.
// Secret = API key (Bearer). Cursor-paginated date-window pull.
//
// base_url/path defaults are pinned at the live verification (BUILD_LOG STEP 5)
// and overridable via connector config:
//   config.base_url — API origin
//   config.path     — records endpoint

import { z } from "zod";
import { fetchWithRetry } from "../lib/http.ts";
import type { ConnectorAdapter, ConnectorContext } from "./types.ts";

const configSchema = z.object({
  base_url: z.string().url().default("https://api.tryprofound.com"),
  path: z.string().default("/v1/answers/requests"),
  lookback_days: z.unknown().optional()
});

const MAX_PAGES = 50;

export const profoundAdapter: ConnectorAdapter = {
  source: "profound",

  async pull(ctx: ConnectorContext): Promise<unknown[]> {
    const config = configSchema.parse(ctx.config);
    const records: unknown[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(config.path, config.base_url);
      url.searchParams.set("start_date", ctx.window.since);
      url.searchParams.set("end_date", ctx.window.until);
      if (cursor) url.searchParams.set("cursor", cursor);

      const res = await fetchWithRetry(
        url.toString(),
        { headers: { Authorization: `Bearer ${ctx.secret}` } },
        { fetchFn: ctx.fetchFn }
      );
      const body = (await res.json()) as {
        data?: unknown[];
        next_cursor?: string | null;
      };
      for (const row of body.data ?? []) {
        records.push({ kind: "answer_request", ...(row as object) });
      }
      if (!body.next_cursor) break;
      cursor = body.next_cursor;
    }

    ctx.log("profound pull complete", { records: records.length });
    return records;
  }
};
