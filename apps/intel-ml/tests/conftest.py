from __future__ import annotations

import json
from typing import Any

from intel_ml.db import Database, ImportJob
from intel_ml.normalize import NormalizedRow


class FakeDb(Database):
    def __init__(self, jobs: dict[str, ImportJob] | None = None) -> None:
        self.jobs = jobs or {}
        self.ml_jobs: list[dict[str, Any]] = []
        self.traffic_rows: list[NormalizedRow] = []
        self.forecast_calls: list[dict[str, Any]] = []
        self.insight_rows: list[Any] = []

    def get_job(self, job_id: str) -> ImportJob | None:
        return self.jobs.get(job_id)

    def create_ml_job(self, tenant_id: str) -> str:
        ml_id = f"ml-{len(self.ml_jobs) + 1}"
        self.ml_jobs.append({"id": ml_id, "tenant_id": tenant_id, "status": "running"})
        return ml_id

    def finish_job(self, job_id, status, error=None, gcs_paths=None) -> None:
        for job in self.ml_jobs:
            if job["id"] == job_id:
                job.update(status=status, error=error, gcs_paths=gcs_paths)

    def upsert_agent_traffic(self, rows: list[NormalizedRow]) -> None:
        self.traffic_rows = rows

    def upsert_forecasts(self, tenant_id, metric, rows, model_version, job_id) -> None:
        self.forecast_calls.append(
            {
                "tenant_id": tenant_id,
                "metric": metric,
                "rows": rows,
                "model_version": model_version,
                "job_id": job_id,
            }
        )

    def upsert_insights(self, rows: list[Any]) -> None:
        self.insight_rows = rows


def envelope(source: str, payload: dict[str, Any], dt: str = "2026-06-10") -> dict[str, Any]:
    return {
        "ingested_at": f"{dt}T02:00:00Z",
        "job_id": "11111111-2222-4333-8444-555555555555",
        "source": source,
        "schema_version": 1,
        "payload": json.dumps(payload),
    }
