"""Stats builder tests — the deterministic input contract for insight agents."""

import numpy as np
import pandas as pd
from intel_ml.normalize import NormalizedRow
from intel_ml.stats import build_stats

TENANT = "00000000-0000-4000-8000-000000000001"


def make_rows(days: int = 21, spike_day: int | None = None) -> list[NormalizedRow]:
    rows = []
    for i in range(days):
        dt = f"2026-05-{i + 1:02d}"
        gpt = 200 if i == spike_day else 100
        rows.append(NormalizedRow(TENANT, dt, "cloudflare", "GPTBot", "stealth",
                                  gpt * 5 if i == spike_day else gpt, gpt // 2,
                                  gpt - gpt // 2, 3, 0, "ml-1"))
        rows.append(NormalizedRow(TENANT, dt, "cloudflare", "ClaudeBot", "webbotauth",
                                  50, 0, 50, 2, 0, "ml-1"))
    return rows


def make_daily(rows: list[NormalizedRow]) -> pd.DataFrame:
    frame = pd.DataFrame([vars(r) for r in rows])
    return frame.groupby("date")[["requests", "blocked", "allowed"]].sum().sort_index()


def test_lane_shares_and_top_agents():
    rows = make_rows()
    stats = build_stats(rows, make_daily(rows), {})
    assert stats["lanes"]["stealth"]["share_pct"] + stats["lanes"]["webbotauth"][
        "share_pct"
    ] == 100.0
    assert stats["top_agents"][0]["agent"] == "GPTBot"
    assert stats["top_agents"][0]["blocked_pct"] == 50.0


def test_wow_delta_computed():
    rows = make_rows()
    stats = build_stats(rows, make_daily(rows), {})
    assert stats["metrics"]["requests"]["wow_delta_pct"] == 0.0  # flat series


def test_anomaly_detected_on_spike():
    rows = make_rows(days=21, spike_day=18)  # 5x spike near the end
    stats = build_stats(rows, make_daily(rows), {})
    assert stats["anomalies"], "expected the spike to be flagged"
    top = stats["anomalies"][0]
    assert top["metric"] == "requests"
    assert top["date"] == "2026-05-19"
    assert abs(top["z"]) >= 3


def test_no_anomalies_on_flat_series():
    rows = make_rows()
    stats = build_stats(rows, make_daily(rows), {})
    assert stats["anomalies"] == []


def test_forecast_meta_passthrough():
    rows = make_rows()
    meta = {"requests": {"model_version": "ets-hw-v1", "horizon_p50_total": 1000.0}}
    stats = build_stats(rows, make_daily(rows), meta)
    assert stats["metrics"]["requests"]["forecast"]["model_version"] == "ets-hw-v1"
    assert stats["metrics"]["blocked"]["forecast"] is None


def test_short_history_has_no_wow():
    rows = make_rows(days=10)
    stats = build_stats(rows, make_daily(rows), {})
    assert stats["metrics"]["requests"]["wow_delta_pct"] is None
    assert stats["window"]["days"] == 10


def test_zero_division_guard():
    rows = [NormalizedRow(TENANT, "2026-05-01", "scrunch", "Claude", "webbotauth",
                          0, 0, 0, 0, 0, "ml-1")]
    daily = pd.DataFrame({"requests": [0], "blocked": [0], "allowed": [0]},
                         index=["2026-05-01"])
    stats = build_stats(rows, daily, {})
    assert stats["lanes"]["webbotauth"]["requests"] == 0
    assert isinstance(np.float64(stats["metrics"]["requests"]["total"]), float)
