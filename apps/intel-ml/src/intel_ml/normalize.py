"""Raw envelope rows -> normalized agent_traffic_daily rows.

Implements docs/SCHEMA_MAPPING.md. The raw payload is source-native JSON; this
module is the single owner of the mapping and the agent canon, so mapping fixes
re-derive history from immutable raw/ data.
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

LANES = ("webmcp", "webbotauth", "stealth")
_LANE_PRIORITY = {"webmcp": 0, "webbotauth": 1, "stealth": 2}

# Canonical agent names — extend here only (see SCHEMA_MAPPING.md "Agent canon").
_AGENT_CANON = {
    "gptbot": "GPTBot",
    "claudebot": "ClaudeBot",
    "claude-user": "Claude-User",
    "chatgpt-user": "ChatGPT-User",
    "oai-searchbot": "OAI-SearchBot",
    "perplexitybot": "PerplexityBot",
    "perplexity-user": "Perplexity-User",
    "google-extended": "Google-Extended",
    "googleother": "GoogleOther",
    "bingbot": "BingBot",
    "amazonbot": "Amazonbot",
    "bytespider": "Bytespider",
    "ccbot": "CCBot",
    "chatgpt": "ChatGPT",
    "claude": "Claude",
    "gemini": "Gemini",
    "perplexity": "Perplexity",
    "copilot": "Copilot",
}


def canon_agent(name: str) -> str:
    cleaned = " ".join(str(name).split()).strip()
    if not cleaned:
        return "unknown"
    # strip UA version suffix: "GPTBot/1.2" -> "GPTBot"
    base = cleaned.split("/")[0].strip()
    return _AGENT_CANON.get(base.lower(), base)


@dataclass
class NormalizedRow:
    tenant_id: str
    date: str
    source: str
    agent_name: str
    agent_lane: str
    requests: int
    blocked: int
    allowed: int
    pages: int
    conversions: int
    job_id: str


@dataclass
class _Acc:
    requests: int = 0
    blocked: int = 0
    lane: str = "stealth"
    pages: set[str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        self.pages = set()

    def merge_lane(self, lane: str) -> None:
        if _LANE_PRIORITY[lane] < _LANE_PRIORITY[self.lane]:
            self.lane = lane


def _classify_lane(payload: dict[str, Any], verified: bool) -> str:
    if payload.get("mcp") or payload.get("is_mcp"):
        return "webmcp"
    return "webbotauth" if verified else "stealth"


def _date_of(payload: dict[str, Any], fallback: str) -> str:
    for field in ("date", "timestamp", "created_at", "datetime"):
        value = payload.get(field) or (payload.get("dimensions") or {}).get(field)
        if value:
            return str(value)[:10]
    return fallback


def normalize(
    envelopes: list[dict[str, Any]],
    *,
    tenant_id: str,
    ml_job_id: str,
) -> list[NormalizedRow]:
    """envelopes: raw parquet rows (ingested_at, job_id, source, payload JSON)."""
    acc: dict[tuple[str, str, str], _Acc] = defaultdict(_Acc)

    for env in envelopes:
        source = env["source"]
        payload = json.loads(env["payload"])
        ingested = str(env["ingested_at"])[:10]
        kind = payload.get("kind", "")

        if source == "cloudflare":
            _normalize_cloudflare(acc, payload, kind, ingested)
        elif source == "profound":
            _normalize_profound(acc, payload, ingested)
        elif source == "scrunch":
            _normalize_scrunch(acc, payload, ingested)
        else:
            raise ValueError(f"unknown source: {source}")

    rows = []
    for (date, source, agent), a in sorted(acc.items()):
        blocked = min(a.blocked, a.requests)
        rows.append(
            NormalizedRow(
                tenant_id=tenant_id,
                date=date,
                source=source,
                agent_name=agent,
                agent_lane=a.lane,
                requests=a.requests,
                blocked=blocked,
                allowed=a.requests - blocked,
                pages=len(a.pages),
                conversions=0,
                job_id=ml_job_id,
            )
        )
    return rows


def _normalize_cloudflare(acc, payload, kind, ingested) -> None:
    if kind == "graphql_bot_traffic":
        dims = payload.get("dimensions") or {}
        date = _date_of(dims, ingested)
        agent = canon_agent(dims.get("userAgent") or dims.get("botName") or "unknown")
        count = int(payload.get("count") or 0)
        verified = bool(dims.get("verifiedBot")) or dims.get("botClass") == "verified"
        a = acc[(date, "cloudflare", agent)]
        a.requests += count
        if str(dims.get("securityAction") or "").lower() in {
            "block",
            "challenge",
            "managed_challenge",
            "jschallenge",
        }:
            a.blocked += count
        a.merge_lane(_classify_lane(dims, verified))
        if dims.get("clientRequestPath"):
            a.pages.add(str(dims["clientRequestPath"]))
    elif kind == "ai_crawl_control":
        date = _date_of(payload, ingested)
        agent = canon_agent(payload.get("crawler") or payload.get("bot") or "unknown")
        count = int(payload.get("requests") or payload.get("count") or 0)
        a = acc[(date, "cloudflare", agent)]
        a.requests += count
        if str(payload.get("action") or "").lower() in {"block", "blocked"}:
            a.blocked += count
        # AI Crawl Control crawlers are identity-verified by Cloudflare
        a.merge_lane(_classify_lane(payload, verified=True))
    # unknown cloudflare kinds are skipped silently — raw keeps them for later


def _normalize_profound(acc, payload, ingested) -> None:
    date = _date_of(payload, ingested)
    agent = canon_agent(payload.get("platform") or payload.get("agent") or "unknown")
    a = acc[(date, "profound", agent)]
    a.requests += 1
    if str(payload.get("status") or payload.get("action") or "").lower() in {
        "blocked",
        "denied",
    }:
        a.blocked += 1
    verified = bool(payload.get("verified", True))  # Profound attributes platforms
    a.merge_lane(_classify_lane(payload, verified))
    if payload.get("url"):
        a.pages.add(str(payload["url"]))


def _normalize_scrunch(acc, payload, ingested) -> None:
    date = _date_of(payload, ingested)
    agent = canon_agent(payload.get("model") or payload.get("platform") or "unknown")
    a = acc[(date, "scrunch", agent)]
    a.requests += 1
    # Scrunch observes answers, not enforcement — platform-attributed by construction
    a.merge_lane(_classify_lane(payload, verified=True))
    for field in ("url", "landing_url", "cited_url"):
        if payload.get(field):
            a.pages.add(str(payload[field]))
