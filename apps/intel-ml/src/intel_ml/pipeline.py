"""ML pipeline (STEP 6): raw -> normalize -> derived -> retrain -> Neon.

Idempotent: re-running for the same import job overwrites the same derived/
partitions and UPSERTs the same Neon keys. Every run retrains from the full
raw history available for the tenant (cloud retrain contract).
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict

import pandas as pd

from intel_ml import insights, parquet_io, stats as stats_mod
from intel_ml.db import Database
from intel_ml.forecast import select_forecaster
from intel_ml.insights.llm import LlmClient
from intel_ml.normalize import NormalizedRow, normalize
from intel_ml.storage import Storage

logger = logging.getLogger("intel_ml")

FORECAST_METRICS = ("requests", "blocked", "allowed")
SOURCES = ("cloudflare", "profound", "scrunch")


def derived_path(tenant_id: str, dt: str) -> str:
    return f"derived/{tenant_id}/agent_traffic_daily/dt={dt}/part-00000.parquet"


def model_path(tenant_id: str, metric: str, model_version: str, file: str) -> str:
    return f"models/{tenant_id}/{metric}/{model_version}/{file}"


def run(
    import_job_id: str,
    db: Database,
    storage: Storage,
    llm: LlmClient | None = None,
) -> int:
    import_job = db.get_job(import_job_id)
    if import_job is None:
        logger.error("import job %s not found", import_job_id)
        return 1

    tenant_id = import_job.tenant_id
    ml_job_id = db.create_ml_job(tenant_id)
    logger.info("ml job %s started (import job %s, tenant %s)", ml_job_id, import_job_id, tenant_id)

    try:
        gcs_paths = _execute(db, storage, tenant_id, ml_job_id, llm)
        db.finish_job(ml_job_id, "succeeded", gcs_paths=gcs_paths)
        logger.info("ml job %s succeeded", ml_job_id)
        return 0
    except Exception as err:  # noqa: BLE001 — single failure boundary for the job row
        logger.exception("ml job %s failed", ml_job_id)
        db.finish_job(ml_job_id, "failed", error=str(err)[:2000])
        return 1


def _execute(
    db: Database,
    storage: Storage,
    tenant_id: str,
    ml_job_id: str,
    llm: LlmClient | None,
) -> dict:
    # 1. Read the tenant's full raw history (all sources, all jobs) — retrain
    #    every run over everything available.
    envelopes: list[dict] = []
    for source in SOURCES:
        for key in storage.list_prefix(f"raw/{source}/{tenant_id}/"):
            if key.endswith(".parquet"):
                envelopes.extend(parquet_io.read_raw(storage.get(key)))
    logger.info("read %d raw rows", len(envelopes))
    if not envelopes:
        raise ValueError(f"no raw data for tenant {tenant_id}")

    # 2. Normalize per SCHEMA_MAPPING.md
    rows = normalize(envelopes, tenant_id=tenant_id, ml_job_id=ml_job_id)
    logger.info("normalized to %d agent_traffic_daily rows", len(rows))

    # 3. Write derived/ partitions (source of truth) — one file per dt
    by_dt: dict[str, list[NormalizedRow]] = defaultdict(list)
    for row in rows:
        by_dt[row.date].append(row)
    derived_uris = []
    for dt, dt_rows in sorted(by_dt.items()):
        key = derived_path(tenant_id, dt)
        storage.put(key, parquet_io.write_derived(dt_rows))
        derived_uris.append(storage.uri(key))

    # 4. UPSERT aggregates into Neon (serving mirror)
    db.upsert_agent_traffic(rows)

    # 5. Retrain per metric + persist artifacts + UPSERT forecasts
    frame = pd.DataFrame([vars(r) for r in rows])
    daily = frame.groupby("date")[list(FORECAST_METRICS)].sum().sort_index()
    model_uris = []
    forecast_meta: dict[str, dict] = {}
    for metric in FORECAST_METRICS:
        series = daily[metric]
        if series.sum() == 0:
            logger.info("metric %s is all-zero — skipping forecast", metric)
            continue
        forecaster = select_forecaster(series)
        result = forecaster.fit_predict(series)

        pkl_key = model_path(tenant_id, metric, result.model_version, "model.pkl")
        meta_key = model_path(tenant_id, metric, result.model_version, "metadata.json")
        storage.put(pkl_key, result.artifact)
        storage.put(meta_key, json.dumps(result.metadata, indent=2).encode())
        model_uris.extend([storage.uri(pkl_key), storage.uri(meta_key)])

        db.upsert_forecasts(
            tenant_id,
            metric,
            result.forecast.to_dict("records"),
            result.model_version,
            ml_job_id,
        )
        forecast_meta[metric] = {
            **result.metadata,
            "horizon_p50_total": float(result.forecast["p50"].sum()),
        }
        logger.info(
            "metric %s: %s trained (days=%s mape=%s)",
            metric,
            result.model_version,
            result.metadata["train_days"],
            result.metadata["backtest_mape"],
        )

    # 6. Insight stage (STEP 7) — deterministic stats in, NL insights out
    stats = stats_mod.build_stats(rows, daily, forecast_meta)
    insights.run_stage(
        tenant_id=tenant_id, ml_job_id=ml_job_id, stats=stats, db=db, llm=llm
    )

    return {"derived": derived_uris, "models": model_uris}
