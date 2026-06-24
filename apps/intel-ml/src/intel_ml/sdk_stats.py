"""Deterministic stats over `sdk_event_daily` (+ small `sdk_events` aggregations),
fed to the SDK insight agents. Mirrors `stats.py` but for first-party SDK telemetry.
Every figure here is what the LLM is allowed to narrate — nothing is computed downstream."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pandas as pd

# metric name -> row filter over the sdk_event_daily frame
SDK_METRIC_FILTERS: dict[str, Callable[[pd.DataFrame], pd.DataFrame]] = {
    "sdk_events": lambda df: df,
    "sdk_detections": lambda df: df[df["type"] == "agent.detected"],
    "sdk_tool_calls": lambda df: df[df["type"] == "tool.executed"],
    "sdk_blocked": lambda df: df[df["outcome"] == "blocked"],
}


def to_frame(daily_rows: list[dict[str, Any]]) -> pd.DataFrame:
    cols = ["date", "type", "agent_class", "outcome", "count"]
    if not daily_rows:
        return pd.DataFrame(columns=cols)
    return pd.DataFrame(daily_rows, columns=cols)


def metric_series(df: pd.DataFrame, metric: str) -> pd.Series:
    """Daily total for a forecast metric (date-indexed)."""
    if df.empty:
        return pd.Series(dtype=float)
    sub = SDK_METRIC_FILTERS[metric](df)
    if sub.empty:
        return pd.Series(dtype=float)
    return sub.groupby("date")["count"].sum().sort_index()


def _window_stats(series: pd.Series) -> dict[str, Any]:
    total = int(series.sum())
    last_7d = int(series.iloc[-7:].sum()) if len(series) else 0
    prev_7d = int(series.iloc[-14:-7].sum()) if len(series) >= 8 else None
    wow: int | None = None
    if prev_7d is not None and prev_7d > 0:
        wow = round((last_7d - prev_7d) / prev_7d * 100)
    elif prev_7d == 0 and last_7d > 0:
        wow = 100
    return {"total": total, "last_7d": last_7d, "prev_7d": prev_7d, "wow_delta_pct": wow}


def build_sdk_stats(
    daily_rows: list[dict[str, Any]],
    top_vendors: list[dict[str, Any]],
    top_blocked_tools: list[dict[str, Any]],
    forecast_meta: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    df = to_frame(daily_rows)
    dates = sorted({r["date"] for r in daily_rows})
    window = {
        "days": len(dates),
        "start": dates[0] if dates else None,
        "end": dates[-1] if dates else None,
    }

    metrics: dict[str, Any] = {}
    for name in SDK_METRIC_FILTERS:
        m = _window_stats(metric_series(df, name))
        if name in forecast_meta:
            m["forecast"] = forecast_meta[name]
        metrics[name] = m

    # detections by agent class
    agent_mix: list[dict[str, Any]] = []
    if not df.empty:
        det = df[df["type"] == "agent.detected"]
        by_class = det.groupby("agent_class")["count"].sum().sort_values(ascending=False)
        total_det = int(by_class.sum())
        agent_mix = [
            {
                "class": str(cls),
                "count": int(c),
                "share_pct": round(int(c) / total_det * 100) if total_det else 0,
            }
            for cls, c in by_class.items()
        ]

    authz_total = int(df[df["type"] == "authz.evaluated"]["count"].sum()) if not df.empty else 0
    blocked_total = int(df[df["outcome"] == "blocked"]["count"].sum()) if not df.empty else 0
    errors_total = int(df[df["type"] == "sdk.error"]["count"].sum()) if not df.empty else 0

    return {
        "window": window,
        "metrics": metrics,
        "agent_mix": agent_mix,
        "top_vendors": top_vendors,
        "blocked": {
            "total": blocked_total,
            "rate_pct": round(blocked_total / authz_total * 100) if authz_total else 0,
        },
        "top_blocked_tools": top_blocked_tools,
        "errors": {"total": errors_total},
    }
