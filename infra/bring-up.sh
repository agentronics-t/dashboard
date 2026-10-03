#!/usr/bin/env bash
# bring-up.sh — stand up the whole Agentronics backend on a GCP project, in one
# command. Idempotent: safe to re-run (every resource is checked first).
#
# What a deploy is now: ONE Cloud Run service (intel-api — SDK event ingest,
# ingest keys, daily retention prune) + the Neon URL in Secret Manager + a
# daily Cloud Scheduler job. No Cloud Tasks, GCS, Vertex AI, worker or ML job
# (the intelligence platform is retired — see infra/README.md).
#
# Usage:
#   REGION=us-east1 NEON_URL_FILE=~/neon.url \
#     ./infra/bring-up.sh <PROJECT_ID> <CLERK_ISSUER> <CLERK_JWKS_URL>
#
#   REGION         default us-east1 (co-located with Neon us-east-1 + Vercel iad1)
#   NEON_URL_FILE  file holding the Neon connection string. If unset and the
#                  secret has no version yet, you're prompted (input hidden).
#                  The URL is never echoed or written anywhere else.
#
# Prerequisites: gcloud auth login (project owner), docker running, billing
# linked to the project.

set -euo pipefail

PROJECT_ID="${1:?Usage: bring-up.sh <PROJECT_ID> <CLERK_ISSUER> <CLERK_JWKS_URL>}"
CLERK_ISSUER="${2:?missing CLERK_ISSUER (e.g. https://clerk.agentronics.dev)}"
CLERK_JWKS_URL="${3:?missing CLERK_JWKS_URL (e.g. https://clerk.agentronics.dev/.well-known/jwks.json)}"
export REGION="${REGION:-us-east1}"
TZ_NAME="Asia/Kolkata"
AR_REPO="intel"
SECRET="neon-database-url"
API_SA="intel-api@${PROJECT_ID}.iam.gserviceaccount.com"
SCHED_SA="intel-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
HERE="$(cd "$(dirname "$0")" && pwd)"

log() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. Preflight
# ---------------------------------------------------------------------------
log "Preflight — project ${PROJECT_ID}, region ${REGION}"
command -v gcloud >/dev/null || die "gcloud not installed"
command -v docker >/dev/null || die "docker not installed"
docker info >/dev/null 2>&1 || die "docker is not running"
gcloud projects describe "${PROJECT_ID}" --format='value(projectId)' >/dev/null \
  || die "project ${PROJECT_ID} not found (or no access) — check gcloud auth login"
BILLING=$(gcloud billing projects describe "${PROJECT_ID}" --format='value(billingEnabled)' 2>/dev/null || echo "")
case "${BILLING}" in
  True)  ok "project reachable, billing enabled" ;;
  False) die "billing is not enabled on ${PROJECT_ID} — link the billing account first" ;;
  *)     printf '  ! could not verify billing (continuing; API enablement fails loudly if it is off)\n' ;;
esac

# ---------------------------------------------------------------------------
# 1. APIs (only what the auth product needs)
# ---------------------------------------------------------------------------
log "Enabling APIs"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudtrace.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --project "${PROJECT_ID}"
ok "APIs enabled"

# ---------------------------------------------------------------------------
# 2. Artifact Registry
# ---------------------------------------------------------------------------
log "Artifact Registry repo '${AR_REPO}' (${REGION})"
gcloud artifacts repositories describe "${AR_REPO}" --location "${REGION}" \
    --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "${AR_REPO}" --repository-format=docker \
    --location "${REGION}" --description "Agentronics service images" --project "${PROJECT_ID}"
ok "${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}"

# ---------------------------------------------------------------------------
# 3. Service accounts (least privilege)
# ---------------------------------------------------------------------------
ensure_sa() {
  gcloud iam service-accounts describe "$1@${PROJECT_ID}.iam.gserviceaccount.com" \
      --project "${PROJECT_ID}" >/dev/null 2>&1 || \
    gcloud iam service-accounts create "$1" --display-name "$2" --project "${PROJECT_ID}"
}
log "Service accounts"
ensure_sa intel-api       "Agentronics API (Cloud Run)"
ensure_sa intel-scheduler "Agentronics Cloud Scheduler caller"
# The API only exports traces at project level; secret access is granted on
# the single secret below (no project-wide Secret Manager roles).
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member "serviceAccount:${API_SA}" --role roles/cloudtrace.agent \
  --condition=None --quiet >/dev/null
ok "intel-api, intel-scheduler"

# ---------------------------------------------------------------------------
# 4. Neon URL → Secret Manager (never echoed)
# ---------------------------------------------------------------------------
log "Secret ${SECRET}"
gcloud secrets describe "${SECRET}" --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud secrets create "${SECRET}" --replication-policy=automatic --project "${PROJECT_ID}"

HAS_VERSION=$(gcloud secrets versions list "${SECRET}" --project "${PROJECT_ID}" \
  --filter='state=ENABLED' --format='value(name)' --limit=1 2>/dev/null || true)
if [[ -n "${NEON_URL_FILE:-}" ]]; then
  [[ -r "${NEON_URL_FILE}" ]] || die "NEON_URL_FILE not readable: ${NEON_URL_FILE}"
  tr -d '\n' < "${NEON_URL_FILE}" | \
    gcloud secrets versions add "${SECRET}" --data-file=- --project "${PROJECT_ID}" >/dev/null
  ok "new secret version added from NEON_URL_FILE"
elif [[ -z "${HAS_VERSION}" ]]; then
  printf 'Paste the Neon connection string (input hidden): '
  IFS= read -rs NEON_URL; echo
  [[ "${NEON_URL}" == postgres* ]] || die "that doesn't look like a postgres:// URL"
  printf '%s' "${NEON_URL}" | \
    gcloud secrets versions add "${SECRET}" --data-file=- --project "${PROJECT_ID}" >/dev/null
  unset NEON_URL
  ok "secret version added"
else
  ok "secret already has a version (set NEON_URL_FILE to rotate)"
fi
gcloud secrets add-iam-policy-binding "${SECRET}" --project "${PROJECT_ID}" \
  --member "serviceAccount:${API_SA}" --role roles/secretmanager.secretAccessor --quiet >/dev/null
ok "intel-api can read ${SECRET} (and only that secret)"

# ---------------------------------------------------------------------------
# 5. Deploy intel-api
# ---------------------------------------------------------------------------
log "Deploying intel-api"
"${HERE}/deploy-api.sh" "${PROJECT_ID}" "${CLERK_ISSUER}" "${CLERK_JWKS_URL}"
API_URL=$(gcloud run services describe intel-api --region "${REGION}" \
  --project "${PROJECT_ID}" --format='value(status.url)')

# ---------------------------------------------------------------------------
# 6. Daily retention prune (Cloud Scheduler → OIDC → intel-api)
# ---------------------------------------------------------------------------
log "Retention prune cron (daily 04:00 ${TZ_NAME})"
JOB="agentronics-prune"
ACTION=create; HEADER_FLAG=--headers
if gcloud scheduler jobs describe "${JOB}" --location "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  ACTION=update; HEADER_FLAG=--update-headers   # gcloud quirk: update uses --update-headers
fi
gcloud scheduler jobs "${ACTION}" http "${JOB}" \
  --location "${REGION}" --project "${PROJECT_ID}" \
  --schedule "0 4 * * *" --time-zone "${TZ_NAME}" \
  --uri "${API_URL}/v1/maintenance/prune" --http-method POST \
  "${HEADER_FLAG}" "Content-Type=application/json" --message-body '{}' \
  --oidc-service-account-email "${SCHED_SA}" --oidc-token-audience "${API_URL}" \
  --attempt-deadline 180s >/dev/null
ok "${JOB} → ${API_URL}/v1/maintenance/prune"

# ---------------------------------------------------------------------------
# 7. Smoke checks
# ---------------------------------------------------------------------------
log "Smoke checks"
code=$(curl -s -o /dev/null -w '%{http_code}' "${API_URL}/health")
[[ "${code}" == "200" ]] && ok "/health → 200" || die "/health → ${code}"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${API_URL}/v1/maintenance/prune")
[[ "${code}" == "401" ]] && ok "prune without a token → 401 (locked)" || die "prune without a token → ${code} (expected 401)"
code=$(curl -s -o /dev/null -w '%{http_code}' "${API_URL}/v1/connectors")
[[ "${code}" == "401" || "${code}" == "404" ]] && ok "retired /v1/connectors not served (${code})" \
  || die "/v1/connectors → ${code}"

cat <<EOF

$(printf '\033[1;32m')Backend is up on ${PROJECT_ID}.$(printf '\033[0m')

  API URL : ${API_URL}
  Region  : ${REGION}

Finish the move (see docs/GCP_ACCOUNT_MOVE.md for detail):
  1. Vercel → dashboard project → INTEL_API_URL=${API_URL}  → redeploy
  2. ./infra/setup-wif.sh ${PROJECT_ID} agentronics-t/dashboard
     then set GitHub repo Variables GCP_PROJECT / GCP_WIF_PROVIDER /
     GCP_DEPLOYER_SA (printed by that script) and GCP_REGION=${REGION}
  3. ./infra/setup-budget.sh <BILLING_ACCOUNT_ID> ${PROJECT_ID} <AMOUNT>
  4. Customers' SDK ingest URL changes to ${API_URL}/v1/sdk/events —
     update any backend that pushes events (keys stay valid: same Neon).
  5. Only after the above works: shut down the old project's services.
EOF
