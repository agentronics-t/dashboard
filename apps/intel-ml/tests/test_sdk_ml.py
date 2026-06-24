"""SDK ML pass: stats over sdk_event_daily, the SDK insight agents, run_stage
wiring (registry + upsert + embed=False), and the pipeline orchestration."""

from __future__ import annotations

from typing import Any

from intel_ml import sdk_pipeline, sdk_stats
from intel_ml.insights import run_stage
from intel_ml.insights.sdk_agents import SDK_REGISTRY

TENANT = "00000000-0000-4000-8000-000000000001"


def _daily() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    # two weeks so wow_delta_pct is defined; steady 8 detections + 4 tool calls + 2 blocks/day
    for i in range(14):
        date = f"2026-06-{i + 1:02d}"
        rows += [
            {"date": date, "type": "agent.detected", "agent_class": "crawler", "outcome": "success", "count": 5},
            {"date": date, "type": "agent.detected", "agent_class": "webmcp", "outcome": "success", "count": 3},
            {"date": date, "type": "tool.executed", "agent_class": "webmcp", "outcome": "success", "count": 4},
            {"date": date, "type": "authz.evaluated", "agent_class": "webmcp", "outcome": "blocked", "count": 2},
            {"date": date, "type": "authz.evaluated", "agent_class": "webmcp", "outcome": "success", "count": 6},
        ]
    return rows


def test_build_sdk_stats_counts_and_mix():
    stats = sdk_stats.build_sdk_stats(
        _daily(),
        top_vendors=[{"vendor": "GPTBot", "count": 70}],
        top_blocked_tools=[{"tool": "cart.checkout", "count": 28}],
        forecast_meta={},
    )
    assert stats["metrics"]["sdk_events"]["total"] == 14 * 20
    assert stats["metrics"]["sdk_detections"]["total"] == 14 * 8
    assert stats["metrics"]["sdk_tool_calls"]["total"] == 14 * 4
    assert stats["metrics"]["sdk_blocked"]["total"] == 14 * 2
    # detections by class: crawler 5/8, webmcp 3/8
    mix = {m["class"]: m for m in stats["agent_mix"]}
    assert mix["crawler"]["share_pct"] == 62 or mix["crawler"]["share_pct"] == 63
    # blocked rate = 2 / 8 authz decisions
    assert stats["blocked"]["total"] == 14 * 2
    assert stats["blocked"]["rate_pct"] == 25


def test_metric_series_feeds_forecaster_shape():
    frame = sdk_stats.to_frame(_daily())
    s = sdk_stats.metric_series(frame, "sdk_events")
    assert len(s) == 14
    assert s.sum() == 14 * 20


def test_sdk_agents_fallbacks_without_llm():
    stats = sdk_stats.build_sdk_stats(
        _daily(),
        top_vendors=[{"vendor": "GPTBot", "count": 70}],
        top_blocked_tools=[{"tool": "cart.checkout", "count": 28}],
        forecast_meta={},
    )
    captured: list = []
    rows = run_stage(
        tenant_id=TENANT,
        ml_job_id="ml-sdk-1",
        stats=stats,
        db=_FakeDb(captured),
        llm=None,  # forces deterministic fallbacks (no Vertex needed)
        registry=SDK_REGISTRY,
        upsert=lambda r: captured.extend(r),
        embed=False,
    )
    kinds = {r.kind for r in rows}
    # volume_shift (wow defined), agent_mix, tool_blocked all fire; forecast skipped (no forecast)
    assert "sdk_agent_mix" in kinds
    assert "sdk_tool_blocked" in kinds
    assert "sdk_volume_shift" in kinds
    assert all(r.embedding is None for r in rows)  # embed=False → no pgvector
    assert captured  # upsert received rows


class _FakeDb:
    """Minimal Database stand-in for the pipeline/run_stage tests."""

    def __init__(self, sink: list) -> None:
        self.sink = sink
        self.forecasts: list = []
        self.finished: list = []

    def create_ml_job(self, tenant_id: str) -> str:
        return "ml-sdk-1"

    def finish_job(self, job_id, status, error=None, gcs_paths=None) -> None:
        self.finished.append((job_id, status))

    def list_sdk_tenants(self) -> list[str]:
        return [TENANT]

    def read_sdk_event_daily(self, tenant_id: str) -> list[dict]:
        return _daily()

    def read_sdk_top_vendors(self, tenant_id, since, limit=8) -> list[dict]:
        return [{"vendor": "GPTBot", "count": 70}]

    def read_sdk_top_blocked_tools(self, tenant_id, since, limit=8) -> list[dict]:
        return [{"tool": "cart.checkout", "count": 28}]

    def upsert_sdk_forecasts(self, tenant_id, metric, rows, model_version, job_id) -> None:
        self.forecasts.append((metric, len(rows), model_version))

    def upsert_sdk_insights(self, rows) -> None:
        self.sink.extend(rows)

    # unused by the SDK pass
    def upsert_insights(self, rows) -> None:  # pragma: no cover
        raise AssertionError("SDK pass must not write the traffic insights table")


def test_sdk_pipeline_run_tenant_forecasts_and_insights():
    db = _FakeDb([])
    rc = sdk_pipeline.run_sdk(db, llm=None, tenant_id=TENANT)
    assert rc == 0
    assert db.finished[-1] == ("ml-sdk-1", "succeeded")
    # forecasts written for the metrics with signal
    metrics = {m for m, _, _ in db.forecasts}
    assert "sdk_events" in metrics and "sdk_detections" in metrics
    # SDK insights written (and never the traffic table — would have raised)
    assert any(r.kind.startswith("sdk_") for r in db.sink)
