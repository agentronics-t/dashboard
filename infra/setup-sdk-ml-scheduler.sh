#!/usr/bin/env bash
# setup-sdk-ml-scheduler.sh — daily Cloud Scheduler job that runs the SDK ML
# pass (`intel-ml --sdk`) over every tenant with SDK events: forecasts +
# insights into sdk_forecasts / sdk_insights. Idempotent.
#
# Unlike imports (Scheduler → POST /v1/imports → worker → intel-ml job), the SDK
# pass has no import to trigger — Scheduler executes the intel-ml Cloud Run Job
# directly with an args override.
#
# Usage: ./infra/setup-sdk-ml-scheduler.sh <PROJECT_ID> [CRON]
set -euo pipefail

PROJECT_ID="${1:?Usage: setup-sdk-ml-scheduler.sh <PROJECT_ID> [CRON]}"
CRON="${2:-30 2 * * *}"   # 02:30 IST — just after the daily import window
REGION="asia-south1"
TZ="Asia/Kolkata"
SA="intel-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
JOB="intel-ml"
NAME="intel-sdk-ml"
URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/${JOB}:run"

echo "▶ allow ${SA} to execute the ${JOB} Cloud Run Job"
gcloud run jobs add-iam-policy-binding "${JOB}" \
  --region "${REGION}" --project "${PROJECT_ID}" \
  --member "serviceAccount:${SA}" --role roles/run.invoker --quiet >/dev/null

action=create
if gcloud scheduler jobs describe "${NAME}" --location "${REGION}" \
     --project "${PROJECT_ID}" >/dev/null 2>&1; then
  action=update
fi

echo "▶ ${action} scheduler job ${NAME} (${CRON} ${TZ})"
gcloud scheduler jobs "${action}" http "${NAME}" \
  --location "${REGION}" --project "${PROJECT_ID}" \
  --schedule "${CRON}" --time-zone "${TZ}" \
  --uri "${URI}" --http-method POST \
  --headers "Content-Type=application/json" \
  --message-body '{"overrides":{"containerOverrides":[{"args":["--sdk"]}]}}' \
  --oauth-service-account-email "${SA}" \
  --attempt-deadline 320s

echo "✔ ${NAME} → ${JOB} --sdk (all tenants with SDK events)"
echo "  run once now: gcloud scheduler jobs run ${NAME} --location ${REGION} --project ${PROJECT_ID}"
