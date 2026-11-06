"""Application FastAPI du service Veritas (détection)."""

import hmac
import os
from functools import lru_cache
from importlib.metadata import version
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from veritas.comparisons import (
    ComparisonStore,
    MemoryComparisonStore,
    PostgresComparisonStore,
    agreement_report,
)
from veritas.contracts import (
    AgreementReport,
    DetectError,
    DetectOutput,
    Error,
    VeritasDetectRequest,
)
from veritas.engine.model import VeritasModels
from veritas.providers import external_providers_from_env
from veritas.router import DetectionUnavailableError, Router, TextTooShortError
from veritas.settings import database_url, routing_config, thresholds_config
from veritas.shadow import RqShadowQueue

SERVICE_NAME = "veritas"


class HealthResponse(BaseModel):
    """Réponse de l'endpoint de santé."""

    status: str
    service: str
    version: str


app = FastAPI(title="Veritas", version=version(SERVICE_NAME))


def require_internal_token(
    x_internal_token: Annotated[str | None, Header()] = None,
) -> None:
    """Routes internes réservées à l'application web (jeton partagé VERITAS_INTERNAL_TOKEN)."""
    expected = os.environ.get("VERITAS_INTERNAL_TOKEN")
    if not expected:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "VERITAS_INTERNAL_TOKEN manquant")
    if not x_internal_token or not hmac.compare_digest(x_internal_token, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "jeton interne invalide")


@lru_cache(maxsize=1)
def get_store() -> ComparisonStore:
    url = database_url()
    return PostgresComparisonStore(url) if url else MemoryComparisonStore()


@lru_cache(maxsize=1)
def get_router() -> Router:
    """Aiguillage construit depuis l'environnement (fournisseurs, modèles, file, base)."""
    return Router(
        thresholds=thresholds_config().get,
        routing=routing_config().get,
        externals=external_providers_from_env(),
        veritas=VeritasModels.load(),
        store=get_store(),
        shadow=RqShadowQueue(),
    )


Internal = Annotated[None, Depends(require_internal_token)]


@app.get("/health")
def health() -> HealthResponse:
    """Indique que le service répond."""
    return HealthResponse(status="ok", service=SERVICE_NAME, version=version(SERVICE_NAME))


def _error(code: Error, http_status: int, min_words: int | None = None) -> JSONResponse:
    body = DetectError(error=code, min_words=min_words).model_dump(mode="json", exclude_none=True)
    return JSONResponse(body, status_code=http_status)


@app.post(
    "/internal/v1/detect",
    response_model=DetectOutput,
    response_model_exclude_none=True,
    responses={422: {"model": DetectError}, 503: {"model": DetectError}},
)
def detect(
    request: VeritasDetectRequest,
    _: Internal,
    router: Annotated[Router, Depends(get_router)],
) -> DetectOutput | JSONResponse:
    """Détection synchrone d'un texte collé. Le texte n'est ni journalisé ni stocké."""
    try:
        return router.detect(request)
    except TextTooShortError as error:
        return _error(Error.TEXT_TOO_SHORT, 422, error.min_words)
    except DetectionUnavailableError:
        return _error(Error.DETECTION_UNAVAILABLE, 503)


@app.get("/internal/v1/detect/agreement")
def agreement(
    _: Internal, store: Annotated[ComparisonStore, Depends(get_store)]
) -> AgreementReport:
    """Taux d'accord Veritas / fournisseur externe par segment (porte de sortie de la phase 3)."""
    return agreement_report(store, routing_config().get())
