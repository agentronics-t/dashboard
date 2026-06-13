#!/usr/bin/env bash
# setup-scheduler.sh — Cloud Scheduler orchestration (STEP 8). Idempotent.
#
# Creates:
#   - SA intel-scheduler (OIDC identity for scheduled calls)
#   - per-connector daily import cron  → POST {API_URL}/v1/imports  (02:00 IST)
#   - hourly watchdog cron             → POST {WORKER_URL}/tasks/watchdog
#
# Usage:
#   ./infra/setup-scheduler.sh <PROJECT_ID>                       # watchdog only
#   ./infra/setup-scheduler.sh <PROJECT_ID> <CONNECTOR_ID> [CRON] # + import cron

set -euo pipefail

PROJECT_ID="${1:?Usage: setup-scheduler.sh <PROJECT_ID> [CONNECTOR_ID] [CRON]}"
CONNECTOR_ID="${2:-}"
CRON="${3:-0 2 * * *}"
REGION="asia-south1"
TZ="Asia/Kolkata"
SA="intel-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"

API_URL=$(gcloud run services describe intel-api --region "${REGION}" \
  --project "${PROJECT_ID}" --format='value(status.url)')
WORKER_URL=$(gcloud run services describe intel-worker --region "${REGION}" \
  --project "${PROJECT_ID}" --format='value(status.url)')

echo "▶ Service account intel-scheduler"
if ! gcloud iam service-accounts describe "${SA}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create intel-scheduler \
    --display-name "Intel Cloud Scheduler caller" --project "${PROJECT_ID}"
fi

echo "▶ run.invoker on intel-worker for the watchdog"
gcloud run services add-iam-policy-binding intel-worker \
  --region "${REGION}" --project "${PROJECT_ID}" \
  --member "serviceAccount:${SA}" --role roles/run.invoker --quiet >/dev/null

upsert_job() {
  local name="$1" schedule="$2" uri="$3" body="$4" audience="$5"
  local action=create
  if gcloud scheduler jobs describe "${name}" --location "${REGION}" \
       --project "${PROJECT_ID}" >/dev/null 2>&1; then
    action=update
  fi
  gcloud scheduler jobs "${action}" http "${name}" \
    --location "${REGION}" \
    --project "${PROJECT_ID}" \
    --schedule "${schedule}" \
    --time-zone "${TZ}" \
    --uri "${uri}" \
    --http-method POST \
    --headers "Content-Type=application/json" \
    --message-body "${body}" \
    --oidc-service-account-email "${SA}" \
    --oidc-token-audience "${audience}" \
    --attempt-deadline 180s
}

echo "▶ Watchdog cron (hourly)"
upsert_job intel-watchdog "0 * * * *" "${WORKER_URL}/tasks/watchdog" '{}' "${WORKER_URL}"

if [[ -n "${CONNECTOR_ID}" ]]; then
  SHORT="${CONNECTOR_ID:0:8}"
  echo "▶ Import cron for connector ${CONNECTOR_ID} (${CRON} ${TZ})"
  upsert_job "intel-import-${SHORT}" "${CRON}" "${API_URL}/v1/imports" \
    "{\"connector_id\":\"${CONNECTOR_ID}\"}" "${API_URL}"
fi

echo "✔ Scheduler jobs:"
gcloud scheduler jobs list --location "${REGION}" --project "${PROJECT_ID}" \
  --format='table(name.basename(), schedule, state)'
cat <<EOF

NOTE: the API only accepts these calls when deployed with:
  SCHEDULER_SA=${SA}
  API_AUDIENCE=${API_URL}
(deploy-api.sh sets both automatically.)
EOF
