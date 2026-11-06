"""Application FastAPI du service Indexa (plagiat)."""

import hmac
import os
from collections.abc import Iterator
from importlib.metadata import version
from typing import Annotated

import psycopg
from fastapi import Depends, FastAPI, Header, HTTPException, Response, status
from pydantic import BaseModel
from redis import Redis
from rq import Queue
from rq.exceptions import NoSuchJobError
from rq.job import Job, JobStatus

from indexa.config import database_url, redis_url
from indexa.contracts import (
    PlagiarismInput,
    PlagiarismOutput,
    PlagiarismTask,
    PrivateSource,
    PrivateSourceInput,
    Scope,
    Status,
)
from indexa.private import delete_source, index_source
from indexa.tasks import QUEUE, enqueue_analysis

SERVICE_NAME = "indexa"


class HealthResponse(BaseModel):
    """Réponse de l'endpoint de santé."""

    status: str
    service: str
    version: str


app = FastAPI(title="Indexa", version=version(SERVICE_NAME))


def require_internal_token(
    x_internal_token: Annotated[str | None, Header()] = None,
) -> None:
    """Routes internes réservées à l'application web (jeton partagé INDEXA_INTERNAL_TOKEN)."""
    expected = os.environ.get("INDEXA_INTERNAL_TOKEN")
    if not expected:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "INDEXA_INTERNAL_TOKEN manquant")
    if not x_internal_token or not hmac.compare_digest(x_internal_token, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "jeton interne invalide")


def get_queue() -> Queue:
    return Queue(QUEUE, connection=Redis.from_url(redis_url()))


def get_connection() -> Iterator[psycopg.Connection]:
    with psycopg.connect(database_url()) as conn:
        yield conn


Internal = Annotated[None, Depends(require_internal_token)]


@app.get("/health")
def health() -> HealthResponse:
    """Indique que le service répond."""
    return HealthResponse(status="ok", service=SERVICE_NAME, version=version(SERVICE_NAME))


@app.post(
    "/internal/v1/plagiarism",
    status_code=status.HTTP_202_ACCEPTED,
    response_model_exclude_none=True,
)
def submit(
    request: PlagiarismInput, _: Internal, queue: Annotated[Queue, Depends(get_queue)]
) -> PlagiarismTask:
    """Met une analyse en file et répond tout de suite avec l'identifiant (CLAUDE.md §4.9)."""
    if request.scope in (Scope.private, Scope.both) and not request.workspace_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "workspace_id requis pour la base privée"
        )
    task_id = enqueue_analysis(queue, request)
    return task_status(task_id, queue)


def task_status(task_id: str, queue: Queue) -> PlagiarismTask:
    try:
        job = Job.fetch(task_id, connection=queue.connection)
    except NoSuchJobError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tâche inconnue ou expirée") from error
    state = job.get_status()
    progress = float(job.meta.get("progress", 0))
    if state == JobStatus.FINISHED:
        result = PlagiarismOutput.model_validate(job.return_value())
        return PlagiarismTask(task_id=task_id, status=Status.done, progress=1, result=result)
    if state in (JobStatus.FAILED, JobStatus.STOPPED, JobStatus.CANCELED):
        return PlagiarismTask(
            task_id=task_id, status=Status.failed, progress=progress, error="ANALYSIS_FAILED"
        )
    running = state == JobStatus.STARTED
    return PlagiarismTask(
        task_id=task_id, status=Status.running if running else Status.queued, progress=progress
    )


@app.get("/internal/v1/plagiarism/tasks/{task_id}", response_model_exclude_none=True)
def get_task(
    task_id: str, _: Internal, queue: Annotated[Queue, Depends(get_queue)]
) -> PlagiarismTask:
    return task_status(task_id, queue)


@app.post("/internal/v1/private-sources", status_code=status.HTTP_201_CREATED)
def add_private_source(
    source: PrivateSourceInput,
    _: Internal,
    conn: Annotated[psycopg.Connection, Depends(get_connection)],
) -> PrivateSource:
    """Ajoute un document de référence à la base privée d'un espace."""
    return index_source(conn, source)


@app.delete("/internal/v1/private-sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_private_source(
    source_id: str,
    workspace_id: str,
    _: Internal,
    conn: Annotated[psycopg.Connection, Depends(get_connection)],
) -> Response:
    if not delete_source(conn, workspace_id, source_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "document introuvable")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
