# Agentronics Intelligence Platform

Backend + dashboard for AI-agent traffic intelligence: ingest agent traffic
(Cloudflare / Profound / Scrunch), normalize, forecast, narrate with Vertex AI
Gemini, and serve it through a Next.js dashboard.

## Architecture

```
Trigger (Cloud Scheduler cron / dashboard) → intel-api (Cloud Run)
  → Cloud Tasks (import-jobs) → intel-worker (Cloud Run)
      → connector adapters → raw Parquet (GCS, source of truth)
      → triggers intel-ml (Cloud Run Job, Python)
          → normalize → derived Parquet → retrain forecasts
          → Vertex AI Gemini insights (+ pgvector embeddings)
          → UPSERT Neon (serving mirror)
  → Next.js dashboard (Vercel, Clerk): charts, forecasts, insights, agent chat
```

Region `asia-south1`. GCS is the source of truth; Neon is a rebuildable mirror.

## Layout

| Path | What |
|------|------|
| `apps/intel-api` | Fastify API (Cloud Run) — Clerk + scheduler OIDC auth, enqueues imports |
| `apps/intel-worker` | Import worker (Cloud Run) — connector adapters, raw Parquet, watchdog |
| `apps/intel-ml` | ML + insight job (Cloud Run Job, Python) — normalize, forecast, Vertex insights |
| `apps/dashboard` | Next.js 15 dashboard (Vercel) — overview, forecast, insights, activity, chat |
| `packages/intel-schema` | Shared zod + drizzle schema, GCS path builders, Neon client |
| `infra/` | bootstrap + deploy + scheduler + observability scripts |
| `docs/` | BUILD_LOG, PIPELINE, SCHEMA_MAPPING, RUNBOOK |

## Develop

```bash
pnpm install
pnpm turbo build          # api, worker, schema, dashboard
pnpm turbo test           # node + (per-app) pytest
cd apps/intel-ml && uv run pytest
```

Each app has an `.env.example`. Secrets live in GCP Secret Manager / Vercel
encrypted env — never committed.

See `docs/BUILD_LOG.md` for the full build history and `docs/RUNBOOK.md` for ops.
