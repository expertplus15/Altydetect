"""Mode fantôme de bout en bout : file RQ réelle (exécutée en direct), Redis et PostgreSQL."""

import json
import os
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from conftest import french_text
from redis import Redis
from rq import Queue
from test_model import manifest

from veritas import shadow
from veritas.comparisons import PostgresComparisonStore
from veritas.shadow import RqShadowQueue, ShadowJob, text_key

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL") or not os.environ.get("REDIS_URL"),
    reason="PostgreSQL et Redis nécessaires",
)

SEGMENT = "test-shadow"


@pytest.fixture
def models(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    (tmp_path / "fr").mkdir()
    (tmp_path / "fr" / "manifest.json").write_text(json.dumps(manifest()))
    monkeypatch.setenv("VERITAS_MODEL_DIR", str(tmp_path))
    monkeypatch.setattr(shadow, "_models", None)
    yield
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        conn.execute("DELETE FROM detection_comparisons WHERE segment = %s", (SEGMENT,))


def test_shadow_job_records_comparison_and_deletes_text(
    models: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    redis = Redis.from_url(os.environ["REDIS_URL"])
    submitted: list[str] = []
    original_set = redis.set

    def spy_set(key: str, *args: object, **kwargs: object) -> object:
        submitted.append(key)
        return original_set(key, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(redis, "set", spy_set)
    # File synchrone : la comparaison s'exécute pendant submit, comme le ferait le worker.
    monkeypatch.setattr(
        shadow,
        "Queue",
        lambda name, connection: Queue(name, connection=connection, is_async=False),
    )
    job = ShadowJob(SEGMENT, "fr", "pro", "pangram", 0.9, "likely_ai")
    RqShadowQueue(redis).submit(french_text(320), job)

    [key] = submitted
    assert redis.get(key) is None  # texte lu et supprimé
    [count] = [
        c
        for c in PostgresComparisonStore(os.environ["DATABASE_URL"]).counts()
        if c.segment == SEGMENT
    ]
    assert (count.veritas_engine, count.comparisons) == ("VRT-DET-FR-0.1", 1)
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        row = conn.execute(
            "SELECT plan, external_engine, source FROM detection_comparisons WHERE segment = %s",
            (SEGMENT,),
        ).fetchone()
    assert row == ("pro", "pangram", "shadow")


def test_expired_text_is_ignored(models: None) -> None:
    shadow.run_shadow(
        "absent",
        {
            "segment": SEGMENT,
            "language": "fr",
            "plan": "free",
            "external_engine": "pangram",
            "external_probability": 0.5,
            "external_band": "undetermined",
        },
    )
    assert text_key("absent") == "veritas:shadow:absent"
