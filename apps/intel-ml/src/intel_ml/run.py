"""Entrypoint: python -m intel_ml.run --job-id <import-job-id>

Pipeline (STEP 6): read raw/ -> normalize (SCHEMA_MAPPING.md) -> derived/ ->
cloud retrain (forecasts p10/p50/p90) -> UPSERT Neon -> insight stage (STEP 7).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time


def _setup_logging() -> logging.Logger:
    """Structured JSON logs compatible with Cloud Logging."""

    class JsonFormatter(logging.Formatter):
        def format(self, record: logging.LogRecord) -> str:
            payload = {
                "severity": record.levelname,
                "message": record.getMessage(),
                "timestamp": time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)
                ),
                "logger": record.name,
            }
            if record.exc_info:
                payload["exception"] = self.formatException(record.exc_info)
            return json.dumps(payload)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("intel_ml")
    logger.setLevel(logging.INFO)
    logger.handlers = [handler]
    return logger


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="intel-ml")
    parser.add_argument("--job-id", help="Import job id (jobs.id in Neon)")
    parser.add_argument(
        "--healthcheck",
        action="store_true",
        help="Verify the module imports and exits 0 (used by docker build verify)",
    )
    args = parser.parse_args(argv)

    logger = _setup_logging()

    if args.healthcheck:
        logger.info("healthcheck ok service=intel-ml")
        return 0

    if not args.job_id:
        parser.error("--job-id is required unless --healthcheck")

    database_url = os.environ.get("DATABASE_URL")
    bucket = os.environ.get("GCS_BUCKET")
    if not database_url or not bucket:
        logger.error("DATABASE_URL and GCS_BUCKET are required")
        return 1

    from intel_ml.db import PostgresDatabase
    from intel_ml.insights.llm import llm_from_env
    from intel_ml.pipeline import run
    from intel_ml.storage import GcsStorage
    from intel_ml.tracing import pipeline_span

    logger.info("intel-ml started job_id=%s bucket=%s", args.job_id, bucket)
    with pipeline_span(args.job_id):
        return run(
            args.job_id,
            PostgresDatabase(database_url),
            GcsStorage(bucket),
            llm_from_env(),
        )


if __name__ == "__main__":
    raise SystemExit(main())
