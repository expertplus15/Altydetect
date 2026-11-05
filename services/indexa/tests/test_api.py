"""API d'Indexa : jeton interne, file d'analyse (exécutée en direct), base privée."""

import os
import secrets
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient
from redis import Redis
from rq import Queue

from indexa.main import app, get_queue
from indexa.tasks import text_key

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL") or not os.environ.get("REDIS_URL"),
    reason="PostgreSQL et Redis nécessaires",
)

TOKEN = "jeton-de-test"
HEADERS = {"X-Internal-Token": TOKEN}
FIXTURES = Path(__file__).parent / "fixtures" / "web-pages.json"
MEMOIRE = (
    "Dans les classes observées, les enseignants donnent un retour régulier et précis, ce qui "
    "permet à chacun de corriger ses méthodes avant l'examen final."
)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("INDEXA_INTERNAL_TOKEN", TOKEN)
    monkeypatch.setenv("INDEXA_SEARCH_PROVIDER", "fixtures")
    monkeypatch.setenv("INDEXA_FIXTURES_PATH", str(FIXTURES))
    redis = Redis.from_url(os.environ["REDIS_URL"])
    # File synchrone : l'analyse s'exécute pendant la requête, comme le ferait le worker.
    app.dependency_overrides[get_queue] = lambda: Queue(
        "indexa-test", connection=redis, is_async=False
    )
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def workspace() -> Iterator[str]:
    workspace_id = f"api-{secrets.token_hex(6)}"
    yield workspace_id
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.transaction():
        conn.execute("DELETE FROM private_sources WHERE workspace_id = %s", (workspace_id,))


def test_jeton_obligatoire(client: TestClient) -> None:
    response = client.post("/internal/v1/plagiarism", json={"text": "x", "scope": "web"})
    assert response.status_code == 401


def test_analyse_web_en_file(client: TestClient) -> None:
    text = "Introduction originale du devoir. " + MEMOIRE + " Conclusion personnelle sur le sujet."
    response = client.post(
        "/internal/v1/plagiarism", json={"text": text, "scope": "web"}, headers=HEADERS
    )
    assert response.status_code == 202
    task = response.json()
    assert task["status"] == "done"
    # Champs absents plutôt que null : compatible avec le contrat zod (optional).
    assert "error" not in task and "source_doc_id" not in task["result"]["matches"][0]
    assert task["result"]["engine"] == "IDX-WEB-1.0"
    assert (
        task["result"]["matches"][0]["source_url"] == "https://revue.example/evaluation-formative"
    )
    # Le texte n'est plus dans Redis après l'analyse.
    assert Redis.from_url(os.environ["REDIS_URL"]).exists(text_key(task["task_id"])) == 0
    again = client.get(f"/internal/v1/plagiarism/tasks/{task['task_id']}", headers=HEADERS)
    assert again.json()["status"] == "done"


def test_base_privee_de_bout_en_bout(client: TestClient, workspace: str) -> None:
    added = client.post(
        "/internal/v1/private-sources",
        json={"workspace_id": workspace, "title": "Mémoire 2025", "text": MEMOIRE},
        headers=HEADERS,
    )
    assert added.status_code == 201
    source_id = added.json()["source_id"]

    task = client.post(
        "/internal/v1/plagiarism",
        json={"text": MEMOIRE, "scope": "private", "workspace_id": workspace},
        headers=HEADERS,
    ).json()
    assert task["result"]["engine"] == "IDX-PRV-1.0"
    assert task["result"]["similarity"] == 1.0
    assert task["result"]["matches"][0]["source_doc_id"] == source_id

    deleted = client.delete(
        f"/internal/v1/private-sources/{source_id}",
        params={"workspace_id": workspace},
        headers=HEADERS,
    )
    assert deleted.status_code == 204


def test_base_privee_sans_espace_refusee(client: TestClient) -> None:
    response = client.post(
        "/internal/v1/plagiarism", json={"text": "x", "scope": "both"}, headers=HEADERS
    )
    assert response.status_code == 422


def test_tache_inconnue(client: TestClient) -> None:
    assert (
        client.get("/internal/v1/plagiarism/tasks/plg_inconnue", headers=HEADERS).status_code == 404
    )
