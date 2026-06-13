"""Object storage behind one interface: GCS in prod, local FS in tests.

Keys are the canonical paths from packages/intel-schema (no gs:// prefix).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path


class Storage(ABC):
    @abstractmethod
    def get(self, key: str) -> bytes: ...

    @abstractmethod
    def put(self, key: str, data: bytes) -> None: ...

    @abstractmethod
    def list_prefix(self, prefix: str) -> list[str]: ...

    @abstractmethod
    def uri(self, key: str) -> str: ...


class LocalStorage(Storage):
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()

    def _resolve(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError(f"key escapes storage root: {key}")
        return path

    def get(self, key: str) -> bytes:
        return self._resolve(key).read_bytes()

    def put(self, key: str, data: bytes) -> None:
        path = self._resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def list_prefix(self, prefix: str) -> list[str]:
        base = self._resolve(prefix)
        if not base.is_dir():
            return []
        return sorted(
            str(p.relative_to(self.root))
            for p in base.rglob("*")
            if p.is_file()
        )

    def uri(self, key: str) -> str:
        return f"file://{self._resolve(key)}"


class GcsStorage(Storage):
    def __init__(self, bucket_name: str) -> None:
        from google.cloud import storage as gcs

        self.bucket_name = bucket_name
        self._bucket = gcs.Client().bucket(bucket_name)

    def get(self, key: str) -> bytes:
        return self._bucket.blob(key).download_as_bytes()

    def put(self, key: str, data: bytes) -> None:
        self._bucket.blob(key).upload_from_string(data)

    def list_prefix(self, prefix: str) -> list[str]:
        return sorted(b.name for b in self._bucket.list_blobs(prefix=prefix))

    def uri(self, key: str) -> str:
        return f"gs://{self.bucket_name}/{key}"
