// Neon serving-mirror schema. GCS is the source of truth — every table here
// is rebuildable from raw/ + derived/ Parquet. All writes are idempotent
// UPSERTs keyed by the UNIQUE constraints below.

import {
  bigint,
  boolean,
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

// Browser-safe publishable keys (agtx_pk_…) for the SDK's public API
// (/v1/pub/*): policy + site-memory sync, tool registry, traces, health.
// Public by design, so the key itself is stored. Writes are only accepted
// from the key's allowed origins; with none set, the key is read-only.
export const sdkPublishableKeys = pgTable(
  "sdk_publishable_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull().default("default"),
    allowedOrigins: jsonb("allowed_origins").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true })
  },
  (t) => [uniqueIndex("sdk_publishable_keys_key_uq").on(t.key), index("sdk_publishable_keys_tenant_idx").on(t.tenantId)]
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
    title: text("title"),
    // The description in the site's code (what Procedural memory optimises).
    description: text("description"),
    groupName: text("group_name"),
    page: text("page"),
    inputSchema: jsonb("input_schema").notNull().default({}),
    outputSchema: jsonb("output_schema"),
    annotations: jsonb("annotations"),
    tokens: integer("tokens").notNull().default(0),
    // From the browser's last WebMCP registration (tool.surfaced events):
    // callable | failed | disabled | unknown (never published yet).
    status: text("status").notNull().default("unknown"),
    statusError: text("status_error"),
    statusAt: timestamp("status_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [uniqueIndex("sdk_tool_registry_uq").on(t.tenantId, t.siteId, t.toolName)]
);

// Authorization rules managed in the console (Authz page). The SDK pulls them
// with createDashboardSync().pullConfig(). siteId "*" applies to every site.
// decision: allow | deny | review. minTrust: detected | declared | verified | linked.
export const sdkPolicies = pgTable(
  "sdk_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: text("site_id").notNull().default("*"),
    tool: text("tool").notNull(), // tool name or glob (cart.*)
    decision: text("decision").notNull(),
    minTrust: text("min_trust").notNull().default("detected"),
    allowedClasses: jsonb("allowed_classes").notNull().default([]),
    rateLimit: jsonb("rate_limit"), // { max, windowSeconds }
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("sdk_policies_uq").on(t.tenantId, t.siteId, t.tool),
    index("sdk_policies_tenant_idx").on(t.tenantId)
  ]
);

// Procedural memory: AI-written tool descriptions. A suggestion is shown next
// to the original with both token counts; once approved, pullConfig() hands it
// to the SDK, which publishes it to agents in place of the code's description.
export const sdkToolDescriptions = pgTable(
  "sdk_tool_descriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: text("site_id").notNull(),
    toolName: text("tool_name").notNull(),
    original: text("original").notNull(),
    suggested: text("suggested").notNull(),
    originalTokens: integer("original_tokens").notNull(),
    suggestedTokens: integer("suggested_tokens").notNull(),
    rationale: text("rationale"),
    status: text("status").notNull().default("suggested"), // suggested | approved | rejected
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true })
  },
  (t) => [uniqueIndex("sdk_tool_descriptions_uq").on(t.tenantId, t.siteId, t.toolName)]
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

// ---- billing (Razorpay Subscriptions) ---------------------------------------
// One row per Razorpay subscription we create. Razorpay webhooks are the source
// of truth for `status`; the tenant's plan is the newest row in
// active/authenticated/pending (see landing_page/docs/plan-entitlements.md).

export const billingSubscriptions = pgTable(
  "billing_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    razorpaySubscriptionId: text("razorpay_subscription_id").notNull(),
    razorpayPlanId: text("razorpay_plan_id").notNull(),
    plan: text("plan").notNull(), // pro | business
    cycle: text("cycle").notNull(), // monthly | yearly
    currency: text("currency").notNull(), // always "USD" (pricing is USD only)
    // created | authenticated | active | pending | halted | cancelled |
    // completed | expired | paused
    status: text("status").notNull(),
    // created_at of the newest Razorpay event applied — webhooks can arrive
    // out of order, so older events never overwrite newer state.
    statusAt: timestamp("status_at", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtCycleEnd: boolean("cancel_at_cycle_end").notNull().default(false),
    createdBy: text("created_by"), // Clerk user id
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("billing_subscriptions_rzp_uq").on(t.razorpaySubscriptionId),
    index("billing_subscriptions_tenant_idx").on(t.tenantId, t.createdAt)
  ]
);

/** Processed Razorpay webhook events (x-razorpay-event-id) — idempotency. */
export const billingEvents = pgTable("billing_events", {
  eventId: text("event_id").primaryKey(),
  event: text("event").notNull(),
  razorpaySubscriptionId: text("razorpay_subscription_id"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow()
});

// ---- agent API keys (agk_…) --------------------------------------------------
// Minted in the console's Auth page. Only the SHA-256 is stored. The customer's
// middleware verifies keys live with createDashboardSync().keyVerifier()
// (POST /v1/sdk/agent-keys/verify), or offline with staticKeyVerifier() over
// the AGENT_KEYS map the console exports (hash → identity).
export const agentKeys = pgTable(
  "agent_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    name: text("name").notNull(),
    vendor: text("vendor"),
    hashedKey: text("hashed_key").notNull(), // sha256 hex (matches hashAgentKey)
    prefix: text("prefix").notNull(), // agk_ + first 6 chars, for display
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true })
  },
  (t) => [
    uniqueIndex("agent_keys_hash_uq").on(t.hashedKey),
    index("agent_keys_tenant_idx").on(t.tenantId)
  ]
);

// ---- Agent Nic (GitHub → WebMCP pipeline) -----------------------------------
// The console's Agent Nic reads a customer's repo through our GitHub App,
// proposes WebMCP tools, and opens a PR. The agent-nick service writes these
// rows; the dashboard only reads them (plus the tenant's own review decision).

/** One row per GitHub App installation a tenant linked (verified via the user's GitHub OAuth). */
export const githubInstallations = pgTable(
  "github_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    installationId: bigint("installation_id", { mode: "number" }).notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").notNull(), // User | Organization
    repositorySelection: text("repository_selection").notNull(), // all | selected
    installedBy: text("installed_by"), // Clerk user id
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
  },
  (t) => [
    uniqueIndex("github_installations_tenant_inst_uq").on(t.tenantId, t.installationId),
    index("github_installations_inst_idx").on(t.installationId)
  ]
);

/** A repo the tenant handed to Agent Nic — the "site" on the Agent overview. */
export const agentNickSites = pgTable(
  "agent_nick_sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    installationId: bigint("installation_id", { mode: "number" }).notNull(),
    repoId: bigint("repo_id", { mode: "number" }).notNull(),
    repoFullName: text("repo_full_name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    isPrivate: boolean("is_private").notNull().default(true),
    homepage: text("homepage"),
    framework: text("framework"),
    // new | running | awaiting_review | pr_open | live | failed
    status: text("status").notNull().default("new"),
    lastRunId: uuid("last_run_id"),
    liveSha: text("live_sha"), // merge commit that put the tools live
    liveAt: timestamp("live_at", { withTimezone: true }),
    liveTools: integer("live_tools").notNull().default(0),
    // Latest push to the default branch (GitHub push webhook) — "last push" on the overview.
    lastPushSha: text("last_push_sha"),
    lastPushAt: timestamp("last_push_at", { withTimezone: true }),
    lastPushBy: text("last_push_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("agent_nick_sites_tenant_repo_uq").on(t.tenantId, t.repoId),
    index("agent_nick_sites_repo_idx").on(t.repoId)
  ]
);

/** One pipeline run (scan → propose → review → write → PR). LangGraph checkpoints live in their own schema. */
export const agentNickRuns = pgTable(
  "agent_nick_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => agentNickSites.id, { onDelete: "cascade" }),
    // queued | running | awaiting_review | pr_open | merged | closed | failed | cancelled
    status: text("status").notNull().default("queued"),
    step: text("step").notNull().default("queued"), // current pipeline step id
    baseSha: text("base_sha"),
    framework: text("framework"),
    pagesFound: integer("pages_found").notNull().default(0),
    actionsFound: integer("actions_found").notNull().default(0),
    toolsProposed: integer("tools_proposed").notNull().default(0),
    toolsApproved: integer("tools_approved").notNull().default(0),
    filesChanged: integer("files_changed").notNull().default(0),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    branch: text("branch"),
    prNumber: integer("pr_number"),
    prUrl: text("pr_url"),
    headSha: text("head_sha"),
    ciStatus: text("ci_status"), // pending | success | failure | none
    fixAttempts: integer("fix_attempts").notNull().default(0),
    decision: jsonb("decision"), // the tenant's review: approved tools + auth + plan
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    error: text("error"),
    createdBy: text("created_by"), // Clerk user id
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    mergedAt: timestamp("merged_at", { withTimezone: true })
  },
  (t) => [
    index("agent_nick_runs_site_idx").on(t.siteId, t.createdAt),
    index("agent_nick_runs_tenant_idx").on(t.tenantId, t.createdAt),
    index("agent_nick_runs_pr_idx").on(t.prNumber)
  ]
);

/** Append-only step log — drives the live pipeline view. */
export const agentNickEvents = pgTable(
  "agent_nick_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentNickRuns.id, { onDelete: "cascade" }),
    step: text("step").notNull(),
    kind: text("kind").notNull(), // start | done | fail | info | wait
    message: text("message").notNull(),
    data: jsonb("data"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("agent_nick_events_run_idx").on(t.runId, t.id)]
);

/** Tools a run proposed; `approved` is set from the review, `filePath` once written. */
export const agentNickTools = pgTable(
  "agent_nick_tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentNickRuns.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => agentNickSites.id, { onDelete: "cascade" }),
    page: text("page").notNull(), // route, e.g. /checkout
    name: text("name").notNull(),
    kind: text("kind").notNull(), // form (declarative) | script (registerTool)
    description: text("description").notNull(),
    inputSchema: jsonb("input_schema").notNull(),
    risk: text("risk").notNull(), // read | write | payment | destructive
    readOnly: boolean("read_only").notNull().default(false),
    consequential: boolean("consequential").notNull().default(false),
    auth: text("auth").notNull().default("public"), // public | signed_in | scoped
    source: jsonb("source").notNull(), // where in the code the action lives
    approved: boolean("approved").notNull().default(true),
    filePath: text("file_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("agent_nick_tools_run_name_uq").on(t.runId, t.name),
    index("agent_nick_tools_site_idx").on(t.siteId)
  ]
);

/** The workspace's paid plan (Dodo Payments subscription). One row per tenant. */
export const workspacePlans = pgTable("workspace_plans", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  plan: text("plan").notNull(), // lite | starter | team | business
  // active | on_hold | cancelled | failed | expired | pending
  status: text("status").notNull(),
  dodoSubscriptionId: text("dodo_subscription_id"),
  dodoCustomerId: text("dodo_customer_id"),
  checkoutSessionId: text("checkout_session_id"), // pending checkout, confirmed on return/webhook
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  billingInterval: text("billing_interval").notNull().default("month"), // month | year
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
