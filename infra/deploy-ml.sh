#!/usr/bin/env bash
# deploy-ml.sh — build, push, and create/update the intel-ml Cloud Run Job (STEP 6).
#
# Usage: ./infra/deploy-ml.sh <PROJECT_ID>

set -euo pipefail

PROJECT_ID="${1:?Usage: deploy-ml.sh <PROJECT_ID>}"
REGION="asia-south1"
JOB="intel-ml"
SA="intel-ml@${PROJECT_ID}.iam.gserviceaccount.com"
BUCKET="agentronics-intel-${PROJECT_ID}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/intel/${JOB}:$(date +%Y%m%d-%H%M%S)"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "▶ Building ${IMAGE} (linux/amd64 — Cloud Run requirement)"
docker build \
  --platform linux/amd64 \
  --provenance=false --sbom=false \
  -t "${IMAGE}" "${REPO_ROOT}/apps/intel-ml"

echo "▶ Pushing"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
docker push "${IMAGE}"

COMMON_FLAGS=(
  --image "${IMAGE}"
  --region "${REGION}"
  --project "${PROJECT_ID}"
  --service-account "${SA}"
  --memory 1Gi
  --cpu 1
  --max-retries 1
  --task-timeout 1800
  --set-secrets "DATABASE_URL=neon-database-url:latest"
  --set-env-vars "GCP_PROJECT=${PROJECT_ID},GCP_REGION=${REGION},GCS_BUCKET=${BUCKET},VERTEX_LOCATION=${REGION}"
)

if gcloud run jobs describe "${JOB}" --region "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "▶ Updating job ${JOB}"
  gcloud run jobs update "${JOB}" "${COMMON_FLAGS[@]}"
else
  echo "▶ Creating job ${JOB}"
  gcloud run jobs create "${JOB}" "${COMMON_FLAGS[@]}"
fi

echo "✔ Job ready. Manual smoke run:"
echo "  gcloud run jobs execute ${JOB} --region ${REGION} --project ${PROJECT_ID} --args='--job-id,<IMPORT_JOB_UUID>' --wait"
