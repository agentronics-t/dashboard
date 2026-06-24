"""SDK ML pass (`--sdk`): forecast + insights over the SDK event stream.

Unlike the import pipeline this is Neon-in / Neon-out — the SDK rollups are
already daily-aggregated in `sdk_event_daily`, so there is no GCS/raw stage.
Writes the dedicated `sdk_forecasts` / `sdk_insights` tables (kept separate from
the web-traffic forecasts/insights). Idempotent: re-running UPSERTs the same keys.
"""

from __future__ import annotations

import logging

import pandas as pd

from intel_ml import insights, sdk_stats
from intel_ml.db import Database
from intel_ml.forecast import select_forecaster
from intel_ml.insights.llm import LlmClient
from intel_ml.insights.sdk_agents import SDK_REGISTRY

logger = logging.getLogger("intel_ml")

FORECAST_METRICS = ("sdk_events", "sdk_detections", "sdk_tool_calls", "sdk_blocked")
LOOKBACK_DAYS = 30


def run_sdk(db: Database, llm: LlmClient | None = None, tenant_id: str | None = None) -> int:
    """Run the SDK pass for one tenant, or all tenants with SDK events."""
    tenants = [tenant_id] if tenant_id else db.list_sdk_tenants()
    if not tenants:
        logger.info("no tenants with SDK events — nothing to do")
        return 0

    failures = 0
    for t in tenants:
        try:
            _run_tenant(db, llm, t)
        except Exception:  # noqa: BLE001 — isolate per-tenant failures
            logger.exception("sdk ml pass failed for tenant %s", t)
            failures += 1
    return 1 if failures else 0


def _run_tenant(db: Database, llm: LlmClient | None, tenant_id: str) -> None:
    ml_job_id = db.create_ml_job(tenant_id)
    logger.info("sdk ml job %s started (tenant %s)", ml_job_id, tenant_id)
    try:
        daily = db.read_sdk_event_daily(tenant_id)
        if not daily:
            db.finish_job(ml_job_id, "succeeded")
            logger.info("tenant %s has no sdk_event_daily rows — skip", tenant_id)
            return

        frame = sdk_stats.to_frame(daily)

        # 1. forecast each metric that has enough signal
        forecast_meta: dict[str, dict] = {}
        for metric in FORECAST_METRICS:
            series = sdk_stats.metric_series(frame, metric)
            if series.sum() == 0 or len(series) < 2:
                continue
            result = select_forecaster(series).fit_predict(series)
            db.upsert_sdk_forecasts(
                tenant_id, metric, result.forecast.to_dict("records"),
                result.model_version, ml_job_id,
            )
            forecast_meta[metric] = {
                **result.metadata,
                "horizon_p50_total": float(result.forecast["p50"].sum()),
            }

        # 2. richer context from raw sdk_events (vendor + blocked-tool breakdown)
        since = (pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=LOOKBACK_DAYS)).strftime(
            "%Y-%m-%d"
        )
        top_vendors = db.read_sdk_top_vendors(tenant_id, since)
        top_blocked = db.read_sdk_top_blocked_tools(tenant_id, since)

        # 3. stats -> SDK insight agents -> sdk_insights
        stats = sdk_stats.build_sdk_stats(daily, top_vendors, top_blocked, forecast_meta)
        insights.run_stage(
            tenant_id=tenant_id,
            ml_job_id=ml_job_id,
            stats=stats,
            db=db,
            llm=llm,
            registry=SDK_REGISTRY,
            upsert=db.upsert_sdk_insights,
            embed=False,
        )

        db.finish_job(ml_job_id, "succeeded")
        logger.info("sdk ml job %s succeeded (tenant %s)", ml_job_id, tenant_id)
    except Exception as err:  # noqa: BLE001 — single failure boundary for the job row
        logger.exception("sdk ml job %s failed", ml_job_id)
        db.finish_job(ml_job_id, "failed", error=str(err)[:2000])
        raise
