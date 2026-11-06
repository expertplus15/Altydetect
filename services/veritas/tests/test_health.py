"""Tests de l'endpoint /health de Veritas."""

from fastapi.testclient import TestClient

from veritas.main import app

client = TestClient(app)


def test_health_returns_ok() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "veritas"
    assert body["version"] == "0.0.0"
