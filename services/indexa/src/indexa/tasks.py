"""Tâches d'analyse (file RQ « indexa ») : le texte transite par Redis et n'est jamais stocké.

Le texte n'est pas un argument du job (RQ conserve les arguments) : il est déposé dans une clé
Redis à durée de vie limitée, que le worker lit et supprime en une seule opération.
"""

import secrets
from typing import Any

import psycopg
from redis import Redis
from rq import Queue, get_current_job

from indexa.config import database_url, redis_url
from indexa.contracts import PlagiarismInput, Scope
from indexa.engine import EngineDeps, analyze
from indexa.web.fetch import FixturePageFetcher, HttpPageFetcher, PageFetcher
from indexa.web.search import FixtureSearchProvider, SearchProvider, provider_from_env

QUEUE = "indexa"
TEXT_TTL_SECONDS = 3600
RESULT_TTL_SECONDS = 3600


def text_key(task_id: str) -> str:
    return f"indexa:text:{task_id}"


def new_task_id() -> str:
    return f"plg_{secrets.token_urlsafe(16)}"


def enqueue_analysis(queue: Queue, request: PlagiarismInput) -> str:
    """Dépose le texte (durée limitée) puis met l'analyse en file ; renvoie l'identifiant."""
    task_id = new_task_id()
    connection: Redis = queue.connection
    connection.set(text_key(task_id), request.text.encode("utf-8"), ex=TEXT_TTL_SECONDS)
    queue.enqueue(
        run_analysis,
        task_id,
        request.scope.value,
        request.workspace_id,
        job_id=task_id,
        result_ttl=RESULT_TTL_SECONDS,
        failure_ttl=RESULT_TTL_SECONDS,
        job_timeout=300,
    )
    return task_id


def default_deps(scope: Scope) -> EngineDeps:
    search: SearchProvider | None = None
    fetcher: PageFetcher | None = None
    if scope in (Scope.web, Scope.both):
        search = provider_from_env()
        fetcher = (
            FixturePageFetcher(search)
            if isinstance(search, FixtureSearchProvider)
            else HttpPageFetcher()
        )
    return EngineDeps(
        connect=lambda: psycopg.connect(database_url()), search=search, fetcher=fetcher
    )


def run_analysis(task_id: str, scope: str, workspace_id: str | None) -> dict[str, Any]:
    """Exécutée par le worker RQ : lit et supprime le texte, analyse, renvoie le résultat."""
    job = get_current_job()
    connection = job.connection if job else Redis.from_url(redis_url())
    raw = connection.getdel(text_key(task_id))
    if raw is None:
        raise RuntimeError("Texte expiré ou déjà traité.")
    text = raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)
    request = PlagiarismInput(text=text, scope=Scope(scope), workspace_id=workspace_id)

    def progress(value: float) -> None:
        if job is not None:
            job.meta["progress"] = round(value, 3)
            job.save_meta()  # type: ignore[no-untyped-call]

    output = analyze(request, default_deps(request.scope), progress)
    return output.model_dump(mode="json", exclude_none=True)
