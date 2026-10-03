# Moving Agentronics to a new GCP account

**Time:** ~30 minutes. **Downtime:** none, if you keep the old project running
until step 5.

## Why this is small

Everything stateful lives outside GCP: **Neon** holds all data (events, ingest
keys, tenants) and **Clerk** holds all users. GCP only runs one stateless Cloud
Run service (`intel-api`) plus a daily prune job. Point the new service at the
same Neon and nothing is lost — existing SDK ingest keys keep working.

## Before you start

- New Google account + project, **billing linked**.
- `gcloud auth login` as that account (project owner). Docker running.
- The Neon connection string in a local file, e.g. `~/neon.url` (one line).
  Get it from the Neon console, or from the old project:
  `gcloud secrets versions access latest --secret=neon-database-url --project <OLD_PROJECT> > ~/neon.url`
- Clerk production issuer: `https://clerk.agentronics.dev` and JWKS
  `https://clerk.agentronics.dev/.well-known/jwks.json` (unchanged by the move).

## Steps

### 1. Stand up the backend (one command)

```bash
REGION=us-east1 NEON_URL_FILE=~/neon.url \
  ./infra/bring-up.sh <NEW_PROJECT_ID> https://clerk.agentronics.dev https://clerk.agentronics.dev/.well-known/jwks.json
```

It enables APIs, creates the image repo and two least-privilege service
accounts, stores the Neon URL in Secret Manager (readable by the API only),
deploys `intel-api`, schedules the daily prune, and smoke-tests `/health`,
the locked prune endpoint, and that retired routes are gone. It prints the new
**API URL** at the end. Then delete the local copy: `rm ~/neon.url`.

**Region:** default `us-east1` puts the API next to Neon (us-east-1) and
Vercel's default region. The old project ran in `asia-south1`, which added a
~200 ms round trip to every database call during ingest.

### 2. Point the dashboard at it

Vercel → dashboard project → Settings → Environment Variables →
`INTEL_API_URL` = the new API URL → redeploy. (The dashboard reads Neon
directly for its pages; `INTEL_API_URL` is used for key management.)

### 3. Re-point CI deploys

```bash
./infra/setup-wif.sh <NEW_PROJECT_ID> agentronics-t/dashboard
```

Then GitHub → agentronics-t/dashboard → Settings → Secrets and variables →
Actions → **Variables**: set `GCP_PROJECT`, `GCP_WIF_PROVIDER`,
`GCP_DEPLOYER_SA` (all printed by the script) and `GCP_REGION=us-east1`.
Tag deploys now also run database migrations before rolling out.

### 4. Budget guard

```bash
./infra/setup-budget.sh <BILLING_ACCOUNT_ID> <NEW_PROJECT_ID> <AMOUNT>
```

Idle cost is close to zero: the service scales to zero, and there is no
worker, ML job, bucket or queue any more.

### 5. Switch customers, then retire the old project

- Any backend pushing SDK events changes its URL to
  `<NEW_API_URL>/v1/sdk/events`. Keys are unchanged.
- Watch a day of traffic on the new service, then on the **old** project:
  delete the Cloud Run services/job and scheduler jobs (or shut the project
  down). Don't delete the old project's `neon-database-url` secret before the
  new one is confirmed working.

## What changed vs. the old setup

| Old (intelligence era) | New |
|---|---|
| intel-api + intel-worker + intel-ml job | intel-api only |
| Cloud Tasks, GCS bucket, Vertex AI | none |
| Project-wide `secretmanager.admin` on the API | read access to the one Neon secret |
| Prune on intel-worker | `POST /v1/maintenance/prune` on intel-api (Scheduler OIDC only) |
| Deploys never migrated Neon | Tag deploys migrate first (deployer can read only the Neon secret) |
| asia-south1 | us-east1 (co-located with Neon) |
