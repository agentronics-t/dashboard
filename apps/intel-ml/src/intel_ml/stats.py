"""Deterministic statistics for the insight layer (STEP 7 input contract).

Everything an insight agent may mention is computed here — Gemini never sees
raw data and never computes a number itself.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from intel_ml.normalize import LANES, NormalizedRow

ANOMALY_Z_THRESHOLD = 3.0
ANOMALY_LOOKBACK_DAYS = 14
TOP_AGENTS = 5


def build_stats(
    rows: list[NormalizedRow],
    daily: pd.DataFrame,
    forecast_meta: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    frame = pd.DataFrame([vars(r) for r in rows])
    daily = daily.sort_index()

    return {
        "window": {
            "start": str(daily.index[0]),
            "end": str(daily.index[-1]),
            "days": int(len(daily)),
        },
        "metrics": _metrics(daily, forecast_meta),
        "lanes": _lanes(frame),
        "top_agents": _top_agents(frame),
        "anomalies": _anomalies(daily),
    }


def _metrics(daily: pd.DataFrame, forecast_meta: dict) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for metric in daily.columns:
        s = daily[metric]
        last_7 = float(s.tail(7).sum())
        prev_7 = float(s.tail(14).head(7).sum()) if len(s) >= 14 else None
        wow = (
            round((last_7 - prev_7) / prev_7 * 100, 1)
            if prev_7 not in (None, 0.0)
            else None
        )
        out[metric] = {
            "total": float(s.sum()),
            "last_7d": last_7,
            "prev_7d": prev_7,
            "wow_delta_pct": wow,
            "forecast": forecast_meta.get(metric),
        }
    return out


def _lanes(frame: pd.DataFrame) -> dict[str, Any]:
    total = int(frame["requests"].sum()) or 1
    by_lane = frame.groupby("agent_lane")["requests"].sum()
    return {
        lane: {
            "requests": int(by_lane.get(lane, 0)),
            "share_pct": round(float(by_lane.get(lane, 0)) / total * 100, 1),
        }
        for lane in LANES
    }


def _top_agents(frame: pd.DataFrame) -> list[dict[str, Any]]:
    grouped = (
        frame.groupby("agent_name")[["requests", "blocked"]]
        .sum()
        .sort_values("requests", ascending=False)
        .head(TOP_AGENTS)
    )
    return [
        {
            "agent": agent,
            "requests": int(row["requests"]),
            "blocked_pct": round(float(row["blocked"]) / float(row["requests"]) * 100, 1)
            if row["requests"]
            else 0.0,
        }
        for agent, row in grouped.iterrows()
    ]


def _anomalies(daily: pd.DataFrame) -> list[dict[str, Any]]:
    """z-score vs 7d rolling baseline, recent days only."""
    found: list[dict[str, Any]] = []
    for metric in daily.columns:
        s = daily[metric].astype(float)
        if len(s) < 10:
            continue
        mean = s.rolling(7, min_periods=7).mean().shift(1)
        std = s.rolling(7, min_periods=7).std().shift(1)
        # flat baselines have std≈0 — floor it so obvious spikes still register
        floor = np.maximum(mean.abs() * 0.05, 1.0)
        z = (s - mean) / np.maximum(std, floor)
        recent = z.tail(ANOMALY_LOOKBACK_DAYS).dropna()
        for date, zval in recent.items():
            if abs(zval) >= ANOMALY_Z_THRESHOLD:
                found.append(
                    {
                        "date": str(date),
                        "metric": metric,
                        "value": float(s[date]),
                        "expected": round(float(mean[date]), 1),
                        "z": round(float(zval), 2),
                    }
                )
    return sorted(found, key=lambda a: abs(a["z"]), reverse=True)[:10]
