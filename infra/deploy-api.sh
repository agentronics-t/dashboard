#!/usr/bin/env bash
# deploy-api.sh — build, push, and deploy intel-api to Cloud Run.
#
# intel-api is the only service a normal deploy needs: SDK event ingest,
# ingest-key management, and the daily retention prune. (The retired
# intelligence routes stay off unless ENABLE_INTELLIGENCE=true.)
#
# Usage:
#   REGION=us-east1 ./infra/deploy-api.sh <PROJECT_ID> <CLERK_ISSUER> <CLERK_JWKS_URL>
#
# Requires: gcloud auth login; infra/bring-up.sh (or its foundation step) run once.

set -euo pipefail

PROJECT_ID="${1:?Usage: deploy-api.sh <PROJECT_ID> <CLERK_ISSUER> <CLERK_JWKS_URL>}"
CLERK_ISSUER="${2:?missing CLERK_ISSUER (https://clerk.<root-domain>)}"
CLERK_JWKS_URL="${3:?missing CLERK_JWKS_URL (https://clerk.<root-domain>/.well-known/jwks.json)}"
REGION="${REGION:-us-east1}"
SERVICE="intel-api"
SA="intel-api@${PROJECT_ID}.iam.gserviceaccount.com"
SCHEDULER_SA="intel-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/intel/${SERVICE}:$(date +%Y%m%d-%H%M%S)"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "▶ Building ${IMAGE} (linux/amd64 — Cloud Run requirement)"
docker build \
  --platform linux/amd64 \
  --provenance=false --sbom=false \
  -f "${REPO_ROOT}/apps/intel-api/Dockerfile" -t "${IMAGE}" "${REPO_ROOT}"

echo "▶ Pushing"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
docker push "${IMAGE}"

echo "▶ Deploying ${SERVICE} to ${REGION}"
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
  --set-env-vars "CLERK_ISSUER=${CLERK_ISSUER},CLERK_JWKS_URL=${CLERK_JWKS_URL},GCP_PROJECT=${PROJECT_ID},GCP_REGION=${REGION},SCHEDULER_SA=${SCHEDULER_SA}"

# API_AUDIENCE must equal the service's own URL (Cloud Scheduler OIDC audience).
URL=$(gcloud run services describe "${SERVICE}" --region "${REGION}" \
  --project "${PROJECT_ID}" --format='value(status.url)')
gcloud run services update "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" \
  --update-env-vars "API_AUDIENCE=${URL}" --quiet >/dev/null

echo "✔ Deployed: ${URL}"
echo "Verify: curl ${URL}/health   (use /health — Google's frontend swallows /healthz on run.app)"
