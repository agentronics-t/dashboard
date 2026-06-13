"""Insight layer tests: mocked Vertex client, schema guardrails, idempotent ids,
fallbacks, and the numbers-are-injected contract."""

from __future__ import annotations

import json

from intel_ml.insights import run_stage
from intel_ml.insights.agents import REGISTRY
from intel_ml.insights.llm import EMBED_DIMENSIONS

TENANT = "00000000-0000-4000-8000-000000000001"
ML_JOB = "ml-1"

VALID = json.dumps(
    {"title": "Traffic shifted", "body_md": "GPTBot led with **1,540** requests.",
     "severity": "warning"}
)


def full_stats() -> dict:
    return {
        "window": {"start": "2026-05-01", "end": "2026-05-21", "days": 21},
        "metrics": {
            "requests": {"total": 4200.0, "last_7d": 1540.0, "prev_7d": 1400.0,
                         "wow_delta_pct": 10.0,
                         "forecast": {"model_version": "ets-hw-v1", "horizon_days": 14,
                                      "backtest_mape": 0.04, "horizon_p50_total": 3100.0,
                                      "train_days": 21}},
            "blocked": {"total": 2100.0, "last_7d": 800.0, "prev_7d": 700.0,
                        "wow_delta_pct": 14.3, "forecast": None},
            "allowed": {"total": 2100.0, "last_7d": 740.0, "prev_7d": 700.0,
                        "wow_delta_pct": 5.7, "forecast": None},
        },
        "lanes": {
            "webmcp": {"requests": 0, "share_pct": 0.0},
            "webbotauth": {"requests": 1200, "share_pct": 28.6},
            "stealth": {"requests": 3000, "share_pct": 71.4},
        },
        "top_agents": [{"agent": "GPTBot", "requests": 2500, "blocked_pct": 84.0}],
        "anomalies": [{"date": "2026-05-20", "metric": "requests", "value": 900.0,
                       "expected": 210.0, "z": 4.5}],
    }


class FakeLlm:
    def __init__(self, responses: list[str] | None = None):
        self.responses = responses
        self.prompts: list[str] = []
        self.embedded: list[str] = []

    def generate_json(self, system: str, prompt: str) -> str:
        self.prompts.append(prompt)
        if self.responses:
            return self.responses.pop(0)
        return VALID

    def embed(self, text: str) -> list[float] | None:
        self.embedded.append(text)
        return [0.1] * EMBED_DIMENSIONS


def test_all_four_agents_fire_on_full_stats():
    rows = run_stage(tenant_id=TENANT, ml_job_id=ML_JOB, stats=full_stats(), llm=FakeLlm())
    assert sorted(r.kind for r in rows) == [
        "agent_lane_breakdown", "anomaly_explainer", "forecast_summary", "traffic_shift",
    ]
    for r in rows:
        assert r.job_id == ML_JOB  # deterministic identity: (job_id, kind)
        assert len(r.embedding) == EMBED_DIMENSIONS
        assert "fallback" not in r.body_md


def test_numbers_are_injected_into_prompts():
    llm = FakeLlm()
    run_stage(tenant_id=TENANT, ml_job_id=ML_JOB, stats=full_stats(), llm=llm)
    joined = "\n".join(llm.prompts)
    # exact stats values appear verbatim in the bounded context
    assert "1540.0" in joined and "71.4" in joined and '"z": 4.5' in joined


def test_agents_skip_when_data_insufficient():
    stats = full_stats()
    stats["anomalies"] = []
    stats["metrics"]["requests"]["wow_delta_pct"] = None
    rows = run_stage(tenant_id=TENANT, ml_job_id=ML_JOB, stats=stats, llm=FakeLlm())
    kinds = {r.kind for r in rows}
    assert "anomaly_explainer" not in kinds
    assert "traffic_shift" not in kinds
    assert "forecast_summary" in kinds


def test_schema_failure_retries_once_then_succeeds():
    llm = FakeLlm(responses=["not json at all", VALID] + [VALID] * 10)
    rows = run_stage(tenant_id=TENANT, ml_job_id=ML_JOB, stats=full_stats(), llm=llm)
    first = [r for r in rows if r.kind == "traffic_shift"][0]
    assert "fallback" not in first.body_md


def test_persistent_schema_failure_uses_stats_only_fallback():
    llm = FakeLlm(responses=['{"bad": 1}'] * 20)
    rows = run_stage(tenant_id=TENANT, ml_job_id=ML_JOB, stats=full_stats(), llm=llm)
    assert len(rows) == 4
    shift = [r for r in rows if r.kind == "traffic_shift"][0]
    assert "fallback" in shift.body_md
    assert "1,540" in shift.body_md  # fallback narrates real stats
    lane = [r for r in rows if r.kind == "agent_lane_breakdown"][0]
    assert lane.severity == "warning"  # stealth >= 50%


def test_no_llm_runs_fully_in_fallback_mode():
    rows = run_stage(tenant_id=TENANT, ml_job_id=ML_JOB, stats=full_stats(), llm=None)
    assert len(rows) == 4
    assert all(r.embedding is None for r in rows)
    assert all("fallback" in r.body_md for r in rows)


def test_db_receives_upsert():
    from conftest import FakeDb

    db = FakeDb()
    run_stage(tenant_id=TENANT, ml_job_id=ML_JOB, stats=full_stats(), db=db, llm=FakeLlm())
    assert len(db.insight_rows) == 4


def test_prompt_versions_recorded_in_body():
    rows = run_stage(tenant_id=TENANT, ml_job_id=ML_JOB, stats=full_stats(), llm=FakeLlm())
    for r in rows:
        assert f"{r.kind}@v1" in r.body_md


def test_registry_kinds_are_unique():
    kinds = [a.kind for a in REGISTRY]
    assert len(kinds) == len(set(kinds)) == 4
