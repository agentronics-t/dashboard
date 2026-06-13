"""OpenTelemetry → Cloud Trace for the ML job.

The worker passes TRACEPARENT via container override env, so the pipeline span
joins the same trace as API → Cloud Tasks → worker.
"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Any, Iterator

logger = logging.getLogger("intel_ml")


def _setup() -> tuple[Any, Any, Any] | None:
    project = os.environ.get("GCP_PROJECT")
    if not project or os.environ.get("OTEL_DISABLED") == "1":
        return None
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.cloud_trace import CloudTraceSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.trace.propagation.tracecontext import (
            TraceContextTextMapPropagator,
        )

        provider = TracerProvider(
            resource=Resource.create({"service.name": "intel-ml"})
        )
        provider.add_span_processor(
            BatchSpanProcessor(CloudTraceSpanExporter(project_id=project))
        )
        trace.set_tracer_provider(provider)

        carrier: dict[str, str] = {}
        traceparent = os.environ.get("TRACEPARENT")
        if traceparent:
            carrier["traceparent"] = traceparent
        ctx = TraceContextTextMapPropagator().extract(carrier)
        return trace.get_tracer("intel_ml"), ctx, provider
    except Exception:  # noqa: BLE001 — tracing must never break the pipeline
        logger.exception("otel init failed — continuing without tracing")
        return None


@contextmanager
def pipeline_span(job_id: str) -> Iterator[None]:
    setup = _setup()
    if setup is None:
        yield
        return
    tracer, ctx, provider = setup
    try:
        with tracer.start_as_current_span("intel-ml.pipeline", context=ctx) as span:
            span.set_attribute("intel.import_job_id", job_id)
            yield
    finally:
        provider.shutdown()
