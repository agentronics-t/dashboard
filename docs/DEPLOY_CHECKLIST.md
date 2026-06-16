# DEPLOY_CHECKLIST — Agentronics Intelligence Platform

Pre-deploy gates. Run top-to-bottom for a clean-environment bring-up; the
infra scripts are idempotent, so re-running is safe.

## 0. One-time foundation
- [ ] `gcloud auth login` as a project owner
- [ ] `./infra/gcp-bootstrap.sh <PROJECT_ID>` — APIs, Artifact Registry, 3 SAs (least privilege), bucket with raw/derived/models + cloudtrace.agent
- [ ] Neon project created; `DATABASE_URL` in Secret Manager `neon-database-url` (+ local `.env` for migrations)
- [ ] `pnpm --filter @agentronics/intel-schema db:migrate` applied; `pgvector` enabled

## 1. Code gates (CI enforces these on every PR)
- [ ] `pnpm turbo build lint` green
- [ ] `pnpm turbo test` green (Node) — incl. 50-concurrent load/idempotency test
- [ ] `cd apps/intel-ml && uv run ruff check src tests && uv run pytest -q` green
- [ ] `docker build` succeeds for intel-api, intel-worker, intel-ml (amd64)

## 2. Secrets (zero in the repo)
- [ ] `git grep -E 'sk_(live|test)_|npg_|PRIVATE KEY'` → only `.env.example` placeholders
- [ ] Connector creds in Secret Manager (`connector-{tenant}-{type}`); Neon URL in `neon-database-url`
- [ ] Vercel env (dashboard + landing) holds Clerk/Vertex/DB values — never committed
- [ ] `pk_live` publishable key is the only Clerk value in client bundles (public by design)

## 3. Deploy (tag `v*` runs `.github/workflows/deploy.yml` via WIF; or run scripts manually)
- [ ] `./infra/setup-queue.sh <PROJECT_ID>` — import-jobs queue (max-attempts 5, backoff 10s→300s, concurrency 5)
- [ ] `./infra/deploy-api.sh <PROJECT_ID> <CLERK_ISSUER> <CLERK_JWKS_URL>` — public, Clerk+scheduler OIDC, min-instances 0
- [ ] `./infra/deploy-worker.sh <PROJECT_ID>` — **private** (`--no-allow-unauthenticated`), concurrency 8 / 1Gi, invoker = intel-api SA
- [ ] `./infra/deploy-ml.sh <PROJECT_ID>` — Cloud Run Job, 1Gi, intel-ml SA
- [ ] `./infra/setup-scheduler.sh <PROJECT_ID> [CONNECTOR_ID]` — watchdog hourly + per-connector daily cron (OIDC)
- [ ] `./infra/setup-observability.sh <PROJECT_ID> <ALERT_EMAIL>` — log metrics + alert policies + channel

## 4. Hardening verification
- [ ] Each SA has only its needed roles; no default-compute SA in use (`gcloud projects get-iam-policy`)
- [ ] `curl <worker-url>/health` → **403** anon (private); `curl <api-url>/health` → 200 (public; **use `/health`, not `/healthz`** — GFE reserves `/healthz` on run.app)
- [ ] Worker accepts only Cloud Tasks OIDC; ingress=all is required for Tasks (security is IAM, not ingress)
- [ ] min-instances 0 on both services (cost)
- [ ] GCS lifecycle: raw → Nearline @90d, Coldline @365d (`gcloud storage buckets describe`)
- [ ] `./infra/setup-budget.sh <BILLING_ACCT> <PROJECT_ID> <AMOUNT_USD>` — budget + 50/90/100% alerts

## 5. CI/CD wiring
- [ ] `./infra/setup-wif.sh <PROJECT_ID> agentronics-t/dashboard` — Workload Identity Federation (no SA keys)
- [ ] GitHub repo Variables set: `GCP_PROJECT`, `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA`
- [ ] Dashboard on Vercel (root `apps/dashboard`); landing on Vercel; both share one **production** Clerk instance on subdomains of one root domain (cookie SSO)
- [ ] Google OAuth client has `https://clerk.<root>/v1/oauth_callback` as an authorized redirect URI

## 6. End-to-end smoke (after first real connector)
- [ ] Store real connector creds → `POST /v1/connectors` (or gcloud secrets)
- [ ] `POST /v1/imports` (dashboard "Run import now") → job `queued`→`running`→`succeeded`
- [ ] `gcloud storage ls gs://agentronics-intel-<PROJECT>/raw/` shows the partition
- [ ] ML job ran (auto-triggered) → `derived/` + `models/` written; `agent_traffic_daily`/`forecasts`/`insights` rows in Neon
- [ ] One end-to-end trace in Cloud Trace (API → Tasks → Worker → ML)
- [ ] Dashboard renders charts + insights; agent chat streams a grounded answer
