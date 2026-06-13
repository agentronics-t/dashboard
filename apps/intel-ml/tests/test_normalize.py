"""Golden tests for SCHEMA_MAPPING.md normalization."""

from conftest import envelope
from intel_ml.normalize import canon_agent, normalize

TENANT = "00000000-0000-4000-8000-000000000001"
ML_JOB = "99999999-0000-4000-8000-000000000009"


def _normalize(envelopes):
    return normalize(envelopes, tenant_id=TENANT, ml_job_id=ML_JOB)


def test_cloudflare_graphql_golden():
    rows = _normalize(
        [
            envelope(
                "cloudflare",
                {
                    "kind": "graphql_bot_traffic",
                    "count": 120,
                    "dimensions": {
                        "date": "2026-06-10",
                        "botClass": "automated",
                        "userAgent": "gptbot/1.2",
                        "securityAction": "block",
                    },
                },
            ),
            envelope(
                "cloudflare",
                {
                    "kind": "graphql_bot_traffic",
                    "count": 30,
                    "dimensions": {
                        "date": "2026-06-10",
                        "botClass": "automated",
                        "userAgent": "GPTBot/1.2",
                        "securityAction": "allow",
                    },
                },
            ),
        ]
    )
    assert len(rows) == 1
    row = rows[0]
    # same agent across records: summed, canonicalized
    assert row.agent_name == "GPTBot"
    assert row.requests == 150
    assert row.blocked == 120
    assert row.allowed == 30
    assert row.agent_lane == "stealth"  # no verified flag in payload
    assert row.source == "cloudflare"
    assert row.date == "2026-06-10"
    assert row.job_id == ML_JOB


def test_cloudflare_ai_crawl_control_is_webbotauth():
    rows = _normalize(
        [
            envelope(
                "cloudflare",
                {"kind": "ai_crawl_control", "crawler": "perplexitybot", "requests": 33,
                 "action": "allow", "date": "2026-06-10"},
            )
        ]
    )
    assert rows[0].agent_name == "PerplexityBot"
    assert rows[0].agent_lane == "webbotauth"
    assert rows[0].allowed == 33


def test_mcp_flag_wins_lane_priority():
    rows = _normalize(
        [
            envelope(
                "cloudflare",
                {"kind": "ai_crawl_control", "crawler": "ClaudeBot", "requests": 5,
                 "mcp": True, "date": "2026-06-10"},
            )
        ]
    )
    assert rows[0].agent_lane == "webmcp"


def test_profound_counts_requests_and_distinct_pages():
    rows = _normalize(
        [
            envelope("profound", {"kind": "answer_request", "platform": "chatgpt",
                                  "url": "/pricing", "date": "2026-06-10"}),
            envelope("profound", {"kind": "answer_request", "platform": "ChatGPT",
                                  "url": "/pricing", "date": "2026-06-10"}),
            envelope("profound", {"kind": "answer_request", "platform": "ChatGPT",
                                  "url": "/docs", "date": "2026-06-10"}),
        ]
    )
    assert len(rows) == 1
    assert rows[0].agent_name == "ChatGPT"
    assert rows[0].requests == 3
    assert rows[0].pages == 2
    assert rows[0].agent_lane == "webbotauth"


def test_scrunch_no_enforcement_all_allowed():
    rows = _normalize(
        [
            envelope("scrunch", {"kind": "query", "model": "claude", "date": "2026-06-09"}),
            envelope("scrunch", {"kind": "response", "model": "Claude",
                                 "url": "https://x.dev/a", "date": "2026-06-09"}),
        ]
    )
    assert len(rows) == 1
    assert rows[0].agent_name == "Claude"
    assert rows[0].requests == 2
    assert rows[0].blocked == 0
    assert rows[0].allowed == 2


def test_separate_keys_stay_separate():
    rows = _normalize(
        [
            envelope("profound", {"kind": "answer_request", "platform": "ChatGPT",
                                  "date": "2026-06-09"}),
            envelope("profound", {"kind": "answer_request", "platform": "ChatGPT",
                                  "date": "2026-06-10"}),
            envelope("scrunch", {"kind": "query", "model": "ChatGPT", "date": "2026-06-10"}),
        ]
    )
    # (date, source) combinations: 2 profound dates + 1 scrunch
    assert len(rows) == 3


def test_canon_agent():
    assert canon_agent("gptbot/1.2") == "GPTBot"
    assert canon_agent("  claudebot ") == "ClaudeBot"
    assert canon_agent("SomeNewBot") == "SomeNewBot"
    assert canon_agent("") == "unknown"
