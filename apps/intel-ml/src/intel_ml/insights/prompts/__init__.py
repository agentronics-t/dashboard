"""Versioned prompt registry — one template per insight kind.

A prompt change MUST bump the template's version; the version is recorded in
the insight body footer so any narrative can be traced to the exact prompt.

Hard rule encoded in every system prompt: the model narrates ONLY the numbers
present in the provided JSON context. It never computes, extrapolates, or
invents figures.
"""

from __future__ import annotations

from dataclasses import dataclass

_SYSTEM_BASE = """You are an analyst for Agentronics, a platform that monitors how AI agents \
(crawlers, assistants, answer engines) interact with a customer's website.

Rules — absolute:
- Use ONLY numbers that appear verbatim in the provided JSON context. Never compute, \
estimate, round differently, or invent any figure.
- Lanes: "webmcp" = agents using the site's MCP endpoint, "webbotauth" = verified/declared \
agents, "stealth" = unverified automated traffic.
- Be specific and concise. Markdown body, 2-5 short paragraphs or bullets, no headings.
- Respond with JSON only: {"title": string (max 80 chars), "body_md": string, \
"severity": "info" | "warning" | "critical"}.
- severity: "critical" only for drastic negative changes clearly supported by the data; \
"warning" for notable shifts worth attention; otherwise "info"."""


@dataclass(frozen=True)
class PromptTemplate:
    kind: str
    version: str
    system: str
    instruction: str


TRAFFIC_SHIFT = PromptTemplate(
    kind="traffic_shift",
    version="v1",
    system=_SYSTEM_BASE,
    instruction=(
        "Describe how AI-agent traffic shifted week-over-week. Cover the overall "
        "requests trend (wow_delta_pct), what the busiest agents did, and what the "
        "blocked/allowed balance says about enforcement. Context:\n{context}"
    ),
)

FORECAST_SUMMARY = PromptTemplate(
    kind="forecast_summary",
    version="v1",
    system=_SYSTEM_BASE,
    instruction=(
        "Summarize the traffic forecast for the next horizon. Explain what the p50 "
        "expectation is and how wide the p10-p90 uncertainty band is, per metric. "
        "Mention the backtest_mape as forecast confidence where present. Context:\n{context}"
    ),
)

ANOMALY_EXPLAINER = PromptTemplate(
    kind="anomaly_explainer",
    version="v1",
    system=_SYSTEM_BASE,
    instruction=(
        "Explain the detected anomalies: which dates and metrics deviated, by how much "
        "versus the expected baseline, and which agents plausibly relate given the "
        "top_agents data. Do not speculate beyond the data. Context:\n{context}"
    ),
)

AGENT_LANE_BREAKDOWN = PromptTemplate(
    kind="agent_lane_breakdown",
    version="v1",
    system=_SYSTEM_BASE,
    instruction=(
        "Break down traffic by agent lane (webmcp / webbotauth / stealth shares). "
        "Comment on what the stealth share means for governance and how verified-agent "
        "adoption looks. Context:\n{context}"
    ),
)
