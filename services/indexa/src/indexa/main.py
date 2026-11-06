"""Application FastAPI du service Indexa."""

from importlib.metadata import version

from fastapi import FastAPI
from pydantic import BaseModel

SERVICE_NAME = "indexa"


class HealthResponse(BaseModel):
    """Réponse de l'endpoint de santé."""

    status: str
    service: str
    version: str


app = FastAPI(title="Indexa", version=version(SERVICE_NAME))


@app.get("/health")
def health() -> HealthResponse:
    """Indique que le service répond."""
    return HealthResponse(status="ok", service=SERVICE_NAME, version=version(SERVICE_NAME))
