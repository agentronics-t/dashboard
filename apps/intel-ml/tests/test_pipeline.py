"""End-to-end pipeline test: raw parquet fixture -> derived + models + upserts."""

from __future__ import annotations

import io
import json

import pyarrow as pa
import pyarrow.parquet as pq
from conftest import FakeDb
from intel_ml.db import ImportJob
from intel_ml.parquet_io import read_raw
from intel_ml.pipeline import run
from intel_ml.storage import LocalStorage

TENANT = "00000000-0000-4000-8000-000000000001"
IMPORT_JOB = "11111111-2222-4333-8444-555555555555"


def write_raw_fixture(storage: LocalStorage, days: int = 21) -> None:
    """Synthetic Cloudflare raw partitions: one parquet per day, two agents."""
    for i in range(days):
        dt = f"2026-05-{i + 1:02d}"
        payloads = [
            {
                "kind": "graphql_bot_traffic",
                "count": 100 + 10 * (i % 7),
                "dimensions": {
                    "date": dt,
                    "userAgent": "GPTBot/1.2",
                    "securityAction": "block",
                },
            },
            {
                "kind": "graphql_bot_traffic",
                "count": 40 + 5 * (i % 7),
                "dimensions": {
                    "date": dt,
                    "userAgent": "ClaudeBot/1.0",
                    "securityAction": "allow",
                },
            },
        ]
        rows = [
            {
                "ingested_at": f"{dt}T02:00:00Z",
                "job_id": IMPORT_JOB,
                "source": "cloudflare",
                "schema_version": 1,
                "payload": json.dumps(p),
            }
            for p in payloads
        ]
        buf = io.BytesIO()
        pq.write_table(pa.Table.from_pylist(rows), buf)
        storage.put(
            f"raw/cloudflare/{TENANT}/dt={dt}/job={IMPORT_JOB}/part-00000.parquet",
            buf.getvalue(),
        )


def make_db() -> FakeDb:
    return FakeDb(
        {
            IMPORT_JOB: ImportJob(
                id=IMPORT_JOB, tenant_id=TENANT, status="succeeded", gcs_paths={}
            )
        }
    )


def test_full_pipeline(tmp_path):
    storage = LocalStorage(tmp_path)
    write_raw_fixture(storage)
    db = make_db()

    assert run(IMPORT_JOB, db, storage) == 0

    # ml job row lifecycle
    assert db.ml_jobs[0]["status"] == "succeeded"
    assert db.ml_jobs[0]["gcs_paths"]["derived"]
    assert db.ml_jobs[0]["gcs_paths"]["models"]

    # derived/ partitions written and readable (source of truth)
    derived_keys = storage.list_prefix(f"derived/{TENANT}/")
    assert len(derived_keys) == 21
    sample = read_raw(storage.get(derived_keys[0]))
    assert sample[0]["agent_name"] in {"GPTBot", "ClaudeBot"}
    assert sample[0]["tenant_id"] == TENANT

    # aggregates upserted: 21 days x 2 agents
    assert len(db.traffic_rows) == 42
    gpt = [r for r in db.traffic_rows if r.agent_name == "GPTBot"][0]
    assert gpt.blocked == gpt.requests  # all GPTBot traffic blocked in fixture

    # forecasts for each non-zero metric, 14-day horizon, quantiles ordered
    metrics = {c["metric"] for c in db.forecast_calls}
    assert metrics == {"requests", "blocked", "allowed"}
    for call in db.forecast_calls:
        assert len(call["rows"]) == 14
        assert call["model_version"] == "ets-hw-v1"  # 21 days -> ETS selected
        for r in call["rows"]:
            assert r["p10"] <= r["p50"] <= r["p90"]

    # model artifacts persisted
    model_keys = storage.list_prefix(f"models/{TENANT}/")
    assert any(k.endswith("model.pkl") for k in model_keys)
    meta = json.loads(
        storage.get([k for k in model_keys if k.endswith("metadata.json")][0])
    )
    assert meta["model_version"] == "ets-hw-v1"
    assert meta["train_days"] == 21


def test_pipeline_idempotent(tmp_path):
    storage = LocalStorage(tmp_path)
    write_raw_fixture(storage)
    db = make_db()

    assert run(IMPORT_JOB, db, storage) == 0
    first_derived = storage.list_prefix(f"derived/{TENANT}/")
    assert run(IMPORT_JOB, db, storage) == 0

    # same derived partitions (overwritten, not duplicated); upserts keyed identically
    assert storage.list_prefix(f"derived/{TENANT}/") == first_derived
    assert len(db.traffic_rows) == 42


def test_unknown_job_fails_cleanly(tmp_path):
    assert run("not-a-job", FakeDb(), LocalStorage(tmp_path)) == 1


def test_no_raw_data_marks_ml_job_failed(tmp_path):
    db = make_db()
    assert run(IMPORT_JOB, db, LocalStorage(tmp_path)) == 1
    assert db.ml_jobs[0]["status"] == "failed"
    assert "no raw data" in db.ml_jobs[0]["error"]
