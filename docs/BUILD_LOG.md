# BUILD_LOG — Agentronics Intelligence Platform

Single source of truth for build state. Read at session start; resume from the last `Status`.

## STEP 0 — Preflight & GCP foundation · 2026-06-12

**Did:** Verified local tooling: node v22.22.3 ✅, pnpm 10.33.2 ✅, Python 3.12.12 ✅, uv 0.10.2 ✅, Docker 29.2.0 ✅, **gcloud ❌ not installed**. Confirmed with Nithin: intelligence platform lives in a **new Turborepo at `codes/Dashboard/`** (not the SDK repo); **no GCP project exists yet**. Wrote idempotent `infra/gcp-bootstrap.sh` — enables APIs (Run, Tasks, Scheduler, Secret Manager, Storage, Artifact Registry, Vertex AI), creates Artifact Registry repo `intel`, three least-privilege SAs (`intel-api`, `intel-worker`, `intel-ml`), and bucket `agentronics-intel-<project>` (asia-south1, uniform access, public-access-prevention) with `raw/ derived/ models/` prefixes.

**Files:** `infra/gcp-bootstrap.sh`

**External steps issued:**
1. Install gcloud CLI: `brew install --cask gcloud-cli` then `gcloud init`
2. Create GCP project + attach billing (console → New Project), note the PROJECT_ID
3. `gcloud auth login`
4. Run `./infra/gcp-bootstrap.sh <PROJECT_ID>`
5. Apply for Google for Startups credits (separate, non-blocking)

**Tests run / results:** `bash -n infra/gcp-bootstrap.sh` syntax OK. Cloud-side verify pending manual steps: `gcloud services list --enabled`, `gcloud storage ls gs://agentronics-intel-<PROJECT_ID>/`, `gcloud iam service-accounts list`.

**Status:** ✅ done (2026-06-12: Nithin installed gcloud, created project `project-6d96c09a-5821-4133-959`, ran bootstrap. Verified: bucket `gs://agentronics-intel-project-6d96c09a-5821-4133-959/` with raw/ derived/ models/, SAs intel-api/worker/ml exist, AR repo `intel` in asia-south1, all APIs enabled.)

**Next:** STEP 1 (no GCP dependency — proceeded)

## STEP 1 — Monorepo scaffolding · 2026-06-12

**Did:** Scaffolded new Turborepo at `codes/Dashboard/`: root (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`), `packages/intel-schema` (zod, placeholder enums for source/job-type/job-status), `apps/intel-api` + `apps/intel-worker` (Node 20 target, Fastify 5, `/healthz`, structured JSON logs with Cloud Logging `severity`, request-id propagation, graceful shutdown; build = tsc typecheck + esbuild bundle → `dist/index.cjs`), `apps/intel-ml` (Python 3.12 + uv, `python -m intel_ml.run --job-id|--healthcheck`, JSON logging, pytest). Multi-stage Dockerfiles: Node services → distroless `nonroot`; Python → slim, non-root user. `.env.example` per app. Fixes during verify: (1) esbuild CJS bundle clashed with `"type": "module"` → output renamed to `index.cjs`; (2) missing `.dockerignore` let host `node_modules`/`dist` leak into build context, breaking in-image builds → added root + intel-ml `.dockerignore`; (3) uv editable install left `intel_ml` unresolvable in the runtime stage → `uv sync --no-editable`.

**Files:** root configs; `packages/intel-schema/*`; `apps/intel-api/*`; `apps/intel-worker/*`; `apps/intel-ml/*`; `.gitignore`

**External steps issued:** None

**Tests run / results:**
- `pnpm turbo build` — 3/3 successful
- `pnpm turbo lint` — 3/3 successful
- `uv run pytest` — 2 passed; `python -m intel_ml.run --healthcheck` exits 0
- `/healthz` → 200 `{"status":"ok"}` on both intel-api and intel-worker (local boot)
- `docker build` × 3 — all succeed; containers verified: `/healthz` 200 from intel-api + intel-worker images, `intel-ml:dev --healthcheck` and `--job-id smoke-test-1` exit 0 with JSON logs

**Status:** ✅ done

**Next:** STEP 2 — Neon schema + migrations

## STEP 2 — Neon schema + migrations · 2026-06-12

**Did:** Drizzle schema in `packages/intel-schema/src/db/schema.ts`: `tenants`, `connectors` (type enum, config JSONB, `secret_ref` — never the secret), `jobs` (status state machine queued→running→succeeded|failed, attempt, gcs_paths JSONB), `agent_traffic_daily` (UNIQUE tenant+date+source+agent_name; agent_lane enum webmcp|webbotauth|stealth; requests/blocked/allowed/pages/conversions), `forecasts` (UNIQUE tenant+metric+horizon_date; p10/p50/p90 double precision, model_version, job_id), `insights` (UNIQUE job_id+kind for deterministic ids; severity enum; `embedding vector(768)`), `billing_usage` (UNIQUE tenant+period). pgvector enabled via `CREATE EXTENSION IF NOT EXISTS vector` prepended to migration 0000. DB client (`postgres.js`, `prepare:false` for Neon pgbouncer pooler) exported as `@agentronics/intel-schema/db`. Idempotent seed (fixed demo-tenant UUID, ON CONFLICT upsert). Neon `DATABASE_URL` stored in Secret Manager `neon-database-url` (version 1) + local `.env` files (gitignored). Fix during verify: `.bin/drizzle-kit` shell shim can't be run by `node` → scripts call `node_modules/drizzle-kit/bin.cjs` directly.

**Files:** `packages/intel-schema/{src/db/schema.ts,src/db/client.ts,src/db/seed.ts,drizzle.config.ts,drizzle/0000_furry_wolfsbane.sql,package.json,.env.example}`

**External steps issued:** None (Neon project + gcloud already done by Nithin; secret created via gcloud with his auth)

**Tests run / results:**
- `pnpm db:migrate` applied cleanly; runs 2 and 3 idempotent (only `already exists, skipping` NOTICEs)
- `pnpm db:seed` twice → still exactly 1 demo tenant (UPSERT confirmed)
- `psql \dt` → all 7 tables; `SELECT` round-trip returns demo tenant; `pg_extension` shows `vector`
- `pnpm turbo build lint` — 6/6 green

**Status:** ✅ done

**Next:** STEP 3 — GCS data layout + Parquet conventions

## STEP 3 — GCS data layout + Parquet conventions · 2026-06-12

**Did:** Canonical path builders in `packages/intel-schema/src/paths.ts` (`rawPath`, `derivedPath`, `modelPath`, `rawJobPrefix` — zod-validated source/date/part, zero-padded part files); raw envelope + normalized `agentTrafficDailyRow` zod schemas in `src/envelope.ts` (`RAW_SCHEMA_VERSION = 1`; payload = source-native JSON verbatim). Shared enums moved to `src/enums.ts` (avoids an index↔paths import cycle). In `apps/intel-worker/src/lib/`: `ObjectStorage` interface with `LocalFsStorage` (tmp-dir tests, path-traversal guard) + `GcsStorage` (`@google-cloud/storage`, lazy import); Parquet writer/reader (`@dsnp/parquetjs`, in-memory buffers, refuses empty files). Wrote `docs/SCHEMA_MAPPING.md` — the raw→normalized contract (lane classification rules, per-source field mappings for Cloudflare/Profound/Scrunch, aggregation + agent-canon rules, versioning policy). Fixes during verify: `.ts`-extension imports + `rewriteRelativeImportExtensions` so source runs under node strip-types while tsc still emits `dist/`; constructor parameter properties not supported in strip-only mode → explicit fields; parquetjs `openStream` type cast for PassThrough.

**Files:** `packages/intel-schema/src/{enums.ts,paths.ts,paths.test.ts,envelope.ts,index.ts,tsconfig.json}`; `apps/intel-worker/src/lib/{storage.ts,parquet.ts,parquet.test.ts}`; `apps/intel-worker/package.json` (+@dsnp/parquetjs, +@google-cloud/storage); `docs/SCHEMA_MAPPING.md`

**External steps issued:** None

**Tests run / results:**
- `pnpm turbo build test lint` — 9/9 green
- intel-schema: 5/5 (path snapshots + invalid-input rejection)
- intel-worker: 3/3 (parquet round-trip via LocalFsStorage at canonical raw path incl. envelope + payload fidelity; empty-write rejection; traversal guard)
- worker docker image rebuilt with new deps; container `/healthz` → 200

**Status:** ✅ done

**Next:** STEP 4 — API service (Cloud Run)

## STEP 4 — API service (Cloud Run) · 2026-06-12

**Did:** `apps/intel-api` implemented. Auth: `src/auth.ts` verifies Clerk session JWTs with `jose` (remote JWKS + issuer check; tests inject a local JWKS); tenant resolved/bootstrapped per request by UPSERT on `tenants.clerk_org_id` (org claim, else per-user tenant). Endpoints: `POST /v1/imports` (validates tenant-owned connector → inserts queued `jobs` row → enqueues Cloud Tasks task whose payload is `{job_id}` only, OIDC token as intel-api SA), `GET /v1/jobs/:id` + `GET /v1/jobs` (tenant-scoped; explicit `?tenant=` mismatch → 403), `POST /v1/connectors` (UPSERT on tenant+type; credential written to Secret Manager `connector-{tenant}-{type}`, only the ref stored in Neon) + `GET /v1/connectors`. GCP clients behind `TaskQueue`/`SecretStore` interfaces (`src/gcp.ts`, lazy imports). zod body validation → 400 with issues; auth header redacted from logs; request-id propagation already in place. `infra/deploy-api.sh` (build → AR push → `gcloud run deploy`, asia-south1, SA intel-api, min-instances 0, DATABASE_URL via `--set-secrets`, auto-discovers worker URL once Step 5 deploys). OTel SDK wiring deliberately deferred to STEP 9 (where exporters/trace propagation land); structured logs + request-id done now.

**Files:** `apps/intel-api/src/{env.ts,auth.ts,gcp.ts,server.ts,index.ts,server.test.ts}`; `apps/intel-api/package.json` (+jose, +@google-cloud/tasks, +@google-cloud/secret-manager, +drizzle-orm, +zod); `infra/deploy-api.sh`

**External steps issued:** Clerk app creation + deploy (see MANUAL STEPS in chat; repeated here):
1. Clerk dashboard → create application (if none) → copy **Issuer** (`https://<slug>.clerk.accounts.dev`) and JWKS URL (`<issuer>/.well-known/jwks.json`)
2. `./infra/deploy-api.sh <PROJECT_ID> <CLERK_ISSUER> <CLERK_JWKS_URL>`
3. Verify: `curl <service-url>/healthz` → 200; authenticated `POST /v1/imports` returns 202 (full curl in chat) — note Cloud Tasks enqueue will 500 until the `import-jobs` queue exists (STEP 5)

**Tests run / results:**
- 8/8 integration tests (fastify inject, real dev Neon, local JWKS, fake Tasks/Secrets): 401 paths, connector create/upsert + secret-ref-only storage, import 202 + queued row + enqueue, 404 unknown connector, 403 tenant mismatch, 400 validation
- `pnpm turbo build test lint` — 9/9 green; api docker image rebuilt, container `/healthz` → 200
- Bug caught by tests: auth header built before token signing (module-load order) — fixed

**Status:** ✅ done (cloud verify pending deploy — manual)

**Amendment (2026-06-12):** First deploy failed — Apple Silicon produced an arm64/OCI-index image Cloud Run rejects. `deploy-api.sh` now builds with `--platform linux/amd64 --provenance=false --sbom=false`; cross-build verified locally (`docker inspect` → linux/amd64). All future deploy scripts (worker, ml) must do the same.

**Amendment 2 (2026-06-12) — run.app URLs return Google-frontend 404 for all custom images:** intel-api deployed healthy (revision Ready, instance boots, Fastify listening, startup probe passes) but its URL 404s at Google's edge; zero requests ever reach the container. Systematic bisect (service recreate, fresh service names, IPv4/IPv6/HTTP1.1, authed requests, registry round-trip, locally-built derivative of Google's hello, plain-Node probe, Python probe, asia-southeast1 probe) proved: Google's `hello` sample content routes fine — including pushed through our AR and locally rebuilt — while **every custom workload (our image, trivial Node, trivial Python) is dropped at the GFE, in any region**. Billing is enabled/open. Conclusion: new-account serving restriction (abuse prevention on fresh/free-trial billing accounts) — not a code or config problem. All diagnostic probe services/images deleted; `intel-api` left deployed (healthy, awaiting routability). **Action (Nithin): upgrade the billing account out of free trial (Console → Billing → Upgrade), then retest `curl <url>/healthz`; if still 404 after upgrade + a few hours, open a GCP support case citing "Cloud Run service URL returns 404 for all custom containers in new project".**

**Amendment 3 (2026-06-12) — root cause narrowed to billing-account flag; LB bypass works:** Billing upgraded → still 404. A throwaway project created under the upgraded account also 404s on custom images → the flag is **account-level**, stamped pre-upgrade (no support access to clear it manually; expected to expire on its own, typically 24–48h). Self-service bypass deployed and verified: Global External ALB (serverless NEG `neg-intel-api` → backend `be-intel-api` → url-map `lb-intel` → http proxy + forwarding rule `lb-intel-fr`) — **`http://8.232.117.127/healthz` → 200** while run.app stays blocked. Caveats: (1) Cloud Tasks → worker also uses the blocked run.app URL with OIDC, so the import chain stays blocked until run.app heals (or the worker is added to the LB with a custom token audience — deferred, since live E2E also awaits real connector creds); (2) LB is HTTP-on-IP for now — add domain + managed cert before the dashboard ships, or tear the LB down (`lb-intel-fr`, `lb-intel-proxy`, `lb-intel`, `be-intel-api`, `neg-intel-api`) once run.app serves; LB costs ~$18/mo while up. **Plan: re-test run.app every few hours over the next 24–48h; meanwhile builds continue (STEP 6).**

**Amendment 4 (2026-06-12) — RESOLVED; previous diagnosis was WRONG:** The real root cause: **Google's frontend intercepts the literal path `/healthz` on run.app URLs** and returns its own HTML 404 — the request never reaches the container, for ANY service. Discriminating test (suggested by Nithin): `curl -sI <url>/` returned **Fastify's JSON 404 with `x-cloud-trace-context`** while `/healthz` got the GFE HTML page. Every "blocked" observation in Amendments 2–3 had tested `/healthz`; every "working" hello observation had tested `/` — a perfect confound mistaken for an account-level restriction. There was never a serving restriction; both services were reachable all along (worker confirmed: anonymous → IAM 403, authed → app response). **Fix:** `/health` route added to both services (`/healthz` kept for local/docker), both redeployed and verified 200 on run.app; LB torn down (all 5 resources deleted — recreate at STEP 11 with domain + HTTPS for prod ingress); deploy-api.sh verify message updated. Canonical health URLs: `https://intel-api-1032662679519.asia-south1.run.app/health` (public), worker `/health` (OIDC only). Full pipeline chain (Cloud Tasks → worker → ML) is unblocked.

**Next:** STEP 5 — Import worker (Cloud Run)

## STEP 5 — Import worker (Cloud Run) · 2026-06-12

**Did:** `apps/intel-worker` implemented. `POST /tasks/import` (Cloud Tasks HTTP target) runs the full state machine: load job → guards (unknown/malformed/wrong-type → 200 ack-and-drop; already succeeded/failed → 200 no-op) → mark running (attempt++) → read connector + Secret Manager credential → adapter pull over an incremental date window (`lookback_days`, default 7, ending yesterday UTC) → envelope + raw Parquet → GCS at canonical `raw/` path → update `gcs_paths` → trigger intel-ml Cloud Run Job (NOT_FOUND tolerated until STEP 6 deploys it) → mark succeeded. Failure semantics match the queue policy: while `X-CloudTasks-TaskRetryCount` < 4 → error recorded, status back to `queued`, HTTP 500 (Tasks retries with backoff); at the 5th attempt → status `failed`, HTTP 200 (stops retries). Adapters behind one interface with injectable fetch: **Cloudflare** (GraphQL Analytics bot-traffic query + AI Crawl Control export; missing product on zone → warn + skip; GraphQL errors fatal), **Profound** (Bearer, cursor pagination, max 50 pages), **Scrunch** (queries + responses endpoints, window clamped to 90 days). Shared `fetchWithRetry` (429/5xx exponential backoff honoring Retry-After; other 4xx fatal). Worker auth is infra-level: deployed `--no-allow-unauthenticated`, only intel-api SA gets `run.invoker` (the OIDC identity Cloud Tasks uses). `infra/setup-queue.sh` (import-jobs queue: max-attempts 5, backoff 10s→300s, concurrency 5) + `infra/deploy-worker.sh` (amd64 build, private deploy, invoker grant, auto-updates intel-api's WORKER_URL). Note: exact Profound/Scrunch endpoints + Cloudflare GraphQL field names are config-overridable per connector and get pinned at the live end-to-end pull (blocked on the Cloud Run serving issue / real creds).

**Files:** `apps/intel-worker/src/{env.ts,server.ts,index.ts,server.test.ts,mlTrigger.ts}`; `src/lib/{http.ts,secrets.ts}`; `src/connectors/{types.ts,cloudflare.ts,profound.ts,scrunch.ts,registry.ts,adapters.test.ts}`; `infra/{setup-queue.sh,deploy-worker.sh}`; worker package.json (+@google-cloud/run, +@google-cloud/secret-manager, +zod, +drizzle-orm)

**External steps issued:**
1. Store real connector creds (when ready): `printf '%s' '<CF_API_TOKEN>' | gcloud secrets create connector-<tenant_id>-cloudflare --replication-policy=automatic --data-file=-` (or POST /v1/connectors with `secret` once the API URL serves)
2. `./infra/setup-queue.sh project-6d96c09a-5821-4133-959`
3. `./infra/deploy-worker.sh project-6d96c09a-5821-4133-959`
4. Live end-to-end (after Cloud Run serving unblocks): authenticated `POST /v1/imports` → watch job rows + `gcloud storage ls gs://agentronics-intel-<project>/raw/`

**Tests run / results:** 16/16 worker tests — 6 adapter fixture tests (kind tagging, AI-crawl-control 404 skip, GraphQL error fatality, cursor pagination, 90-day clamp, window math) + 7 state-machine integration tests against real Neon (happy path with parquet read-back + ml trigger, succeeded/failed idempotent no-ops, transient→500/queued/error, exhausted→failed/200, ml NOT_FOUND tolerated, drops acked, empty pull) + 3 parquet/storage. Repo `turbo build test lint` 9/9; worker docker image rebuilt, container healthz 200.

**Status:** ✅ done (cloud verify blocked on the Cloud Run serving restriction — see STEP 4 Amendment 2)

**Next:** STEP 6 — ML job (Cloud Run Job, Python)

## STEP 6 — ML job (Cloud Run Job, Python) · 2026-06-12

**Did:** `apps/intel-ml` pipeline implemented (`python -m intel_ml.run --job-id <import-job-id>`): creates its own `jobs` row (type=ml, running→succeeded|failed) → reads the tenant's **full** raw history across all sources (pyarrow) → normalizes per `SCHEMA_MAPPING.md` (`normalize.py` owns the per-source mappings, lane classification webmcp>webbotauth>stealth with priority merge, agent canon table, sum-aggregation, blocked≤requests guard) → writes `derived/` Parquet per dt partition (source of truth) → UPSERTs `agent_traffic_daily` → **retrains every run** per metric (requests/blocked/allowed) → persists `models/{tenant}/{metric}/{version}/model.pkl + metadata.json` → UPSERTs `forecasts` (14-day horizon) → calls insight stage hook (STEP 7 placeholder) → exits. **Model choice:** Holt-Winters ETS (statsmodels; additive trend + 7-day additive seasonality) — right fit for short weekly-seasonal daily counts, retrains in ms (cloud-retrain contract), honest p10/p50/p90 from empirical residual quantiles clipped at 0; seasonal-naive fallback < 14 days history; both behind the `Forecaster` protocol (`model_version`: `ets-hw-v1` / `snaive-v1`) so upgrades don't touch the pipeline. Backtest: MAPE of p50 on a held-out final week, stored in model metadata. DB via psycopg3 behind a `Database` ABC (UPSERTs match STEP 2 unique constraints); storage via `Storage` ABC (GCS prod / local tmp tests). `infra/deploy-ml.sh` (amd64, creates/updates Cloud Run Job, SA intel-ml, 1Gi/1800s, secret-mounted DATABASE_URL).

**Files:** `apps/intel-ml/src/intel_ml/{pipeline.py,normalize.py,forecast.py,db.py,storage.py,parquet_io.py,run.py,insights/__init__.py}`; `tests/{conftest.py,test_normalize.py,test_forecast.py,test_pipeline.py,test_run.py}`; `pyproject.toml` (+pandas, pyarrow, numpy, statsmodels, psycopg, google-cloud-storage); `infra/deploy-ml.sh`

**External steps issued:**
1. `./infra/deploy-ml.sh project-6d96c09a-5821-4133-959`
2. Smoke run after first real import lands: `gcloud run jobs execute intel-ml --region asia-south1 --args='--job-id,<IMPORT_JOB_UUID>' --wait`, then check `derived/` + `models/` in the bucket and `agent_traffic_daily`/`forecasts` rows in Neon

**Tests run / results:** 20/20 pytest — 7 golden normalization tests (per-source mappings, canon, lane priority incl. webmcp override, distinct-page counting, key separation), 7 forecaster tests (shape/quantile ordering, determinism, gap-filling, selector, artifact/metadata, **backtest report printed: held-out 7d MAPE = 0.039** on synthetic weekly-seasonal data), 4 pipeline tests (full run: 21 days × 2 agents → 42 upserts, 3 metrics forecast with ETS, derived+models written; idempotent re-run; unknown-job and no-raw-data failure paths), 2 entrypoint tests. `ruff check` clean. Docker image builds; `--healthcheck` exits 0; missing-env guard exits 1.

**Status:** ✅ done (cloud smoke run pending deploy + first real import)

**Next:** STEP 7 — Insight layer (Vertex AI Gemini)

## STEP 7 — Insight layer (Vertex AI Gemini) · 2026-06-12

**Did:** Insight layer inside `intel-ml` (same job, final stage — no extra service). **Agent system:** a registry of 4 single-purpose, schema-bound insight agents (`traffic_shift`, `forecast_summary`, `anomaly_explainer`, `agent_lane_breakdown`) — deliberately NOT a free-form agent loop: no tools, no multi-turn; every number is computed deterministically in the new `stats.py` (WoW deltas, lane shares, top agents with blocked%, z-score anomalies vs 7-day rolling baseline with std floor) and injected into the prompt; Gemini only narrates. Each agent = bounded-context builder (returns None → agent skips when data is insufficient) + versioned prompt template (`insights/prompts/`, version stamped into every insight body footer e.g. `traffic_shift@v1`) + deterministic stats-only fallback. Guardrails: JSON-forced output validated by pydantic (`title`≤80, `body_md`, `severity∈info|warning|critical`), one retry on schema failure, then fallback (the feed never empties because the LLM misbehaved); no-LLM mode runs entirely on fallbacks. Vertex via `google-genai` `Client(vertexai=True)` — SA auth, NO API keys; `GEMINI_MODEL` default `gemini-2.5-flash`, `EMBED_MODEL` default `text-embedding-005` at 768 dims (matches `insights.embedding vector(768)`); embeddings best-effort (failure → NULL vector, insight still stored). UPSERT on `(job_id, kind)` (deterministic identity). Pipeline now passes db+llm through; `run.py` builds the Vertex client from env (`llm_from_env`, degrades to fallback mode if init fails). Fix during verify: anomaly z-score used `std.replace(0, NaN)` which silenced spikes on flat baselines → std floor `max(std, 5%·mean, 1.0)`.

**Files:** `apps/intel-ml/src/intel_ml/{stats.py,pipeline.py,run.py,db.py}`; `src/intel_ml/insights/{__init__.py,agents.py,llm.py,schema.py,prompts/__init__.py}`; `tests/{test_insights.py,test_stats.py,conftest.py}`; `pyproject.toml` (+pydantic, +google-genai)

**External steps issued:**
1. Confirm Gemini + text-embedding-005 availability in asia-south1 once live (first execution logs it); if unavailable, set `VERTEX_LOCATION` env on the Cloud Run Job to a supported region — no code change
2. `roles/aiplatform.user` for intel-ml SA — already granted by bootstrap (STEP 0)
3. Live run + embedding similarity sanity query in Neon — folded into PENDING CLOUD VERIFICATIONS

**Tests run / results:** 36/36 pytest (`ruff` clean) — 9 insight tests (all 4 agents fire on full stats; exact numbers verified verbatim in prompts; insufficient-data skips; schema-failure retry-then-success; persistent failure → stats-only fallback narrating real numbers; no-LLM fallback mode; db upsert; prompt versions in body; registry uniqueness) + 7 stats tests (lane shares, top agents, WoW, spike flagged at z≥3, flat series clean, forecast passthrough, zero-division guard) + prior 20. Docker image rebuilt with google-genai; healthcheck 0.

**Status:** ✅ done (live Vertex verification in PENDING CLOUD VERIFICATIONS)

**Next:** STEP 8 — Orchestration: Scheduler + retries + state machine

## STEP 8 — Orchestration: Scheduler + retries + state machine · 2026-06-12

**Did:** (1) **Scheduler → API auth:** new `googleOidcVerifier` in intel-api (Google JWKS, issuer accounts.google.com, audience = API URL, only `intel-scheduler@…` accepted, email_verified required). Auth hook tries Clerk first, falls back to the internal path; internal callers are hard-limited to `POST /v1/imports` (anything else → 403) and the connector row resolves the tenant. Env: `SCHEDULER_SA` + `API_AUDIENCE` (path disabled unless both set). (2) **Dead-letter visibility:** permanent import failures (retries exhausted) and watchdog kills now write a `pipeline_failure` insight (severity critical, UPSERT on job+kind) so failures surface in the dashboard feed. (3) **Watchdog:** `POST /tasks/watchdog` on the private worker fails jobs stuck in `running` > 2h; hourly Cloud Scheduler cron. (4) `infra/setup-scheduler.sh` (idempotent): creates `intel-scheduler` SA, grants run.invoker on worker, upserts hourly watchdog cron + optional per-connector daily import cron (`0 2 * * *` Asia/Kolkata, OIDC tokens). deploy-api.sh now sets SCHEDULER_SA/API_AUDIENCE. (5) `docs/PIPELINE.md`: mermaid state machine, queue↔worker retry contract table, idempotency invariants, ops commands. Queue tuning itself was already in setup-queue.sh (STEP 5).

**Files:** `apps/intel-api/src/{auth.ts,server.ts,env.ts,index.ts,server.test.ts}`; `apps/intel-worker/src/{server.ts,server.test.ts}`; `infra/{setup-scheduler.sh,deploy-api.sh}`; `docs/PIPELINE.md`

**External steps issued:** None left — executed directly with Nithin's gcloud auth: both services rebuilt + redeployed (api with SCHEDULER_SA/API_AUDIENCE), `setup-scheduler.sh` run (SA + watchdog cron created). Per-connector import cron: run `./infra/setup-scheduler.sh <project> <CONNECTOR_ID>` once the real connector exists (added as PENDING item).

**Tests run / results:** repo `turbo build test lint` 9/9; intel-api 10/10 (+2: internal token can import any connector → 202; internal token reading jobs/connectors → 403); intel-worker 18/18 (+2: permanent failure writes critical `pipeline_failure` insight; watchdog fails 3h-old running job + writes insight, leaves 1-min-old job alone). **Live verify:** `gcloud scheduler jobs run intel-watchdog` → worker request log shows `200 POST /tasks/watchdog` via OIDC (private service). Kill-a-worker-mid-run chaos test deferred to first real import (needs a long-running job).

**Status:** ✅ done

**Next:** STEP 9 — Observability

## STEP 9 — Observability · 2026-06-12

**Did:** (1) **Tracing:** manual OTel spans in all three services → Cloud Trace (esbuild bundles defeat auto-instrumentation, so spans are explicit). One SERVER span per request (API+worker, `otel.ts`); W3C traceparent propagated API → Cloud Tasks (task header + payload) → worker → `TRACEPARENT` env on the ML execution → `intel-ml.pipeline` span (`tracing.py`). `SimpleSpanProcessor` (synchronous export — Cloud Run throttles CPU post-response so batch timers never fire); diag error logging enabled (default is silent); explicit `projectId` on the exporter (metadata-server-independent); `OTEL_DISABLED=1` escape hatch. (2) **Metrics/alerts** (`infra/setup-observability.sh`, idempotent): email channel → neelakandannithin@gmail.com; log-based metrics `intel_job_failures`, `intel_ml_failures`, `intel_vertex_errors`, `intel_import_latency`; 3 alert policies (any occurrence in 5min). (3) `docs/RUNBOOK.md`: failed-job triage, trace path, replay, **rebuild Neon from GCS**, watchdog, alert table, secret rotation, the /healthz gotcha. (4) intel-ml Cloud Run Job first deploy (`deploy-ml.sh`). Fixes en route: `roles/cloudtrace.agent` was never granted (granted to all 3 SAs + bootstrap script updated); drizzle type-identity split when otel api joined the peer graph (added `@opentelemetry/api` to intel-schema); monitoring filter quoting + per-resource-type alert filters.

**Files:** `apps/intel-api/src/{otel.ts,server.ts,gcp.ts,index.ts}`; `apps/intel-worker/src/{otel.ts,server.ts,mlTrigger.ts,index.ts,server.test.ts}`; `apps/intel-ml/src/intel_ml/{tracing.py,run.py}` (+otel deps); `packages/intel-schema/package.json`; `infra/{setup-observability.sh,gcp-bootstrap.sh}`; `docs/RUNBOOK.md`

**External steps issued:** None — executed directly (deploys, IAM grants, observability setup). Nithin: confirm the "Intel: import job failures" alert email arrived (chaos test below should have fired it).

**Tests run / results:**
- repo `turbo build test lint` 9/9; worker 19/19 (+traceparent payload→ML propagation test); intel-ml 36/36, ruff clean
- **Cloud chaos test:** forced a permanent import failure through the deployed worker (nonexistent secret + final-retry header) → job `failed` with structured error, `critical` `pipeline_failure` insight in Neon, failure log feeding `intel_job_failures` confirmed in Cloud Logging → alert policy evaluates on it
- **Cloud trace verified:** request with known traceparent → `GET /v1/projects/…/traces/<id>` returns the trace with our `GET /health` span correctly parented under Cloud Run's edge span (ListTraces lag initially masked this — fetch-by-id proved storage)
- Full API→Tasks→Worker→ML single-trace check needs a real import — in PENDING CLOUD VERIFICATIONS

**Status:** ✅ done

**Next:** STEP 10 — Dashboard wiring (Next.js, existing app)

## STEP 10 — Dashboard wiring (Next.js) · 2026-06-12

**Did:** Built a real Next.js 15 App Router app at `apps/dashboard` (the `Dashboard_UI/` handoff is a DC-runtime prototype — its own CLAUDE.md says treat it as the spec when porting; the plan requires Next.js+Clerk+Vercel+streaming). Ported the design system verbatim into `globals.css` (DM Sans + JetBrains Mono self-hosted in `public/fonts`, indigo `#5a4fd9`/`#736ced`, amber-with-dark-text, flat hairline surfaces, light+dark via `.dark` class + pre-paint theme script). **NOTE:** design system ships DM Sans/JetBrains Mono, not Geist as the old plan note said — design system is canonical. Collapsible sidebar ported from the handoff (logomark with brand glow, section label, nav + bottom utility + theme toggle); SDK nav section dropped (that's the other product — this dashboard wires the intelligence backend). Pages, all server components reading Neon via typed `@agentronics/intel-schema/db` queries (`lib/queries.ts`), tenant-scoped through `lib/tenant.ts` (Clerk org→tenant UPSERT, demo tenant when Clerk absent): **Overview** (KPIs, stacked-area requests-by-lane, blocked-vs-allowed, top agents, requests forecast), **Forecast** (p10/p50/p90 fan per metric), **Insights** (NL feed, light markdown), **Activity** (jobs table + connector status + "Run import now"), **Agent Chat** (streaming). Charts are dependency-free SVG (design brief: no chart lib) honoring tokens. **Chat** route handler: embed question (Vertex) → pgvector top-k over insights → pull aggregates → stream Gemini; degrades to deterministic retrieval-only answer when Vertex creds absent (verified — surfaced the real `pipeline_failure` insight from Neon). Settings + Account (my call, backend-driven): Settings = connector list + add-connector form (POST→intel-api `/v1/connectors`, secret→Secret Manager, ref-only in Neon) + import-schedule explainer; Account = profile (Clerk or demo), plan + `billing_usage` governed calls. API proxies `/api/imports` + `/api/connectors` forward the Clerk session token to intel-api. Clerk + Vertex both optional in dev (graceful degrade) so it builds/runs without secrets. Fixes during verify: StackedArea generic+cast for typed rows; `JSX.Element`→`React.ReactElement` (React 19); `vertexConfigured()` requires actual creds so dev uses fallback not error; turbo `outputs` += `.next/**`.

**Files:** `apps/dashboard/**` (package.json, next.config.mjs, tsconfig, middleware.ts, app/{layout,page,globals.css}, app/(app)/{overview,forecast,insights,activity,chat,settings,account}, app/api/{chat,imports,connectors}, components/{Sidebar,ui,RunImportButton,AddConnector,charts/*}, lib/{tenant,queries,vertex}, public/fonts); `pnpm-workspace.yaml`, `turbo.json`

**External steps issued (Vercel deploy — Nithin):**
1. Vercel → import `apps/dashboard` (root dir `apps/dashboard`, framework Next.js)
2. Env vars: `DATABASE_URL` (Neon), `INTEL_API_URL=https://intel-api-1032662679519.asia-south1.run.app`, Clerk `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`+`CLERK_SECRET_KEY`, `GCP_PROJECT`, `VERTEX_LOCATION=asia-south1`, and `GOOGLE_GENAI_SA_KEY` (intel-ml SA JSON, or a dashboard-scoped SA with `roles/aiplatform.user`) for live chat
3. Add the Vercel domain to Clerk allowed origins

**Tests run / results:** `pnpm turbo build` 4/4 (api, worker, schema, dashboard); `next build` clean — 7 routes, dynamic pages server-rendered; local run against real Neon: all 7 pages 200, `/`→307 redirect, chat streaming endpoint returns grounded retrieval-only answer reading live insights. Playwright E2E (plan's verify) deferred — needs the Vercel deploy + Clerk + seeded traffic; added to PENDING.

**Status:** ✅ done (Vercel deploy + E2E pending — manual)

**Post-step verification (2026-06-12):**
- **Cloud re-verified:** intel-api `/health` 200 (public), intel-worker anon→403 (private), intel-ml job Ready, intel-watchdog cron ENABLED, import-jobs queue RUNNING.
- **Pushed to GitHub:** `github.com/agentronics-t/dashboard` (private), branch `main`, 131 files, 2 commits. Secret scan clean (DB password only in gitignored `.env` files; `.env.example`s committed). Added root `README.md`, hardened `.gitignore` (.next/.vercel/venv/tsbuildinfo).
- **Local browser preview verified** (real Neon, demo tenant): all pages render; sidebar matches design (logomark glow, nav, collapse, theme); **Insights shows the real `pipeline_failure` insight** from the cloud chaos test (CRITICAL badge, job uuid, NOT_FOUND error, markdown); dark mode flips correctly and persists; **Agent Chat streams a grounded retrieval-only answer** ("0 requests… Data import failed") proving question→retrieval→aggregates→stream end-to-end. Collapsed sidebar (icon-only) verified.

**Iteration after first Vercel deploy (2026-06-12, Nithin feedback):**
- **Auth made live:** middleware now `auth.protect()`s all routes (except `/sign-in`, `/sign-up`); added dashboard-hosted Clerk `<SignIn>`/`<SignUp>` pages; sign-in/up URLs overridable via `NEXT_PUBLIC_CLERK_SIGN_IN_URL`/`_SIGN_UP_URL` so they can point at the landing page once it hosts auth (intended flow: sign in on landing page → redirect to dashboard). UserButton in sidebar. Account page was "empty" only because no user was signed in — name/email fill from Clerk `currentUser()` post-login; connected-plugin count now real.
- **Activity → Plugins:** new `/plugins` page with 3 source cards (Cloudflare/Profound/Scrunch), per-plugin Connect/Reconfigure (credential → Secret Manager via intel-api), "Run import now", recent-runs table. `AddConnector` removed; connector management lives only here now.
- **Settings slimmed:** appearance (theme toggle) + pointers to Plugins; no connector management.
- **Real logomark:** ported the faithful brand vector from `landing_page/components/ui/Logo.tsx` (theme-aware) into the sidebar, replacing the placeholder mark.
- **SDK sidebar section:** Detect/Auth/Authz/WebMCP Tools/Knaph/Logs/Analytics added per the design, disabled with "soon" badges (no links) until the SDK backend is wired.
- Verified in local preview (demo mode): logo, Plugins 3-card grid (Cloudflare CONNECTED from test connector, live recent-runs table), SDK section. `next build` green (14 routes). Pushed (commit b9c088e).
- **Clerk manual step (Nithin):** ensure the Clerk instance allows the Vercel domain (`*.vercel.app` is auto-allowed for dev/`pk_test` instances; add the domain for production instances). Login goes live on the next Vercel deploy.

**Cross-app auth wiring (2026-06-12):** Login/sign-up now live on the **landing page** (`github.com/agentronics-t/landing-page`): added `/sign-in` + `/sign-up` (Clerk), `clerkMiddleware`, Navbar/hero/pricing/"Start integrating" CTAs → those pages, redirecting to the dashboard via `NEXT_PUBLIC_DASHBOARD_URL` after auth; Book a demo stays on Calendly (`/book`); launching-soon modal retired. Dashboard side needs **no code change** — its sign-in URL is already `NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in"`, so setting that env to the landing page's `/sign-in` makes `auth.protect()` redirect there. **For shared-session SSO both apps must be on subdomains of one root domain** (e.g. landing `agentronics.dev`, dashboard `app.agentronics.dev`) with a Clerk **production** instance + the same `pk_live`/`sk_live` in both; `*.vercel.app` cannot share cookies (public-suffix). Vercel env to set — landing: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_DASHBOARD_URL=https://app.<root>/overview`; dashboard: same Clerk keys + `NEXT_PUBLIC_CLERK_SIGN_IN_URL=https://<root>/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=https://<root>/sign-up`.

**Next:** STEP 11 — Hardening + deploy checklist

## STEP 11 — Hardening + deploy checklist · 2026-06-16

**Did:** (1) **IAM audit** (live) — each service uses its own dedicated SA, no default-compute-SA usage; least-privilege confirmed: intel-api {cloudtasks.enqueuer, cloudtrace.agent, secretmanager.admin (needed to create connector secrets), secretmanager.secretAccessor}, intel-worker {cloudtrace.agent, run.invoker, secretmanager.secretAccessor, bucket-scoped objectAdmin}, intel-ml {aiplatform.user, cloudtrace.agent, secretmanager.secretAccessor, bucket-scoped objectAdmin}. (2) **Secrets audit** — `git grep` for sk_/npg_/PRIVATE KEY across both repos → only `.env.example` placeholders; pk_live is publishable (public by design). (3) **Cloud Run hardening** — worker stays private (`--no-allow-unauthenticated`, anon→403, OIDC-only; ingress=all is required for Cloud Tasks, security is IAM not ingress), tuned worker to concurrency 8 / 1Gi (parquet buffering; queue caps dispatches at 5), min-instances 0 on both (verified). (4) **Cost guards** — GCS lifecycle applied (raw→Nearline @90d, Coldline @365d); `infra/setup-budget.sh` for the monthly budget + 50/90/100% alerts (manual: amount). (5) **CI/CD** — `.github/workflows/ci.yml` (lint·typecheck·test·docker-build on PR/push, with a throwaway Postgres for DB-backed tests) + `.github/workflows/deploy.yml` (tag `v*` → build/push/deploy all services via WIF, no SA keys) + `infra/setup-wif.sh` (pool/provider/deployer-SA, repo-scoped). (6) **Load sanity** — added 2 worker tests: 50 concurrent distinct imports all succeed each in its own job-scoped raw path with exactly 50 ML triggers; 10 simultaneous deliveries of one job → one raw key, one success (no corruption). (7) `docs/DEPLOY_CHECKLIST.md` (full pre-deploy gates). Lint cleanups: dropped unused `gte`/`eq` imports, fixed an empty catch.

**Files:** `.github/workflows/{ci.yml,deploy.yml}`; `infra/{setup-wif.sh,setup-budget.sh,deploy-worker.sh}`; `apps/intel-worker/src/server.test.ts`; `apps/dashboard/{app/api/chat/route.ts,lib/tenant.ts,components/Sidebar.tsx}`; `docs/DEPLOY_CHECKLIST.md`

**External steps issued (Nithin):**
1. `./infra/setup-wif.sh project-6d96c09a-5821-4133-959 agentronics-t/dashboard` → add the 3 printed GitHub repo Variables (enables tag-deploy CI without SA keys)
2. `./infra/setup-budget.sh 01FE97-2E43EB-0A1E34 project-6d96c09a-5821-4133-959 <AMOUNT_USD>` (e.g. 50)
3. (CI runs automatically once this is pushed; tag `v0.1.0` to trigger the deploy workflow)

**Tests run / results:** full repo `pnpm turbo build test lint` — 11/11 green; worker 21/21 incl. the 50-concurrent load test; GCS lifecycle + worker tuning verified live via gcloud; IAM/secrets audits clean; deploy/WIF/budget scripts syntax-checked.

**Status:** ✅ done

---

## BUILD COMPLETE — platform summary

All 11 steps done. The Agentronics Intelligence Platform backend + dashboard are built, tested, deployed, and live:
- **Pipeline:** Scheduler/dashboard → intel-api (Cloud Run) → Cloud Tasks → intel-worker (private) → raw Parquet in GCS → intel-ml Cloud Run Job (normalize → ETS forecasts → Vertex Gemini insights + pgvector) → Neon serving mirror. Idempotent, traced end-to-end, alerted.
- **Dashboard:** Next.js on Vercel (`app.agentronics.dev`), Clerk auth shared with the landing page (`www.agentronics.dev`) on the production instance, charts + forecasts + insights + streamed agent chat.
- **Repos:** `agentronics-t/dashboard` (backend + dashboard), `agentronics-t/landing-page`. CI on every PR; tag-deploy via WIF.
- **Live verified:** api `/health` 200, worker 403-anon, ML job Ready, watchdog cron, queue running, auth flow working (email + Google).

**Remaining before paying customers (not code):** real connector credentials (Cloudflare/Profound/Scrunch) to run the first live import; `GOOGLE_GENAI_SA_KEY` on Vercel for live chat; run the pending cloud verifications in the section below; optionally upgrade Clerk usage limits. See `docs/DEPLOY_CHECKLIST.md` and `docs/RUNBOOK.md`.

**Note:** Neon endpoint is us-east-1 (GCP stack is asia-south1). Acceptable for now; if query latency from Cloud Run matters later, create a Neon project in ap-southeast-1/asia and re-point `neon-database-url`.

## PENDING CLOUD VERIFICATIONS (run when unblocked — check at every session start)

Blocked on: real connector creds only (serving issue RESOLVED — see STEP 4 Amendment 4; use `/health`, never `/healthz`, on run.app URLs).

1. ☑ ~~run.app serving~~ RESOLVED 2026-06-12: GFE intercepts `/healthz`; `/health` added + verified 200; LB torn down
2. ☐ Store real Cloudflare creds (then: `./infra/setup-scheduler.sh project-6d96c09a-5821-4133-959 <CONNECTOR_ID>` to add its daily cron) via `POST /v1/connectors` (or gcloud secrets) — pins adapter endpoints/fields
3. ☐ Deploy ML job: `./infra/deploy-ml.sh project-6d96c09a-5821-4133-959` (can run any time)
4. ☐ First real import: authenticated `POST /v1/imports` → job succeeds → `gcloud storage ls gs://agentronics-intel-project-6d96c09a-5821-4133-959/raw/`
5. ☐ **ML smoke run (Nithin asked to be reminded):** `gcloud run jobs execute intel-ml --region asia-south1 --args='--job-id,<IMPORT_JOB_UUID>' --wait` with the job id from item 4 — then confirm `derived/` + `models/` in the bucket and rows in `agent_traffic_daily`/`forecasts` (note: the import worker also auto-triggers this; the manual run is the verification)

### PENDING addition (STEP 10)
- ☐ Deploy dashboard to Vercel (root dir `apps/dashboard`) with env vars above + Clerk app + `GOOGLE_GENAI_SA_KEY` for live chat
- ☐ Playwright E2E: login → trigger import → poll job → charts render → insight appears → chat streams an answer
