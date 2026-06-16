#!/usr/bin/env bash
# setup-wif.sh — GitHub Actions → GCP Workload Identity Federation (STEP 11).
# Lets the deploy workflow authenticate WITHOUT a long-lived service-account key.
# Idempotent.
#
# Usage: ./infra/setup-wif.sh <PROJECT_ID> <GITHUB_ORG/REPO>
#   e.g. ./infra/setup-wif.sh project-6d96c09a-5821-4133-959 agentronics-t/dashboard

set -euo pipefail

PROJECT_ID="${1:?Usage: setup-wif.sh <PROJECT_ID> <ORG/REPO>}"
REPO="${2:?missing GitHub <org>/<repo>}"
REGION="asia-south1"
POOL="github-pool"
PROVIDER="github-provider"
SA="intel-deployer"
SA_EMAIL="${SA}@${PROJECT_ID}.iam.gserviceaccount.com"
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')

gcloud services enable iamcredentials.googleapis.com --project "${PROJECT_ID}"

echo "▶ Deployer service account"
gcloud iam service-accounts describe "${SA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "${SA}" --display-name "GitHub Actions deployer" --project "${PROJECT_ID}"

echo "▶ Deployer roles (build/push/deploy only)"
for role in roles/run.developer roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member "serviceAccount:${SA_EMAIL}" --role "${role}" --condition=None --quiet >/dev/null
done

echo "▶ Workload Identity pool + provider"
gcloud iam workload-identity-pools describe "${POOL}" --location global --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "${POOL}" --location global \
    --display-name "GitHub Actions" --project "${PROJECT_ID}"

gcloud iam workload-identity-pools providers describe "${PROVIDER}" \
  --location global --workload-identity-pool "${POOL}" --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER}" \
    --location global --workload-identity-pool "${POOL}" \
    --display-name "GitHub OIDC" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition "assertion.repository=='${REPO}'" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --project "${PROJECT_ID}"

echo "▶ Allow the repo to impersonate the deployer SA"
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project "${PROJECT_ID}" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" --quiet >/dev/null

PROVIDER_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
cat <<EOF

✔ WIF configured. Add these as GitHub repo **Variables** (Settings → Secrets and variables → Actions → Variables):

  GCP_PROJECT        = ${PROJECT_ID}
  GCP_WIF_PROVIDER   = ${PROVIDER_RESOURCE}
  GCP_DEPLOYER_SA    = ${SA_EMAIL}

Then tag a release to deploy:  git tag v0.1.0 && git push origin v0.1.0
EOF
