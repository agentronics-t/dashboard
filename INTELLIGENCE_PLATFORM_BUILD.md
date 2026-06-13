# INTELLIGENCE_PLATFORM_BUILD.md — Agentronics Intelligence Platform (Backend)

> **For Claude Code.** This is the master build plan. Execute steps **in order**. Do not skip, reorder, or invent architecture. The system design is fixed (see ARCHITECTURE CONTRACT below). If something is ambiguous, STOP and ask — do not guess.

---

## OPERATING PROTOCOL (applies to every step)

For **each step** below, follow this exact loop:

1. **ANNOUNCE** — Before touching anything, print a short block:
   - `STEP N — <name>`
   - What you are about to do (2–4 lines)
   - What files/services it touches
   - Wait for user confirmation only if the step is marked `[CONFIRM]`. Otherwise proceed.
2. **EXECUTE** — Do the work. Smallest viable implementation that is production-grade (idempotent, typed, error-handled, logged). No speculative features.
3. **EXTERNAL STEPS** — Print a checklist titled `🔧 MANUAL STEPS (Nithin)` listing everything the user must do outside the repo (GCP console, gcloud commands to run with his account, Neon console, Clerk dashboard, Vercel env vars). Be exact: full commands, exact console paths, exact env var names. If none, say `None`.
4. **TEST** — Run the verification listed in the step's **Verify** section. Local tests run automatically; cloud verifications that need deployed infra go into MANUAL STEPS with the exact command + expected output.
5. **LOG** — Append a section to `docs/BUILD_LOG.md` (create on first step):
   ```md
   ## STEP N — <name> · <date>
   **Did:** ...
   **Files:** ...
   **External steps issued:** ...
   **Tests run / results:** ...
   **Status:** ✅ done | ⚠️ blocked on manual step | ❌ failed (reason)
   **Next:** STEP N+1
   ```
   Never overwrite previous log entries. The log is the single source of truth for build state — read it at session start to resume.

---

## ARCHITECTURE CONTRACT (do not deviate)

```
Trigger (Cloud Scheduler cron OR dashboard click)
  → API (Cloud Run, Node/TS)  — verifies Clerk session, enqueues job
  → Cloud Tasks (import-jobs queue)
  → Import Worker (Cloud Run, Node/TS)
      — reads connector creds from Secret Manager
      — pulls: Cloudflare (GraphQL Analytics API + AI Crawl Control),
               Profound (TS SDK), Scrunch (query + responses API)
      — writes raw Parquet → GCS raw/   (immutable, replayable)
      — updates job status in Neon
      — triggers ML Job
  → ML Job (Cloud Run Job, Python)
      — reads raw/ → features → CLOUD RETRAIN (forecast + stats)
      — writes derived/ Parquet (SOURCE OF TRUTH) + models/ artifacts → GCS
      — upserts aggregates + forecasts → Neon
  → Insight Layer (Vertex AI — Gemini, GCP-native auth, NO API keys)
      — predefined agents/skills/prompts over model output
      — writes NL insights + embeddings (pgvector) → Neon
  → Neon Postgres (SERVING MIRROR): aggregates, forecasts, insights,
      pgvector, app state (tenants, connectors, jobs, billing)
  → Next.js dashboard (Vercel, Clerk): charts, NL insights, agent chat
      (pgvector retrieval + aggregate queries, streamed answers)
```

**Fixed decisions:**
- Region: `asia-south1` everywhere. GCS buckets, Cloud Run, Cloud Tasks, Vertex AI calls.
- GCS is the source of truth; Neon is a rebuildable serving mirror.
- Training happens **in cloud** (Cloud Run Job retrains every run). No local artifact uploads.
- Gemini via **Vertex AI** with service-account auth — never a Gemini API key.
- Code lives in the **existing Turborepo** as new packages (Step 1 layout).
- Every pipeline stage is idempotent, keyed by `job_id`. Re-running a job must never duplicate data (Parquet paths include `job_id`; Neon writes are UPSERTs).
- PostHog is **out of scope** — do not add it even though older diagrams mention it.
- All services emit OpenTelemetry traces + structured JSON logs.

---

## STEP 0 — Preflight & GCP foundation `[CONFIRM]`

**Will do:** Verify local tooling (`gcloud`, `node`, `pnpm`, `python3.12`, `docker`), confirm GCP project, write `infra/gcp-bootstrap.sh` that enables required APIs (Run, Tasks, Scheduler, Secret Manager, Storage, Artifact Registry, Vertex AI), creates Artifact Registry repo, creates three service accounts with least-privilege roles (`intel-api`, `intel-worker`, `intel-ml`), and creates GCS bucket `agentronics-intel-<project>` (asia-south1, uniform access) with `raw/ derived/ models/` prefixes.

**External:** User creates/selects GCP project + billing, runs `gcloud auth login`, runs the bootstrap script, applies for Google for Startups credits separately.

**Verify:** `gcloud services list --enabled` shows all APIs; `gsutil ls` shows bucket; SAs exist with expected roles only.

---

## STEP 1 — Monorepo scaffolding

**Will do:** Add to the existing Turborepo:

```
apps/intel-api/        Node 20 + TS + Fastify  — Cloud Run service
apps/intel-worker/     Node 20 + TS            — Cloud Run service
apps/intel-ml/         Python 3.12 + uv        — Cloud Run Job (own Dockerfile, outside turbo graph but in repo)
packages/intel-schema/ shared zod schemas, TS types, SQL migrations (drizzle), normalized event model
infra/                 bootstrap + deploy scripts, Cloud Tasks/Scheduler config
docs/BUILD_LOG.md
```

Wire turbo pipeline, tsconfig, eslint, dockerfiles (distroless, multi-stage), `.env.example` per app. No business logic yet — each service boots with `/healthz`.

**External:** None.

**Verify:** `pnpm turbo build` green; `docker build` succeeds for all three; `/healthz` returns 200 locally.

---

## STEP 2 — Neon schema + migrations

**Will do:** In `packages/intel-schema`, define drizzle migrations for:

- `tenants`, `connectors` (type: cloudflare|profound|scrunch, config JSONB, secret_ref → Secret Manager name, never the secret itself)
- `jobs` (id, tenant_id, type: import|ml|insight, status state machine: queued→running→succeeded|failed, attempt, started_at, finished_at, error, gcs_paths JSONB)
- `agent_traffic_daily` (the normalized aggregate: tenant, date, source, agent_name, agent_lane [webmcp|webbotauth|stealth], requests, blocked, allowed, pages, conversions-ready fields)
- `forecasts` (tenant, metric, horizon_date, p50/p10/p90, model_version, job_id)
- `insights` (tenant, job_id, kind, title, body_md, severity, embedding vector(768))
- `billing_usage` (tenant, period, governed_calls)
- Enable `pgvector`; UNIQUE constraints that make every write an idempotent UPSERT.

**External:** User creates Neon project/branch, pastes `DATABASE_URL` into Secret Manager (`neon-database-url`) and local `.env`.

**Verify:** `pnpm db:migrate` applies cleanly twice (idempotent); seed script inserts demo tenant; `SELECT` round-trip test passes.

---

## STEP 3 — GCS data layout + Parquet conventions

**Will do:** Implement in `packages/intel-schema` + worker libs the canonical paths and writers:

```
raw/{source}/{tenant_id}/dt={YYYY-MM-DD}/job={job_id}/part-*.parquet   (immutable)
derived/{tenant_id}/agent_traffic_daily/dt=.../part-*.parquet          (source of truth)
models/{tenant_id}/{metric}/{model_version}/model.pkl + metadata.json
```

Raw rows keep source-native fields + an envelope (ingested_at, job_id, source, schema_version). Document the unified normalized schema mapping (Cloudflare/Profound/Scrunch → `agent_traffic_daily`) in `docs/SCHEMA_MAPPING.md` — this is the contract the ML job reads.

**External:** None.

**Verify:** Unit test writes/reads a Parquet file against GCS emulator (or a `tmp/` local FS adapter); path builder snapshot tests.

---

## STEP 4 — API service (Cloud Run)

**Will do:** `apps/intel-api`: Fastify + Clerk JWT verification middleware. Endpoints:

- `POST /v1/imports` — validates connector, creates `jobs` row, enqueues Cloud Tasks task (payload: job_id only)
- `GET /v1/jobs/:id`, `GET /v1/jobs?tenant=`
- `POST /v1/connectors` / `GET /v1/connectors` — stores config in Neon, secret in Secret Manager via API (server writes secret, stores only the ref)
- OTel + structured logs, request-id propagation.

**External:** User adds Clerk JWKS/issuer env vars; deploys via provided `infra/deploy-api.sh` (`gcloud run deploy`, asia-south1, SA `intel-api`, min-instances 0).

**Verify:** Local integration tests with mocked Clerk + Tasks; after deploy, `curl /healthz` and an authenticated `POST /v1/imports` returns 202 with job_id (manual step with exact curl).

---

## STEP 5 — Import worker (Cloud Run)

**Will do:** `apps/intel-worker`: HTTP target for Cloud Tasks (`POST /tasks/import`). Flow: load job → mark running → fetch secret → run the connector adapter → write raw Parquet → update job (gcs_paths) → trigger ML job (Cloud Run Jobs API `run`) → mark succeeded. Adapters (each behind one interface, each with cursor/date-window incremental pull + rate-limit handling):

1. **Cloudflare** — GraphQL Analytics API (bot/AI traffic, blocking + enforcement) + AI Crawl Control export
2. **Profound** — TS SDK, per-request fields
3. **Scrunch** — query + responses API (90-day window)

Idempotency: if job already succeeded, return 200 immediately; raw path includes job_id so retries can't corrupt. Failures → structured error on job row; Cloud Tasks retry policy handles backoff; max attempts then `failed`.

**External:** User stores real connector creds in Secret Manager (exact `gcloud secrets create` commands provided), deploys worker, creates `import-jobs` queue with retry config (script provided).

**Verify:** Unit tests per adapter against recorded fixtures; local end-to-end with one real Cloudflare pull into a dev bucket; job row transitions assert the full state machine.

---

## STEP 6 — ML job (Cloud Run Job, Python) — cloud retrain

**Will do:** `apps/intel-ml`: Python 3.12, entrypoint `python -m intel_ml.run --job-id ...`. Pipeline:

1. Read `raw/` for the tenant/date-window (pyarrow) → normalize to `agent_traffic_daily` per `SCHEMA_MAPPING.md`
2. Write `derived/` Parquet (source of truth)
3. **Retrain in cloud every run:** per metric — forecasting (start: statsmodels/Prophet-class baseline with p10/p50/p90) + statistical analysis (trend, anomaly flags, week-over-week deltas, share-shift by agent lane)
4. Persist `models/` artifacts + `metadata.json` (version, train window, metrics like MAPE)
5. UPSERT aggregates + forecasts into Neon
6. Trigger insight stage (Step 7 module) before exiting; mark ml job succeeded.

Keep models swappable behind a `Forecaster` interface — model choice can upgrade later without touching the pipeline.

**External:** User deploys the Cloud Run Job (`infra/deploy-ml.sh`), grants `intel-ml` SA read/write on bucket + Neon secret access.

**Verify:** Pytest on normalization + forecaster with synthetic fixtures (golden-file outputs); backtest report printed (MAPE on held-out window); manual: execute job once against dev data, confirm derived/ + models/ + Neon rows.

---

## STEP 7 — Insight layer (Vertex AI Gemini)

**Will do:** Python module inside `intel-ml` (same job, final stage — no extra service):

- Predefined **agent prompt registry** (`intel_ml/insights/prompts/`): versioned prompt templates per insight kind — e.g. `traffic_shift`, `forecast_summary`, `anomaly_explainer`, `agent_lane_breakdown`
- Input: structured JSON from Step 6 (stats + forecasts), never raw Parquet — bounded context, no hallucinated numbers (numbers are injected, Gemini only narrates)
- Call **Vertex AI** (`google-cloud-aiplatform`, region asia-south1, SA auth) — Gemini for NL insights, Vertex embedding model for `insights.embedding` (768-dim, matches pgvector column)
- UPSERT insights into Neon; deterministic insight ids (job_id + kind) for idempotency
- Guardrails: output schema validated (pydantic); retry once on schema failure; on persistent failure store stats-only fallback insight.

**External:** User enables Vertex AI API (already in Step 0 bootstrap), confirms model availability in asia-south1, grants `intel-ml` SA `roles/aiplatform.user`.

**Verify:** Unit tests with mocked Vertex client validating schema + idempotent ids; one manual live run producing real insights rows; embedding similarity sanity query in Neon.

---

## STEP 8 — Orchestration: Scheduler + retries + state machine

**Will do:** 

- Cloud Scheduler cron (default: daily 02:00 IST per tenant/connector) → `POST /v1/imports` with an internal OIDC service-to-service token (scheduler SA → api)
- Cloud Tasks queue tuning: max 5 attempts, exponential backoff, dead-letter behavior = job marked `failed` + insight row of kind `pipeline_failure`
- Watchdog: scheduled lightweight endpoint that marks jobs stuck in `running` > 2h as failed
- Document the full job state machine in `docs/PIPELINE.md` with a mermaid diagram.

**External:** User runs `infra/setup-scheduler.sh`; confirms cron in console.

**Verify:** Trigger scheduler manually (`gcloud scheduler jobs run`) → watch full chain complete; kill a worker mid-run → confirm retry then watchdog behavior.

---

## STEP 9 — Observability

**Will do:** OTel SDK in all three services exporting to Google Cloud Trace + structured JSON logs to Cloud Logging. One trace spans API → Tasks → Worker → ML → Insight (propagate traceparent through task payload and job env). Log-based metrics + alert policies (job failure count, import latency, Vertex error rate). Add `docs/RUNBOOK.md`: how to find a failed job, replay it, rebuild Neon from GCS.

**External:** User sets alert notification channel (email) in console.

**Verify:** Run one pipeline, open Cloud Trace, confirm a single end-to-end trace; force a failure, confirm alert fires.

---

## STEP 10 — Dashboard wiring (Next.js, existing app)

**Will do:** In the existing Next.js dashboard app:

- Server-side data layer reading Neon (aggregates, forecasts, insights) — typed queries from `intel-schema`
- Pages/sections: traffic overview (charts: requests by agent lane over time, blocked vs allowed, top agents), forecast view (p10/p50/p90 band), NL insights feed, job/connector status, "Run import now" button → `POST /v1/imports`
- **Agent chat**: route handler that embeds the question (Vertex embeddings), pgvector top-k over `insights`, pulls relevant aggregates, calls Vertex Gemini, **streams** the answer
- Design system: existing Agentronics tokens — `brand-solid #5a4fd9` for interactive fills, `#736ced` glow/identity only, amber with dark text, Geist + Geist Mono for trace/log surfaces.

**External:** User adds env vars in Vercel (`DATABASE_URL`, Vertex SA via workload identity or JSON for now, API base URL), deploys.

**Verify:** Playwright E2E: login → trigger import → poll job → charts render → insight appears → chat answers a question with streamed tokens.

---

## STEP 11 — Hardening + deploy checklist `[CONFIRM]`

**Will do:** Final pass:

- IAM audit: each SA only its needed roles; no default compute SA usage
- Secrets audit: zero secrets in code/env files committed; all via Secret Manager / Vercel encrypted env
- Cloud Run: ingress internal+lb where possible, worker only accepts Cloud Tasks OIDC, concurrency + memory tuned
- Cost guards: budget alert, GCS lifecycle (raw → Nearline at 90d), min-instances 0
- CI: GitHub Actions — lint, typecheck, tests, docker build on PR; deploy scripts on tag
- Load sanity: 50 concurrent job enqueues don't corrupt state
- Write `docs/DEPLOY_CHECKLIST.md` (pre-deploy gates) and final summary in `BUILD_LOG.md`.

**External:** User sets budget alert amount, adds GitHub Actions GCP workload-identity federation (commands provided).

**Verify:** Checklist items all checked; full clean-environment dry run: bootstrap → deploy → scheduled run → dashboard shows data.

---

## RESUME RULE

At the start of any session: read `docs/BUILD_LOG.md`, find the last `Status`, and continue from there. If a step is `⚠️ blocked on manual step`, re-print the pending MANUAL STEPS and wait.
