"""Insight layer (STEP 7): predefined agents over Step-6 stats via Vertex Gemini.

Flow per agent: build bounded context (skip if insufficient data) -> generate
JSON via Gemini -> pydantic-validate (retry once) -> on persistent failure use
the agent's deterministic stats-only fallback -> embed -> UPSERT into Neon
(deterministic identity: UNIQUE(job_id, kind)).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from intel_ml.insights.agents import REGISTRY, InsightAgent
from intel_ml.insights.llm import LlmClient
from intel_ml.insights.schema import InsightOutput, parse_insight

logger = logging.getLogger("intel_ml")


@dataclass
class InsightRow:
    tenant_id: str
    job_id: str
    kind: str
    title: str
    body_md: str
    severity: str
    embedding: list[float] | None


def _generate(agent: InsightAgent, context: dict[str, Any], llm: LlmClient) -> tuple[InsightOutput, bool]:
    """Returns (output, used_fallback). Retries schema failures once."""
    prompt = agent.render_prompt(context)
    for attempt in (1, 2):
        try:
            return parse_insight(llm.generate_json(agent.template.system, prompt)), False
        except Exception as err:  # noqa: BLE001 — any generation/validation failure
            logger.warning(
                "insight %s attempt %d failed schema/generation: %s",
                agent.kind,
                attempt,
                str(err)[:300],
            )
    return agent.fallback(context), True


def run_stage(
    *,
    tenant_id: str,
    ml_job_id: str,
    stats: dict[str, Any],
    db: Any = None,
    llm: LlmClient | None = None,
) -> list[InsightRow]:
    rows: list[InsightRow] = []

    for agent in REGISTRY:
        context = agent.build_context(stats)
        if context is None:
            logger.info("insight %s skipped — insufficient data", agent.kind)
            continue

        if llm is None:
            output, fallback = agent.fallback(context), True
        else:
            output, fallback = _generate(agent, context, llm)

        footer = f"\n\n---\n_{agent.kind}@{agent.template.version}" + (
            "·fallback_" if fallback else "_"
        )
        embedding = llm.embed(f"{output.title}\n{output.body_md}") if llm else None

        rows.append(
            InsightRow(
                tenant_id=tenant_id,
                job_id=ml_job_id,
                kind=agent.kind,
                title=output.title,
                body_md=output.body_md + footer,
                severity=output.severity,
                embedding=embedding,
            )
        )
        logger.info(
            "insight %s generated (fallback=%s, embedded=%s)",
            agent.kind,
            fallback,
            embedding is not None,
        )

    if db is not None and rows:
        db.upsert_insights(rows)
        logger.info("upserted %d insights", len(rows))
    return rows
