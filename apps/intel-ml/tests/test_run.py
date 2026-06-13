from intel_ml.run import main


def test_healthcheck_exits_zero():
    assert main(["--healthcheck"]) == 0


def test_job_id_without_env_fails_cleanly(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("GCS_BUCKET", raising=False)
    assert main(["--job-id", "test-job-123"]) == 1
