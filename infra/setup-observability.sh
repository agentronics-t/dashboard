#!/usr/bin/env bash
# setup-observability.sh — log-based metrics + alert policies (STEP 9). Idempotent.
#
# Usage: ./infra/setup-observability.sh <PROJECT_ID> <ALERT_EMAIL>

set -euo pipefail

PROJECT_ID="${1:?Usage: setup-observability.sh <PROJECT_ID> <ALERT_EMAIL>}"
EMAIL="${2:?missing alert email}"

# ---------------------------------------------------------------------------
# 1. Email notification channel
# ---------------------------------------------------------------------------
echo "▶ Notification channel (${EMAIL})"
CHANNEL=$(gcloud beta monitoring channels list --project "${PROJECT_ID}" \
  --filter='display_name="Intel alerts"' --format='value(name)' | head -1)
if [[ -z "${CHANNEL}" ]]; then
  CHANNEL=$(gcloud beta monitoring channels create \
    --project "${PROJECT_ID}" \
    --display-name "Intel alerts" \
    --type email \
    --channel-labels "email_address=${EMAIL}" \
    --format='value(name)')
fi
echo "  channel: ${CHANNEL}"

# ---------------------------------------------------------------------------
# 2. Log-based metrics
# ---------------------------------------------------------------------------
upsert_metric() {
  local name="$1" description="$2" filter="$3"
  if gcloud logging metrics describe "${name}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud logging metrics update "${name}" --project "${PROJECT_ID}" \
      --description "${description}" --log-filter "${filter}"
  else
    gcloud logging metrics create "${name}" --project "${PROJECT_ID}" \
      --description "${description}" --log-filter "${filter}"
  fi
}

echo "▶ Log-based metrics"
upsert_metric intel_job_failures \
  "Import jobs failed permanently or killed by watchdog" \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="intel-worker" AND (jsonPayload.msg:"failed permanently" OR jsonPayload.msg:"watchdog failed stuck jobs")'

upsert_metric intel_ml_failures \
  "intel-ml pipeline runs that failed" \
  'resource.type="cloud_run_job" AND resource.labels.job_name="intel-ml" AND severity="ERROR" AND jsonPayload.message:"failed"'

upsert_metric intel_vertex_errors \
  "Vertex AI generation/embedding errors in the insight layer" \
  'resource.type="cloud_run_job" AND resource.labels.job_name="intel-ml" AND (jsonPayload.message:"failed schema/generation" OR jsonPayload.message:"vertex client init failed" OR jsonPayload.message:"embedding failed")'

upsert_metric intel_import_latency \
  "Worker /tasks/import request latency (seconds, from request logs)" \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="intel-worker" AND httpRequest.requestUrl:"/tasks/import"'

# ---------------------------------------------------------------------------
# 3. Alert policies (threshold: any occurrence in 5 minutes)
# ---------------------------------------------------------------------------
upsert_policy() {
  local display="$1" metric="$2" resource="${3:-cloud_run_revision}"
  local existing
  existing=$(gcloud alpha monitoring policies list --project "${PROJECT_ID}" \
    --filter="display_name=\"${display}\"" --format='value(name)' | head -1)
  local file
  file=$(mktemp)
  cat > "${file}" <<JSON
{
  "displayName": "${display}",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "${metric} > 0",
      "conditionThreshold": {
        "filter": "resource.type=\\"${resource}\\" AND metric.type=\\"logging.googleapis.com/user/${metric}\\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0,
        "duration": "0s",
        "aggregations": [
          {"alignmentPeriod": "300s", "perSeriesAligner": "ALIGN_SUM", "crossSeriesReducer": "REDUCE_SUM"}
        ]
      }
    }
  ],
  "notificationChannels": ["${CHANNEL}"]
}
JSON
  if [[ -n "${existing}" ]]; then
    gcloud alpha monitoring policies update "${existing}" \
      --project "${PROJECT_ID}" --policy-from-file "${file}" >/dev/null
  else
    gcloud alpha monitoring policies create \
      --project "${PROJECT_ID}" --policy-from-file "${file}" >/dev/null
  fi
  rm -f "${file}"
  echo "  policy: ${display}"
}

echo "▶ Alert policies"
upsert_policy "Intel: import job failures" intel_job_failures cloud_run_revision
upsert_policy "Intel: Vertex AI errors" intel_vertex_errors cloud_run_job
upsert_policy "Intel: ML pipeline failures" intel_ml_failures cloud_run_job

echo "✔ Observability configured"
