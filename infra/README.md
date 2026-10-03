# infra/

Agentronics is agent authentication only (since 2026-09-30). A deploy is **one
Cloud Run service** — `intel-api` (SDK event ingest, ingest keys, daily
retention prune) — plus the Neon URL in Secret Manager and one Cloud Scheduler
job. Neon (Postgres) and Clerk are external and survive any GCP move.

| Script | Use |
|---|---|
| `bring-up.sh` | **Start here.** Whole backend on a (new) project, one command, idempotent. |
| `deploy-api.sh` | Redeploy intel-api by hand (bring-up calls it). CI does this on `v*` tags. |
| `setup-wif.sh` | GitHub Actions → GCP keyless deploys + deployer access to the Neon secret (for pre-deploy migrations). |
| `setup-budget.sh` | Monthly budget + 50/90/100% alerts. |

Moving to a new GCP account: `docs/GCP_ACCOUNT_MOVE.md`.

## Retired (intelligence platform — kept, not run)

`gcp-bootstrap.sh`, `setup-queue.sh`, `deploy-worker.sh`, `deploy-ml.sh`,
`setup-scheduler.sh`, `setup-sdk-ml-scheduler.sh`, `setup-observability.sh`.
They provision Cloud Tasks, GCS, Vertex AI, intel-worker and the intel-ml job,
none of which the product uses now. The matching API routes only mount with
`ENABLE_INTELLIGENCE=true`.
