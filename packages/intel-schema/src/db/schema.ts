// Neon serving-mirror schema. GCS is the source of truth — every table here
// is rebuildable from raw/ + derived/ Parquet. All writes are idempotent
// UPSERTs keyed by the UNIQUE constraints below.

import {
  bigint,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector
} from "drizzle-orm/pg-core";

export const connectorType = pgEnum("connector_type", [
  "cloudflare",
  "profound",
  "scrunch"
]);

export const jobType = pgEnum("job_type", ["import", "ml", "insight"]);

// State machine: queued → running → succeeded | failed
export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed"
]);

export const agentLane = pgEnum("agent_lane", [
  "webmcp",
  "webbotauth",
  "stealth"
]);

export const insightSeverity = pgEnum("insight_severity", [
  "info",
  "warning",
  "critical"
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  clerkOrgId: text("clerk_org_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow()
});

export const connectors = pgTable(
  "connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    type: connectorType("type").notNull(),
    // Non-secret config (account ids, zone ids, date windows…)
    config: jsonb("config").notNull().default({}),
    // Secret Manager resource name — never the secret itself
    secretRef: text("secret_ref"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [uniqueIndex("connectors_tenant_type_uq").on(t.tenantId, t.type)]
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id").references(() => connectors.id, {
      onDelete: "set null"
    }),
    type: jobType("type").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    // { raw: ["gs://…"], derived: ["gs://…"], models: ["gs://…"] }
    gcsPaths: jsonb("gcs_paths").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    index("jobs_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("jobs_status_idx").on(t.status)
  ]
);

export const agentTrafficDaily = pgTable(
  "agent_traffic_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    source: connectorType("source").notNull(),
    agentName: text("agent_name").notNull(),
    agentLane: agentLane("agent_lane").notNull(),
    requests: bigint("requests", { mode: "number" }).notNull().default(0),
    blocked: bigint("blocked", { mode: "number" }).notNull().default(0),
    allowed: bigint("allowed", { mode: "number" }).notNull().default(0),
    pages: bigint("pages", { mode: "number" }).notNull().default(0),
    // conversions-ready fields (populated when attribution lands)
    conversions: bigint("conversions", { mode: "number" }).notNull().default(0),
    // lineage: last job that wrote this row
    jobId: uuid("job_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    uniqueIndex("agent_traffic_daily_uq").on(
      t.tenantId,
      t.date,
      t.source,
      t.agentName
    ),
    index("agent_traffic_daily_tenant_date_idx").on(t.tenantId, t.date)
  ]
);

export const forecasts = pgTable(
  "forecasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    horizonDate: date("horizon_date").notNull(),
    p10: doublePrecision("p10").notNull(),
    p50: doublePrecision("p50").notNull(),
    p90: doublePrecision("p90").notNull(),
    modelVersion: text("model_version").notNull(),
    jobId: uuid("job_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    uniqueIndex("forecasts_uq").on(t.tenantId, t.metric, t.horizonDate)
  ]
);

export const insights = pgTable(
  "insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    severity: insightSeverity("severity").notNull().default("info"),
    embedding: vector("embedding", { dimensions: 768 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    // deterministic identity: one insight per (job, kind)
    uniqueIndex("insights_job_kind_uq").on(t.jobId, t.kind),
    index("insights_tenant_created_idx").on(t.tenantId, t.createdAt)
  ]
);

export const billingUsage = pgTable(
  "billing_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // calendar month, e.g. "2026-06"
    period: text("period").notNull(),
    governedCalls: bigint("governed_calls", { mode: "number" })
      .notNull()
      .default(0)
  },
  (t) => [uniqueIndex("billing_usage_uq").on(t.tenantId, t.period)]
);

// ---------------------------------------------------------------------------
// SDK event stream (pushed by customer backends via POST /v1/sdk/events).
// Parallel to the batch traffic pipeline above: real-time per-event ingest,
// raw append-only log + at-ingest rollups. Powers the dashboard's SDK pages.
// ---------------------------------------------------------------------------

// Mirrors @agentronics/protocol TraceEventType (kept in sync; see src/sdk.ts).
export const sdkEventType = pgEnum("sdk_event_type", [
  "agent.detected",
  "agent.missed",
  "auth.identity_presented",
  "auth.identity_cleared",
  "authz.policies_set",
  "authz.evaluated",
  "memory.accessed",
  "memory.updated",
  "tool.registered",
  "tool.executed",
  "tool.surfaced",
  "tool.progressed",
  "sdk.error"
]);

export const sdkEventOutcome = pgEnum("sdk_event_outcome", [
  "success",
  "error",
  "blocked"
]);

// Per-tenant ingest credentials. Only the SHA-256 hash is stored; the raw
// `agtx_ik_…` key is shown once at creation. `revoked_at IS NULL` == active.
export const sdkIngestKeys = pgTable(
  "sdk_ingest_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    hashedKey: text("hashed_key").notNull(),
    // agtx_ik_ + first 8 chars of the raw key, for display in the dashboard
    prefix: text("prefix").notNull(),
    label: text("label").notNull().default("default"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true })
  },
  (t) => [
    uniqueIndex("sdk_ingest_keys_hash_uq").on(t.hashedKey),
    index("sdk_ingest_keys_tenant_idx").on(t.tenantId)
  ]
);

// Append-only raw event log. PK = SDK-provided event id → idempotent ingest.
export const sdkEvents = pgTable(
  "sdk_events",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: text("site_id").notNull(),
    sessionId: text("session_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    type: sdkEventType("type").notNull(),
    tool: text("tool"),
    agentClass: text("agent_class"),
    agentVendor: text("agent_vendor"),
    trust: text("trust"),
    outcome: sdkEventOutcome("outcome").notNull(),
    durationMs: integer("duration_ms"),
    page: text("page"),
    protocol: text("protocol"),
    error: text("error"),
    metadata: jsonb("metadata").notNull().default({}),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    index("sdk_events_tenant_occurred_idx").on(t.tenantId, t.occurredAt),
    index("sdk_events_tenant_type_idx").on(t.tenantId, t.type, t.occurredAt),
    index("sdk_events_tenant_site_idx").on(t.tenantId, t.siteId)
  ]
);

// At-ingest rollup: one row per tenant·date·type·agentClass·outcome.
// agentClass = "none" when the event has no agent (e.g. authz.policies_set).
export const sdkEventDaily = pgTable(
  "sdk_event_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    type: sdkEventType("type").notNull(),
    agentClass: text("agent_class").notNull().default("none"),
    outcome: sdkEventOutcome("outcome").notNull(),
    count: bigint("count", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    uniqueIndex("sdk_event_daily_uq").on(
      t.tenantId,
      t.date,
      t.type,
      t.agentClass,
      t.outcome
    ),
    index("sdk_event_daily_tenant_date_idx").on(t.tenantId, t.date)
  ]
);

// Latest synced tool registry per site (from tool.registered events / syncTools).
export const sdkToolRegistry = pgTable(
  "sdk_tool_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: text("site_id").notNull(),
    toolName: text("tool_name").notNull(),
    groupName: text("group_name"),
    page: text("page"),
    inputSchema: jsonb("input_schema").notNull().default({}),
    outputSchema: jsonb("output_schema"),
    tokens: integer("tokens").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [uniqueIndex("sdk_tool_registry_uq").on(t.tenantId, t.siteId, t.toolName)]
);

// Latest site-memory snapshot + quality score per site (Knaph page).
export const sdkSiteMemory = pgTable(
  "sdk_site_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: text("site_id").notNull(),
    snapshot: jsonb("snapshot").notNull().default({}),
    score: integer("score"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [uniqueIndex("sdk_site_memory_uq").on(t.tenantId, t.siteId)]
);

// ML over the SDK stream (intel-ml `--sdk` pass). Deliberately separate from the
// web-traffic `forecasts`/`insights` tables so the SDK pages own this data and
// the traffic Forecast/Insights/Chat (+ its pgvector RAG) are never affected.

// 14-day forecasts of SDK volume. metric ∈ {sdk_events, sdk_detections,
// sdk_tool_calls, sdk_blocked}.
export const sdkForecasts = pgTable(
  "sdk_forecasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    horizonDate: date("horizon_date").notNull(),
    p10: doublePrecision("p10").notNull(),
    p50: doublePrecision("p50").notNull(),
    p90: doublePrecision("p90").notNull(),
    modelVersion: text("model_version").notNull(),
    jobId: uuid("job_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [uniqueIndex("sdk_forecasts_uq").on(t.tenantId, t.metric, t.horizonDate)]
);

// AI insights over the SDK stream. No `embedding` — these are not in the Agent
// Chat RAG (kept separate). Latest row per (tenant, kind).
export const sdkInsights = pgTable(
  "sdk_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    jobId: uuid("job_id"),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    severity: insightSeverity("severity").notNull().default("info"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    uniqueIndex("sdk_insights_uq").on(t.tenantId, t.kind),
    index("sdk_insights_tenant_created_idx").on(t.tenantId, t.createdAt)
  ]
);
