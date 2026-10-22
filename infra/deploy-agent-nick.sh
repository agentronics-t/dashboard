#!/usr/bin/env bash
# deploy-agent-nick.sh — build, push, and deploy the Agent Nick service to Cloud Run.
#
# Agent Nick reads a customer's repo through our GitHub App, proposes WebMCP
# tools with Gemini on Vertex AI, and opens a pull request. The service runs
# the pipeline in-process, so CPU stays allocated after each response
# (--no-cpu-throttling); runs are a few minutes of mostly-idle I/O.
#
# Usage:
#   REGION=asia-south1 ./infra/deploy-agent-nick.sh <PROJECT_ID> <CLERK_ISSUER> <CLERK_JWKS_URL> <GITHUB_APP_ID> <GITHUB_APP_SLUG> <GITHUB_APP_CLIENT_ID> <CONSOLE_URL>
#
# One-time setup (see docs/AGENT_NICK.md): create the GitHub App, then put its
# secrets in Secret Manager — github-app-private-key, github-app-client-secret,
# github-webhook-secret — next to the existing neon-database-url.

set -euo pipefail

PROJECT_ID="${1:?project id}"
CLERK_ISSUER="${2:?CLERK_ISSUER}"
CLERK_JWKS_URL="${3:?CLERK_JWKS_URL}"
GITHUB_APP_ID="${4:?GitHub App id}"
GITHUB_APP_SLUG="${5:?GitHub App slug}"
GITHUB_APP_CLIENT_ID="${6:?GitHub App client id}"
CONSOLE_URL="${7:?console URL, e.g. https://app.agentronics.dev}"
REGION="${REGION:-asia-south1}"
SERVICE="agent-nick"
SA="agent-nick@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/intel/${SERVICE}:$(date +%Y%m%d-%H%M%S)"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "▶ Service account (Vertex AI user + Secret Manager reader)"
gcloud iam service-accounts describe "${SA}" --project "${PROJECT_ID}" >/dev/null 2>&1 ||
  gcloud iam service-accounts create agent-nick --project "${PROJECT_ID}" --display-name "Agent Nick"
for role in roles/aiplatform.user roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" --member "serviceAccount:${SA}" --role "${role}" --condition=None --quiet >/dev/null
done

echo "▶ Building ${IMAGE}"
docker build --platform linux/amd64 --provenance=false --sbom=false \
  -f "${REPO_ROOT}/apps/agent-nick/Dockerfile" -t "${IMAGE}" "${REPO_ROOT}"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
docker push "${IMAGE}"

echo "▶ Deploying ${SERVICE}"
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --service-account "${SA}" \
  --min-instances 0 \
  --max-instances 3 \
  --memory 1Gi \
  --cpu 1 \
  --no-cpu-throttling \
  --timeout 900 \
  --allow-unauthenticated \
  --set-secrets "DATABASE_URL=neon-database-url:latest,GITHUB_APP_PRIVATE_KEY=github-app-private-key:latest,GITHUB_APP_CLIENT_SECRET=github-app-client-secret:latest,GITHUB_WEBHOOK_SECRET=github-webhook-secret:latest" \
  --set-env-vars "CLERK_ISSUER=${CLERK_ISSUER},CLERK_JWKS_URL=${CLERK_JWKS_URL},GITHUB_APP_ID=${GITHUB_APP_ID},GITHUB_APP_SLUG=${GITHUB_APP_SLUG},GITHUB_APP_CLIENT_ID=${GITHUB_APP_CLIENT_ID},GCP_PROJECT=${PROJECT_ID},GCP_REGION=${REGION},VERTEX_LOCATION=global,GEMINI_MODEL=gemini-3.8-flash,CONSOLE_URL=${CONSOLE_URL}"

URL=$(gcloud run services describe "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" --format='value(status.url)')
echo "✔ Deployed: ${URL}"
echo "  Console env:      AGENT_NICK_URL=${URL}"
echo "  GitHub webhook:   ${URL}/github/webhook"
echo "  Verify:           curl ${URL}/health"
