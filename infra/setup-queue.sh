#!/usr/bin/env bash
# setup-queue.sh — create the import-jobs Cloud Tasks queue (STEP 5). Idempotent.
#
# Usage: ./infra/setup-queue.sh <PROJECT_ID>

set -euo pipefail

PROJECT_ID="${1:?Usage: setup-queue.sh <PROJECT_ID>}"
REGION="asia-south1"
QUEUE="import-jobs"

if gcloud tasks queues describe "${QUEUE}" --location "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "▶ Queue exists — applying retry config"
  ACTION=update
else
  echo "▶ Creating queue ${QUEUE}"
  ACTION=create
fi

# Retry policy mirrors the worker's MAX_TASK_RETRIES=4 (5 attempts total):
# the worker marks the job failed on the final attempt and acks with 200.
gcloud tasks queues "${ACTION}" "${QUEUE}" \
  --location "${REGION}" \
  --project "${PROJECT_ID}" \
  --max-attempts=5 \
  --min-backoff=10s \
  --max-backoff=300s \
  --max-doublings=4 \
  --max-concurrent-dispatches=5 \
  --max-dispatches-per-second=5

echo "✔ Queue ready:"
gcloud tasks queues describe "${QUEUE}" --location "${REGION}" --project "${PROJECT_ID}" \
  --format='value(name, retryConfig.maxAttempts, rateLimits.maxConcurrentDispatches)'
