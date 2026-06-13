#!/usr/bin/env bash
# gcp-bootstrap.sh — Agentronics Intelligence Platform GCP foundation (STEP 0)
#
# Idempotent: safe to re-run. Every resource is checked before creation.
#
# Usage:
#   ./infra/gcp-bootstrap.sh <PROJECT_ID>
#
# Prerequisites (run as your own account):
#   gcloud auth login
#   gcloud config set project <PROJECT_ID>   # optional; script sets --project explicitly

set -euo pipefail

PROJECT_ID="${1:?Usage: gcp-bootstrap.sh <PROJECT_ID>}"
REGION="asia-south1"
BUCKET="agentronics-intel-${PROJECT_ID}"
AR_REPO="intel"

log() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }

log "Project: ${PROJECT_ID} · Region: ${REGION}"
gcloud projects describe "${PROJECT_ID}" --format='value(projectId)' >/dev/null

# ---------------------------------------------------------------------------
# 1. Enable required APIs
# ---------------------------------------------------------------------------
log "Enabling APIs"
gcloud services enable \
  run.googleapis.com \
  cloudtasks.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  artifactregistry.googleapis.com \
  aiplatform.googleapis.com \
  iam.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --project "${PROJECT_ID}"
ok "APIs enabled"

# ---------------------------------------------------------------------------
# 2. Artifact Registry (docker repo for all service images)
# ---------------------------------------------------------------------------
log "Artifact Registry repo '${AR_REPO}'"
if ! gcloud artifacts repositories describe "${AR_REPO}" \
      --location "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${AR_REPO}" \
    --repository-format=docker \
    --location "${REGION}" \
    --description "Agentronics intelligence platform images" \
    --project "${PROJECT_ID}"
fi
ok "Artifact Registry ready: ${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}"

# ---------------------------------------------------------------------------
# 3. Service accounts (least privilege)
# ---------------------------------------------------------------------------
create_sa() {
  local name="$1" display="$2"
  if ! gcloud iam service-accounts describe "${name}@${PROJECT_ID}.iam.gserviceaccount.com" \
        --project "${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud iam service-accounts create "${name}" \
      --display-name "${display}" --project "${PROJECT_ID}"
  fi
}

grant_project_role() {
  local sa="$1" role="$2"
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member "serviceAccount:${sa}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role "${role}" --condition=None --quiet >/dev/null
}

log "Service accounts"
create_sa intel-api    "Intel API (Cloud Run service)"
create_sa intel-worker "Intel Import Worker (Cloud Run service)"
create_sa intel-ml     "Intel ML Job (Cloud Run Job)"
ok "Service accounts exist"

log "IAM roles — intel-api"
grant_project_role intel-api roles/cloudtasks.enqueuer        # enqueue import jobs
grant_project_role intel-api roles/cloudtrace.agent            # export OTel spans
grant_project_role intel-api roles/secretmanager.admin         # create/update connector secrets
grant_project_role intel-api roles/secretmanager.secretAccessor # read neon-database-url
ok "intel-api roles granted"

log "IAM roles — intel-worker"
grant_project_role intel-worker roles/secretmanager.secretAccessor # connector creds + DB url
grant_project_role intel-worker roles/run.invoker                  # execute the intel-ml Cloud Run Job
grant_project_role intel-worker roles/cloudtrace.agent             # export OTel spans
ok "intel-worker roles granted"

log "IAM roles — intel-ml"
grant_project_role intel-ml roles/secretmanager.secretAccessor # DB url
grant_project_role intel-ml roles/aiplatform.user              # Vertex AI (Gemini + embeddings)
grant_project_role intel-ml roles/cloudtrace.agent             # export OTel spans
ok "intel-ml roles granted"

# Cloud Tasks creates OIDC tokens as intel-api when targeting the worker:
log "intel-api may mint OIDC tokens as itself (Cloud Tasks → worker auth)"
gcloud iam service-accounts add-iam-policy-binding \
  "intel-api@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member "serviceAccount:intel-api@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/iam.serviceAccountUser --project "${PROJECT_ID}" --quiet >/dev/null
ok "token-creator binding set"

# ---------------------------------------------------------------------------
# 4. GCS bucket (source of truth)
# ---------------------------------------------------------------------------
log "GCS bucket gs://${BUCKET}"
if ! gcloud storage buckets describe "gs://${BUCKET}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" \
    --location "${REGION}" \
    --uniform-bucket-level-access \
    --public-access-prevention \
    --project "${PROJECT_ID}"
fi

# Bucket-scoped object access for worker (writes raw/) and ml (reads raw/, writes derived/+models/)
for sa in intel-worker intel-ml; do
  gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
    --member "serviceAccount:${sa}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role roles/storage.objectAdmin --quiet >/dev/null
done

# Prefix markers (GCS has no real folders; these make layout visible in console)
for prefix in raw derived models; do
  printf '' | gcloud storage cp - "gs://${BUCKET}/${prefix}/.keep" --project "${PROJECT_ID}" >/dev/null 2>&1 || true
done
ok "Bucket ready with raw/ derived/ models/ prefixes"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
log "Bootstrap complete"
cat <<EOF

  Project          : ${PROJECT_ID}
  Region           : ${REGION}
  Artifact Registry: ${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}
  Bucket           : gs://${BUCKET}
  Service accounts : intel-api, intel-worker, intel-ml

Verify:
  gcloud services list --enabled --project ${PROJECT_ID}
  gcloud storage ls gs://${BUCKET}/
  gcloud iam service-accounts list --project ${PROJECT_ID}
EOF
