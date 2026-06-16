#!/usr/bin/env bash
# setup-budget.sh — monthly cost-guard budget + alerts (STEP 11).
# Needs billing.budgets.create (billing admin). Idempotent by display name.
#
# Usage: ./infra/setup-budget.sh <BILLING_ACCOUNT_ID> <PROJECT_ID> <AMOUNT>
#   AMOUNT is in your billing account's own currency (no currency suffix).
#   e.g. INR account → 2500 ≈ $30/mo:
#   ./infra/setup-budget.sh 01FE97-2E43EB-0A1E34 project-6d96c09a-5821-4133-959 2500

set -euo pipefail

BILLING_ACCOUNT="${1:?Usage: setup-budget.sh <BILLING_ACCOUNT_ID> <PROJECT_ID> <AMOUNT>}"
PROJECT_ID="${2:?missing PROJECT_ID}"
AMOUNT="${3:?missing AMOUNT (in billing-account currency, e.g. 2500)}"
NAME="intel-monthly-budget"

gcloud services enable billingbudgets.googleapis.com --project "${PROJECT_ID}" 2>/dev/null || true

EXISTING=$(gcloud billing budgets list --billing-account "${BILLING_ACCOUNT}" \
  --filter="displayName=${NAME}" --format='value(name)' 2>/dev/null | head -1)

# No currency suffix → gcloud uses the billing account's own currency.
ARGS=(
  --billing-account "${BILLING_ACCOUNT}"
  --display-name "${NAME}"
  --budget-amount "${AMOUNT}"
  --filter-projects "projects/${PROJECT_ID}"
  --threshold-rule=percent=0.5
  --threshold-rule=percent=0.9
  --threshold-rule=percent=1.0
)

if [[ -n "${EXISTING}" ]]; then
  echo "▶ Updating budget ${NAME} → ${AMOUNT}/mo"
  gcloud billing budgets update "${EXISTING}" "${ARGS[@]:2}"
else
  echo "▶ Creating budget ${NAME} → ${AMOUNT}/mo (alerts at 50/90/100%)"
  gcloud billing budgets create "${ARGS[@]}"
fi
echo "✔ Budget set. Alerts e-mail billing admins; link a monitoring channel in the console for custom routing."
