"""SDK insight registry — narrates first-party SDK telemetry (detections, auth,
authz, tool calls) over the stats built by `intel_ml.sdk_stats`. Same contract as
the web-traffic agents: bounded context, versioned prompt, deterministic fallback.
Numbers are injected; Gemini only narrates. Written to `sdk_insights` (separate
from the traffic `insights` table)."""

from __future__ import annotations

from typing import Any

from intel_ml.insights import prompts
from intel_ml.insights.agents import InsightAgent
from intel_ml.insights.schema import InsightOutput


def _fmt(n: Any) -> str:
    return f"{n:,.0f}" if isinstance(n, (int, float)) else str(n)


# --- sdk_volume_shift --------------------------------------------------------


def _volume_context(stats: dict[str, Any]) -> dict[str, Any] | None:
    if stats["metrics"]["sdk_events"].get("wow_delta_pct") is None:
        return None  # < 2 weeks of history
    return {
        "window": stats["window"],
        "metrics": {
            m: {k: v for k, v in s.items() if k != "forecast"}
            for m, s in stats["metrics"].items()
        },
    }


def _volume_fallback(ctx: dict[str, Any]) -> InsightOutput:
    e = ctx["metrics"]["sdk_events"]
    delta = e["wow_delta_pct"]
    direction = "up" if delta >= 0 else "down"
    sev = "warning" if abs(delta) >= 50 else "info"
    return InsightOutput(
        title=f"SDK activity {direction} {abs(delta)}% week-over-week",
        body_md=(
            f"Governed events in the last 7 days: **{_fmt(e['last_7d'])}** vs "
            f"{_fmt(e['prev_7d'])} the week before ({delta:+}%).\n\n"
            f"- Detections: {_fmt(ctx['metrics']['sdk_detections']['last_7d'])}\n"
            f"- Tool calls: {_fmt(ctx['metrics']['sdk_tool_calls']['last_7d'])}\n"
            f"- Blocked: {_fmt(ctx['metrics']['sdk_blocked']['last_7d'])}"
        ),
        severity=sev,
    )


# --- sdk_agent_mix -----------------------------------------------------------


def _mix_context(stats: dict[str, Any]) -> dict[str, Any] | None:
    if not stats["agent_mix"]:
        return None
    return {
        "window": stats["window"],
        "agent_mix": stats["agent_mix"],
        "top_vendors": stats["top_vendors"],
    }


def _mix_fallback(ctx: dict[str, Any]) -> InsightOutput:
    mix = ctx["agent_mix"]
    crawler = next((m["share_pct"] for m in mix if m["class"] == "crawler"), 0)
    body = "\n".join(f"- **{m['class']}**: {_fmt(m['count'])} ({m['share_pct']}%)" for m in mix)
    if ctx["top_vendors"]:
        top = ", ".join(f"{v['vendor']} ({_fmt(v['count'])})" for v in ctx["top_vendors"][:3])
        body += f"\n\nTop vendors: {top}."
    return InsightOutput(
        title=f"Agent mix: {crawler}% of detections are crawlers",
        body_md=body,
        severity="warning" if crawler >= 50 else "info",
    )


# --- sdk_tool_blocked --------------------------------------------------------


def _blocked_context(stats: dict[str, Any]) -> dict[str, Any] | None:
    if stats["blocked"]["total"] == 0:
        return None
    return {
        "window": stats["window"],
        "blocked": stats["blocked"],
        "top_blocked_tools": stats["top_blocked_tools"],
    }


def _blocked_fallback(ctx: dict[str, Any]) -> InsightOutput:
    b = ctx["blocked"]
    tools = ctx["top_blocked_tools"]
    body = (
        f"Authorization blocked **{_fmt(b['total'])}** tool calls "
        f"({b['rate_pct']}% of decisions)."
    )
    if tools:
        body += "\n\nMost blocked:\n" + "\n".join(
            f"- `{t['tool']}`: {_fmt(t['count'])}" for t in tools[:5]
        )
    return InsightOutput(
        title=f"{_fmt(b['total'])} tool calls blocked by policy",
        body_md=body,
        severity="warning" if b["rate_pct"] >= 25 else "info",
    )


# --- sdk_forecast_summary ----------------------------------------------------


def _forecast_context(stats: dict[str, Any]) -> dict[str, Any] | None:
    forecasts = {m: s["forecast"] for m, s in stats["metrics"].items() if s.get("forecast")}
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
        title="SDK activity forecast for the coming weeks",
        body_md="\n".join(lines),
        severity="info",
    )


SDK_REGISTRY: tuple[InsightAgent, ...] = (
    InsightAgent(prompts.SDK_VOLUME_SHIFT, _volume_context, _volume_fallback),
    InsightAgent(prompts.SDK_AGENT_MIX, _mix_context, _mix_fallback),
    InsightAgent(prompts.SDK_TOOL_BLOCKED, _blocked_context, _blocked_fallback),
    InsightAgent(prompts.SDK_FORECAST_SUMMARY, _forecast_context, _forecast_fallback),
)
