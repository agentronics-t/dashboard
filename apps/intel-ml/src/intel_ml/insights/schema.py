"""Output contract for every insight agent — validated before anything is stored."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class InsightOutput(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    body_md: str = Field(min_length=1, max_length=8000)
    severity: Literal["info", "warning", "critical"] = "info"


def parse_insight(raw: str) -> InsightOutput:
    """Parse model output (JSON string) into the validated schema. Raises on failure."""
    return InsightOutput.model_validate_json(raw)
