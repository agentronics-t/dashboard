"""Neon access for the ML job. All writes are idempotent UPSERTs keyed by the
UNIQUE constraints defined in packages/intel-schema (STEP 2)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from intel_ml.normalize import NormalizedRow


@dataclass
class ImportJob:
    id: str
    tenant_id: str
    status: str
    gcs_paths: dict[str, Any]


class Database(ABC):
    @abstractmethod
    def get_job(self, job_id: str) -> ImportJob | None: ...

    @abstractmethod
    def create_ml_job(self, tenant_id: str) -> str: ...

    @abstractmethod
    def finish_job(
        self, job_id: str, status: str, error: str | None = None,
        gcs_paths: dict[str, Any] | None = None,
    ) -> None: ...

    @abstractmethod
    def upsert_agent_traffic(self, rows: list[NormalizedRow]) -> None: ...

    @abstractmethod
    def upsert_forecasts(
        self, tenant_id: str, metric: str, rows: list[dict[str, Any]],
        model_version: str, job_id: str,
    ) -> None: ...

    @abstractmethod
    def upsert_insights(self, rows: list[Any]) -> None:
        """rows: intel_ml.insights.InsightRow — UPSERT on (job_id, kind)."""


class PostgresDatabase(Database):
    def __init__(self, database_url: str) -> None:
        import psycopg

        self._conn = psycopg.connect(database_url, autocommit=True)

    def get_job(self, job_id: str) -> ImportJob | None:
        row = self._conn.execute(
            "SELECT id, tenant_id, status, gcs_paths FROM jobs WHERE id = %s",
            (job_id,),
        ).fetchone()
        if not row:
            return None
        return ImportJob(
            id=str(row[0]), tenant_id=str(row[1]), status=row[2], gcs_paths=row[3] or {}
        )

    def create_ml_job(self, tenant_id: str) -> str:
        row = self._conn.execute(
            """INSERT INTO jobs (tenant_id, type, status, attempt, started_at)
               VALUES (%s, 'ml', 'running', 1, now()) RETURNING id""",
            (tenant_id,),
        ).fetchone()
        return str(row[0])

    def finish_job(self, job_id, status, error=None, gcs_paths=None) -> None:
        import json

        self._conn.execute(
            """UPDATE jobs SET status = %s, error = %s, finished_at = now(),
                      gcs_paths = COALESCE(%s::jsonb, gcs_paths)
               WHERE id = %s""",
            (status, error, json.dumps(gcs_paths) if gcs_paths is not None else None, job_id),
        )

    def upsert_agent_traffic(self, rows: list[NormalizedRow]) -> None:
        with self._conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO agent_traffic_daily
                     (tenant_id, date, source, agent_name, agent_lane,
                      requests, blocked, allowed, pages, conversions, job_id, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                   ON CONFLICT (tenant_id, date, source, agent_name) DO UPDATE SET
                     agent_lane = EXCLUDED.agent_lane,
                     requests = EXCLUDED.requests,
                     blocked = EXCLUDED.blocked,
                     allowed = EXCLUDED.allowed,
                     pages = EXCLUDED.pages,
                     job_id = EXCLUDED.job_id,
                     updated_at = now()""",
                [
                    (
                        r.tenant_id, r.date, r.source, r.agent_name, r.agent_lane,
                        r.requests, r.blocked, r.allowed, r.pages, r.conversions, r.job_id,
                    )
                    for r in rows
                ],
            )

    def upsert_forecasts(self, tenant_id, metric, rows, model_version, job_id) -> None:
        with self._conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO forecasts
                     (tenant_id, metric, horizon_date, p10, p50, p90, model_version, job_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (tenant_id, metric, horizon_date) DO UPDATE SET
                     p10 = EXCLUDED.p10, p50 = EXCLUDED.p50, p90 = EXCLUDED.p90,
                     model_version = EXCLUDED.model_version, job_id = EXCLUDED.job_id""",
                [
                    (
                        tenant_id, metric, r["date"],
                        float(r["p10"]), float(r["p50"]), float(r["p90"]),
                        model_version, job_id,
                    )
                    for r in rows
                ],
            )

    def upsert_insights(self, rows: list[Any]) -> None:
        with self._conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO insights
                     (tenant_id, job_id, kind, title, body_md, severity, embedding)
                   VALUES (%s, %s, %s, %s, %s, %s, %s::vector)
                   ON CONFLICT (job_id, kind) DO UPDATE SET
                     title = EXCLUDED.title, body_md = EXCLUDED.body_md,
                     severity = EXCLUDED.severity, embedding = EXCLUDED.embedding""",
                [
                    (
                        r.tenant_id, r.job_id, r.kind, r.title, r.body_md, r.severity,
                        str(r.embedding) if r.embedding is not None else None,
                    )
                    for r in rows
                ],
            )
