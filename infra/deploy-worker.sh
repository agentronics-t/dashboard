#!/usr/bin/env bash
# deploy-worker.sh — build, push, deploy intel-worker to Cloud Run (STEP 5),
# lock it to Cloud Tasks OIDC (intel-api SA), and point intel-api at it.
#
# Usage: ./infra/deploy-worker.sh <PROJECT_ID>

set -euo pipefail

PROJECT_ID="${1:?Usage: deploy-worker.sh <PROJECT_ID>}"
REGION="asia-south1"
SERVICE="intel-worker"
SA="intel-worker@${PROJECT_ID}.iam.gserviceaccount.com"
API_SA="intel-api@${PROJECT_ID}.iam.gserviceaccount.com"
BUCKET="agentronics-intel-${PROJECT_ID}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/intel/${SERVICE}:$(date +%Y%m%d-%H%M%S)"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "▶ Building ${IMAGE} (linux/amd64 — Cloud Run requirement)"
docker build \
  --platform linux/amd64 \
  --provenance=false --sbom=false \
  -f "${REPO_ROOT}/apps/intel-worker/Dockerfile" -t "${IMAGE}" "${REPO_ROOT}"

echo "▶ Pushing"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
docker push "${IMAGE}"

echo "▶ Deploying ${SERVICE} (private — Cloud Tasks OIDC only)"
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --service-account "${SA}" \
  --min-instances 0 \
  --max-instances 5 \
  --memory 512Mi \
  --timeout 900 \
  --no-allow-unauthenticated \
  --set-secrets "DATABASE_URL=neon-database-url:latest" \
  --set-env-vars "GCP_PROJECT=${PROJECT_ID},GCP_REGION=${REGION},GCS_BUCKET=${BUCKET},ML_JOB_NAME=intel-ml"

echo "▶ Granting run.invoker to ${API_SA} (Cloud Tasks OIDC identity)"
gcloud run services add-iam-policy-binding "${SERVICE}" \
  --region "${REGION}" --project "${PROJECT_ID}" \
  --member "serviceAccount:${API_SA}" \
  --role roles/run.invoker --quiet >/dev/null

URL=$(gcloud run services describe "${SERVICE}" --region "${REGION}" \
  --project "${PROJECT_ID}" --format='value(status.url)')
echo "✔ Worker deployed: ${URL}"

echo "▶ Pointing intel-api at the worker"
if gcloud run services describe intel-api --region "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud run services update intel-api \
    --region "${REGION}" --project "${PROJECT_ID}" \
    --update-env-vars "WORKER_URL=${URL}" >/dev/null
  echo "✔ intel-api WORKER_URL=${URL}"
else
  echo "⚠ intel-api not deployed yet — set WORKER_URL when deploying it"
fi
