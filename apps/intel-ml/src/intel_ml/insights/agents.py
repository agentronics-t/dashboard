"""The insight agent registry.

Each agent is a single-purpose, schema-bound unit: a context builder that
selects the bounded slice of Step-6 stats it may narrate, a versioned prompt
template, and a deterministic stats-only fallback. Agents have no tools and no
memory — every number is injected, Gemini only narrates.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

from intel_ml.insights import prompts
from intel_ml.insights.schema import InsightOutput


@dataclass(frozen=True)
class InsightAgent:
    template: prompts.PromptTemplate
    """Returns the bounded JSON context, or None to skip (not enough data)."""
    build_context: Callable[[dict[str, Any]], dict[str, Any] | None]
    """Deterministic stats-only insight used when the LLM fails its schema twice."""
    fallback: Callable[[dict[str, Any]], InsightOutput]

    @property
    def kind(self) -> str:
        return self.template.kind

    def render_prompt(self, context: dict[str, Any]) -> str:
        return self.template.instruction.format(
            context=json.dumps(context, indent=2, sort_keys=True)
        )


def _fmt(n: Any) -> str:
    return f"{n:,.0f}" if isinstance(n, (int, float)) else str(n)


# --- traffic_shift -----------------------------------------------------------


def _traffic_shift_context(stats: dict[str, Any]) -> dict[str, Any] | None:
    requests = stats["metrics"].get("requests", {})
    if requests.get("wow_delta_pct") is None:
        return None  # < 2 weeks of history — nothing to compare
    return {
        "window": stats["window"],
        "metrics": {
            m: {k: v for k, v in s.items() if k != "forecast"}
            for m, s in stats["metrics"].items()
        },
        "top_agents": stats["top_agents"],
    }


def _traffic_shift_fallback(ctx: dict[str, Any]) -> InsightOutput:
    r = ctx["metrics"]["requests"]
    delta = r["wow_delta_pct"]
    direction = "up" if delta >= 0 else "down"
    sev = "warning" if abs(delta) >= 50 else "info"
    top = ", ".join(f"{a['agent']} ({_fmt(a['requests'])})" for a in ctx["top_agents"][:3])
    return InsightOutput(
        title=f"Agent traffic {direction} {abs(delta)}% week-over-week",
        body_md=(
            f"Requests in the last 7 days: **{_fmt(r['last_7d'])}** vs {_fmt(r['prev_7d'])} "
            f"the week before ({delta:+}%).\n\nBusiest agents: {top}.",
        )[0],
        severity=sev,
    )


# --- forecast_summary --------------------------------------------------------


def _forecast_context(stats: dict[str, Any]) -> dict[str, Any] | None:
    forecasts = {
        m: s["forecast"] for m, s in stats["metrics"].items() if s.get("forecast")
    }
    if not forecasts:
        return None
    return {"window": stats["window"], "forecasts": forecasts}


def _forecast_fallback(ctx: dict[str, Any]) -> InsightOutput:
    lines = []
    for metric, f in ctx["forecasts"].items():
        mape = f.get("backtest_mape")
        conf = f" (backtest MAPE {mape:.1%})" if isinstance(mape, float) else ""
        lines.append(
            f"- **{metric}**: ~{_fmt(f.get('horizon_p50_total'))} expected over the next "
            f"{f.get('horizon_days')} days{conf} ({f.get('model_version')})"
        )
    return InsightOutput(
        title="Traffic forecast for the coming weeks",
        body_md="\n".join(lines),
        severity="info",
    )


# --- anomaly_explainer -------------------------------------------------------


def _anomaly_context(stats: dict[str, Any]) -> dict[str, Any] | None:
    if not stats["anomalies"]:
        return None
    return {
        "window": stats["window"],
        "anomalies": stats["anomalies"],
        "top_agents": stats["top_agents"],
    }


def _anomaly_fallback(ctx: dict[str, Any]) -> InsightOutput:
    worst = ctx["anomalies"][0]
    lines = [
        f"- {a['date']}: **{a['metric']}** hit {_fmt(a['value'])} vs ~{_fmt(a['expected'])} "
        f"expected (z={a['z']})"
        for a in ctx["anomalies"][:5]
    ]
    return InsightOutput(
        title=f"Anomaly: {worst['metric']} deviated on {worst['date']}",
        body_md="Detected deviations from the 7-day baseline:\n" + "\n".join(lines),
        severity="warning",
    )


# --- agent_lane_breakdown ----------------------------------------------------


def _lane_context(stats: dict[str, Any]) -> dict[str, Any] | None:
    if all(v["requests"] == 0 for v in stats["lanes"].values()):
        return None
    return {"window": stats["window"], "lanes": stats["lanes"]}


def _lane_fallback(ctx: dict[str, Any]) -> InsightOutput:
    lanes = ctx["lanes"]
    stealth = lanes["stealth"]["share_pct"]
    body = "\n".join(
        f"- **{lane}**: {_fmt(v['requests'])} requests ({v['share_pct']}%)"
        for lane, v in lanes.items()
    )
    return InsightOutput(
        title=f"Lane breakdown: {stealth}% of agent traffic is stealth",
        body_md=body,
        severity="warning" if stealth >= 50 else "info",
    )


REGISTRY: tuple[InsightAgent, ...] = (
    InsightAgent(prompts.TRAFFIC_SHIFT, _traffic_shift_context, _traffic_shift_fallback),
    InsightAgent(prompts.FORECAST_SUMMARY, _forecast_context, _forecast_fallback),
    InsightAgent(prompts.ANOMALY_EXPLAINER, _anomaly_context, _anomaly_fallback),
    InsightAgent(prompts.AGENT_LANE_BREAKDOWN, _lane_context, _lane_fallback),
)
