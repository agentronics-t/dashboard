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
