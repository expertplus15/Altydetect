"""API de Veritas : jeton interne, contrat, erreurs."""

from collections.abc import Iterator

import pytest
from conftest import THRESHOLDS, FixedProvider, french_text
from fastapi.testclient import TestClient

from veritas.comparisons import MemoryComparisonStore
from veritas.engine.model import VeritasModels
from veritas.main import app, get_router, get_store
from veritas.providers.base import ProviderError
from veritas.router import Router
from veritas.settings import routing_config

TOKEN = "jeton-de-test"
HEADERS = {"X-Internal-Token": TOKEN}


def router(*providers: FixedProvider) -> Router:
    return Router(
        thresholds=lambda: THRESHOLDS,
        routing=routing_config().get,
        externals=list(providers),
        veritas=VeritasModels(),
    )


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("VERITAS_INTERNAL_TOKEN", TOKEN)
    app.dependency_overrides[get_router] = lambda: router(FixedProvider("pangram", 0.92))
    app.dependency_overrides[get_store] = MemoryComparisonStore
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_detect_returns_contract(client: TestClient) -> None:
    response = client.post(
        "/internal/v1/detect", json={"text": french_text(320), "plan": "pro"}, headers=HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "overall",
        "confidence",
        "verdict_band",
        "language",
        "sentences",
        "signals",
        "engine",
        "word_count",
    }
    assert body["verdict_band"] == "likely_ai"
    assert body["engine"] == {"primary": "pangram"}
    assert body["signals"] == {"humanization": "none"}


def test_text_too_short(client: TestClient) -> None:
    response = client.post("/internal/v1/detect", json={"text": "Trop court."}, headers=HEADERS)
    assert response.status_code == 422
    assert response.json() == {"error": "TEXT_TOO_SHORT", "min_words": 150}


def test_unavailable(client: TestClient) -> None:
    app.dependency_overrides[get_router] = lambda: router(
        FixedProvider("pangram", 0.5, ProviderError("panne"))
    )
    response = client.post("/internal/v1/detect", json={"text": french_text()}, headers=HEADERS)
    assert response.status_code == 503
    assert response.json() == {"error": "DETECTION_UNAVAILABLE"}


def test_token_required(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    assert client.post("/internal/v1/detect", json={"text": "x"}).status_code == 401
    bad = {"X-Internal-Token": "autre"}
    assert client.get("/internal/v1/detect/agreement", headers=bad).status_code == 401
    monkeypatch.delenv("VERITAS_INTERNAL_TOKEN")
    assert client.post("/internal/v1/detect", json={"text": "x"}).status_code == 503


def test_agreement_report(client: TestClient) -> None:
    response = client.get("/internal/v1/detect/agreement", headers=HEADERS)
    assert response.status_code == 200
    assert response.json() == {"threshold": 0.85, "min_comparisons": 200, "segments": []}
