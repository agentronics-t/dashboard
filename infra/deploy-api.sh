#!/usr/bin/env bash
# deploy-api.sh — build, push, and deploy intel-api to Cloud Run (STEP 4)
#
# Usage:
#   ./infra/deploy-api.sh <PROJECT_ID> <CLERK_ISSUER> <CLERK_JWKS_URL>
#
# Requires: gcloud auth login; bootstrap already run (gcp-bootstrap.sh).
# Worker URL defaults to a placeholder until STEP 5 deploys the worker —
# re-run this script afterwards to point at the real worker.

set -euo pipefail

PROJECT_ID="${1:?Usage: deploy-api.sh <PROJECT_ID> <CLERK_ISSUER> <CLERK_JWKS_URL>}"
CLERK_ISSUER="${2:?missing CLERK_ISSUER (https://….clerk.accounts.dev)}"
CLERK_JWKS_URL="${3:?missing CLERK_JWKS_URL (https://…/.well-known/jwks.json)}"
REGION="asia-south1"
SERVICE="intel-api"
SA="intel-api@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/intel/${SERVICE}:$(date +%Y%m%d-%H%M%S)"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

WORKER_URL="${WORKER_URL:-}"
if [[ -z "${WORKER_URL}" ]]; then
  WORKER_URL=$(gcloud run services describe intel-worker --region "${REGION}" \
    --project "${PROJECT_ID}" --format='value(status.url)' 2>/dev/null || true)
fi
WORKER_URL="${WORKER_URL:-https://worker-not-deployed-yet.invalid}"

echo "▶ Building ${IMAGE} (linux/amd64 — Cloud Run requirement)"
docker build \
  --platform linux/amd64 \
  --provenance=false --sbom=false \
  -f "${REPO_ROOT}/apps/intel-api/Dockerfile" -t "${IMAGE}" "${REPO_ROOT}"

echo "▶ Pushing"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
docker push "${IMAGE}"

echo "▶ Deploying ${SERVICE} (worker: ${WORKER_URL})"
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --service-account "${SA}" \
  --min-instances 0 \
  --max-instances 3 \
  --memory 512Mi \
  --allow-unauthenticated \
  --set-secrets "DATABASE_URL=neon-database-url:latest" \
  --set-env-vars "CLERK_ISSUER=${CLERK_ISSUER},CLERK_JWKS_URL=${CLERK_JWKS_URL},GCP_PROJECT=${PROJECT_ID},GCP_REGION=${REGION},TASKS_QUEUE=import-jobs,WORKER_URL=${WORKER_URL},TASKS_OIDC_SERVICE_ACCOUNT=${SA},SCHEDULER_SA=intel-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"

# API_AUDIENCE must equal the service's own URL — set it after first deploy.
URL=$(gcloud run services describe "${SERVICE}" --region "${REGION}" \
  --project "${PROJECT_ID}" --format='value(status.url)')
gcloud run services update "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" \
  --update-env-vars "API_AUDIENCE=${URL}" >/dev/null

URL=$(gcloud run services describe "${SERVICE}" --region "${REGION}" \
  --project "${PROJECT_ID}" --format='value(status.url)')
echo "✔ Deployed: ${URL}"
echo "Verify: curl ${URL}/health"
