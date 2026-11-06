"""Tests de l'endpoint /health de Indexa."""

from fastapi.testclient import TestClient

from indexa.main import app

client = TestClient(app)


def test_health_returns_ok() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "indexa"
    assert body["version"] == "0.0.0"
