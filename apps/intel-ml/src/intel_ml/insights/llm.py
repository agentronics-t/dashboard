"""Vertex AI access — Gemini for narration, embedding model for pgvector.

GCP-native service-account auth only (genai.Client(vertexai=True)); never an
API key. Region defaults to asia-south1 per the architecture contract.
"""

from __future__ import annotations

import logging
import os
from typing import Protocol

logger = logging.getLogger("intel_ml")

EMBED_DIMENSIONS = 768  # matches insights.embedding vector(768)


class LlmClient(Protocol):
    def generate_json(self, system: str, prompt: str) -> str: ...

    def embed(self, text: str) -> list[float] | None: ...


class VertexLlm:
    def __init__(
        self,
        project: str,
        location: str = "asia-south1",
        model: str | None = None,
        embed_model: str | None = None,
    ) -> None:
        from google import genai

        self._client = genai.Client(vertexai=True, project=project, location=location)
        self.model = model or os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        self.embed_model = embed_model or os.environ.get("EMBED_MODEL", "text-embedding-005")

    def generate_json(self, system: str, prompt: str) -> str:
        from google.genai import types

        response = self._client.models.generate_content(
            model=self.model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                temperature=0.2,
                max_output_tokens=2048,
            ),
        )
        return response.text or ""

    def embed(self, text: str) -> list[float] | None:
        from google.genai import types

        try:
            result = self._client.models.embed_content(
                model=self.embed_model,
                contents=text,
                config=types.EmbedContentConfig(output_dimensionality=EMBED_DIMENSIONS),
            )
            values = list(result.embeddings[0].values)
            return values if len(values) == EMBED_DIMENSIONS else None
        except Exception:  # noqa: BLE001 — embeddings are best-effort
            logger.exception("embedding failed — storing insight without vector")
            return None


def llm_from_env() -> VertexLlm | None:
    """Build the real client from env; None (=> fallback insights) if unavailable."""
    project = os.environ.get("GCP_PROJECT")
    if not project:
        return None
    try:
        return VertexLlm(project, os.environ.get("VERTEX_LOCATION", "asia-south1"))
    except Exception:  # noqa: BLE001
        logger.exception("vertex client init failed — insights will use fallback")
        return None
