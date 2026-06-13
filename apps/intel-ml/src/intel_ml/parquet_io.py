"""Parquet read/write matching the worker's raw envelope and the derived schema."""

from __future__ import annotations

import io
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from intel_ml.normalize import NormalizedRow

DERIVED_SCHEMA = pa.schema(
    [
        ("tenant_id", pa.string()),
        ("date", pa.string()),
        ("source", pa.string()),
        ("agent_name", pa.string()),
        ("agent_lane", pa.string()),
        ("requests", pa.int64()),
        ("blocked", pa.int64()),
        ("allowed", pa.int64()),
        ("pages", pa.int64()),
        ("conversions", pa.int64()),
        ("job_id", pa.string()),
    ]
)


def read_raw(data: bytes) -> list[dict[str, Any]]:
    table = pq.read_table(io.BytesIO(data))
    return table.to_pylist()


def write_derived(rows: list[NormalizedRow]) -> bytes:
    table = pa.Table.from_pylist([vars(r) for r in rows], schema=DERIVED_SCHEMA)
    buf = io.BytesIO()
    pq.write_table(table, buf)
    return buf.getvalue()
