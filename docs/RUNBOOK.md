# RUNBOOK — Agentronics Intelligence Platform

Project `project-6d96c09a-5821-4133-959`, region `asia-south1`.
Services: `intel-api` (public), `intel-worker` (private, Cloud Tasks OIDC),
`intel-ml` (Cloud Run Job). Bucket `agentronics-intel-<project>`; Neon is a
rebuildable serving mirror — GCS is the source of truth.

> Gotcha that cost us a day: Google's frontend intercepts the path `/healthz`
> on run.app URLs. External checks must use **`/health`**.

## Find a failed job

```sql
-- Neon
SELECT id, type, status, attempt, error, started_at, finished_at
FROM jobs WHERE status = 'failed' ORDER BY created_at DESC LIMIT 20;
```

```bash
# worker logs around a job
gcloud logging read 'resource.labels.service_name="intel-worker" AND jsonPayload.jobId="<JOB_ID>"' \
  --project <PROJECT> --freshness 7d --format='value(timestamp, jsonPayload.msg, jsonPayload.err)'

# ML executions
gcloud run jobs executions list --job intel-ml --region asia-south1 --project <PROJECT>
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="intel-ml"' \
  --project <PROJECT> --freshness 1d --limit 50
```

Permanent failures also appear as `pipeline_failure` insights (severity critical)
in the dashboard feed, and fire the "Intel: import job failures" alert.

## One trace end-to-end

Cloud Trace (console → Trace explorer): filter `service.name: intel-api`. The
import trace spans `POST /v1/imports` → worker `POST /tasks/import` →
`intel-ml.pipeline`. Propagation: W3C traceparent in the Cloud Tasks task
header + payload, then `TRACEPARENT` env on the ML execution.

## Replay a failed import

Re-running never duplicates data: raw paths embed `job_id`; Neon writes are UPSERTs.

```bash
# new import job for the same connector (Clerk JWT or scheduler OIDC)
curl -X POST <API_URL>/v1/imports \
  -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"connector_id":"<CONNECTOR_ID>"}'

# or re-run only the ML stage over existing raw data (any past import job id)
gcloud run jobs execute intel-ml --region asia-south1 --project <PROJECT> \
  --args='--job-id,<IMPORT_JOB_ID>' --wait
```

## Rebuild Neon from GCS

Neon aggregates/forecasts/insights are derived state. To rebuild a tenant:

1. Pick any succeeded import job id for the tenant (`SELECT id FROM jobs WHERE tenant_id='…' AND type='import' AND status='succeeded' ORDER BY created_at DESC LIMIT 1;`)
2. `gcloud run jobs execute intel-ml --args='--job-id,<that id>' --wait`
   — the pipeline reads the tenant's **entire** raw history, rewrites `derived/`,
   and UPSERTs aggregates + forecasts + insights.
3. Worst case (Neon lost entirely): re-apply migrations
   (`pnpm --filter @agentronics/intel-schema db:migrate`), re-create tenants +
   connectors via `POST /v1/connectors`, then step 2 per tenant.

## Stuck jobs

The hourly `intel-watchdog` cron fails anything `running` > 2h. Manual run:

```bash
gcloud scheduler jobs run intel-watchdog --location asia-south1 --project <PROJECT>
```

## Alerts (configured by infra/setup-observability.sh)

| Alert | Metric | Meaning |
|---|---|---|
| Intel: import job failures | `intel_job_failures` | permanent failure or watchdog kill |
| Intel: ML pipeline failures | `intel_ml_failures` | intel-ml run failed |
| Intel: Vertex AI errors | `intel_vertex_errors` | Gemini/embedding errors (insights degraded to fallback) |

Latency: log-based metric `intel_import_latency` + Cloud Run built-in
`request_latencies` per service in the console.

## Secrets

- `neon-database-url` — DATABASE_URL for all services
- `connector-{tenant}-{type}` — connector credentials (written by intel-api;
  only the name is stored in Neon)

Rotate by adding a new secret version; services read `:latest` on next start
(restart via `gcloud run services update <svc> --region asia-south1`).
