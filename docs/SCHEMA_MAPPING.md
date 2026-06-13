# SCHEMA_MAPPING — connector sources → `agent_traffic_daily`

This is the contract between the import worker (writes `raw/`) and the ML job
(reads `raw/`, writes `derived/` + Neon). The normalized row shape is defined
once, in `packages/intel-schema/src/envelope.ts` (`agentTrafficDailyRow`), and
mirrored by the `agent_traffic_daily` Neon table.

## GCS layout (canonical — built only via `packages/intel-schema/src/paths.ts`)

```
raw/{source}/{tenant_id}/dt={YYYY-MM-DD}/job={job_id}/part-NNNNN.parquet   immutable, replayable
derived/{tenant_id}/agent_traffic_daily/dt={YYYY-MM-DD}/part-NNNNN.parquet source of truth
models/{tenant_id}/{metric}/{model_version}/model.pkl + metadata.json
```

- `raw/` objects are **never** overwritten or deleted: a retried/replayed job has a
  new `job_id`, hence a new prefix. Partial writes from a failed attempt of the
  *same* job overwrite themselves (same path), which is safe.
- `derived/` partitions are overwritten atomically per `dt` by the ML job —
  last successful job wins. Lineage is the `job_id` column inside the rows.

## Raw Parquet schema (every source, schema_version = 1)

| column         | parquet type     | notes                                   |
|----------------|------------------|-----------------------------------------|
| ingested_at    | TIMESTAMP_MILLIS | when the worker pulled the record       |
| job_id         | UTF8             | import job UUID                         |
| source         | UTF8             | cloudflare \| profound \| scrunch       |
| schema_version | INT32            | bump on envelope changes                |
| payload        | UTF8             | source-native record, JSON verbatim     |

The payload is intentionally opaque at the raw layer: normalization happens in
the ML job (Python) per the tables below, so mapping bugs are fixable by
re-running normalization over immutable raw data.

## Normalized row (`agent_traffic_daily`, one row per tenant·date·source·agent)

| field       | type                            | semantics                                          |
|-------------|---------------------------------|----------------------------------------------------|
| tenant_id   | uuid                            | owning tenant                                      |
| date        | YYYY-MM-DD (UTC)                | activity day                                       |
| source      | cloudflare\|profound\|scrunch   | where the record came from                         |
| agent_name  | text                            | canonical agent name (see Agent canon below)       |
| agent_lane  | webmcp\|webbotauth\|stealth     | how the agent identifies itself (see Lanes below)  |
| requests    | int ≥ 0                         | total requests observed                            |
| blocked     | int ≥ 0                         | requests denied by enforcement                     |
| allowed     | int ≥ 0                         | requests served (requests = blocked + allowed when the source reports both; otherwise allowed = requests − blocked) |
| pages       | int ≥ 0                         | distinct pages/paths touched (0 if source lacks it)|
| conversions | int ≥ 0                         | attribution-ready; 0 until attribution lands       |
| job_id      | uuid                            | ML job that produced the row (lineage)             |

Aggregation rule: when multiple raw records map to the same
(tenant_id, date, source, agent_name) key, counts are **summed**; the row is
UPSERTed into Neon on that same key.

## Lane classification (applied in order)

1. `webmcp` — request arrived via the WebMCP/MCP endpoint surface (source flags
   it as MCP traffic, or path/feature field marks an MCP session).
2. `webbotauth` — agent presented a verifiable identity: Web Bot Auth signature,
   verified-bot status (Cloudflare `verifiedBot`/managed bot category), or a
   declared+verified UA in the source's bot directory.
3. `stealth` — everything else classified as automated/AI traffic without
   verified identity (undeclared scrapers, spoofed UAs, unverified crawlers).

Human traffic is **excluded** before normalization — this table is agent traffic only.

## Per-source mapping

### Cloudflare (GraphQL Analytics API + AI Crawl Control)

Raw payloads: GraphQL nodes grouped by date/bot + AI Crawl Control export rows.

| normalized   | from                                                                 |
|--------------|----------------------------------------------------------------------|
| date         | `dimensions.date` / `datetimeHour` truncated to UTC day               |
| agent_name   | bot name (`botName` / crawler name in AI Crawl Control); fallback canonicalized UA |
| agent_lane   | MCP-flagged → webmcp; `verifiedBot=true` or Web Bot Auth header seen → webbotauth; else stealth |
| requests     | sum of `count` / request totals                                       |
| blocked      | sum where enforcement action ∈ {block, challenge, managed_challenge} or AI Crawl Control verdict = blocked |
| allowed      | requests − blocked                                                    |
| pages        | distinct `clientRequestPath` count when queried, else 0               |

### Profound (TS SDK, per-request fields)

| normalized   | from                                                       |
|--------------|------------------------------------------------------------|
| date         | request timestamp → UTC day                                |
| agent_name   | Profound agent/platform identifier (e.g. ChatGPT, Perplexity) |
| agent_lane   | Profound marks verified crawlers → webbotauth; MCP-tagged → webmcp; else stealth |
| requests     | count of request records per key                           |
| blocked      | count where status/action = blocked/denied (0 if absent)   |
| allowed      | requests − blocked                                         |
| pages        | distinct page/url values per key                           |

### Scrunch (query + responses API, 90-day window)

| normalized   | from                                                        |
|--------------|-------------------------------------------------------------|
| date         | response/query date → UTC day                               |
| agent_name   | answering platform/model (e.g. ChatGPT, Gemini, Claude)     |
| agent_lane   | webbotauth when Scrunch confirms platform identity (its data is platform-attributed by construction); else stealth |
| requests     | count of query/response records per key                     |
| blocked      | 0 (Scrunch observes answers, not enforcement)               |
| allowed      | = requests                                                  |
| pages        | distinct cited/landing URLs per key                         |

## Agent canon

`agent_name` is canonicalized so the same agent from different sources lands on
one name: trim, collapse whitespace, title-case known aliases
(`gptbot`→`GPTBot`, `claudebot`→`ClaudeBot`, `chatgpt-user`→`ChatGPT-User`,
`perplexitybot`→`PerplexityBot`, `google-extended`→`Google-Extended`).
Unknown names pass through trimmed. The canon table lives with the ML
normalizer (single owner) — extend it there, never inline in connectors.

## Versioning

- Envelope changes bump `RAW_SCHEMA_VERSION` (`packages/intel-schema/src/envelope.ts`).
- Mapping changes are recorded in this file with a dated changelog entry; the
  ML job re-derives historical `derived/` partitions from raw when a mapping
  change is backfilled.

### Changelog
- 2026-06-12 — v1, initial contract.
