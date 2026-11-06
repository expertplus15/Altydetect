"""Mode fantôme (ADR-0008) : quand le fournisseur externe répond seul, Veritas tourne en
arrière-plan sur le même texte et la comparaison est enregistrée.

Comme pour Indexa, le texte n'est pas un argument du job (RQ conserve les arguments) : il est
déposé dans une clé Redis à durée limitée, que le worker lit et supprime en une opération.
Lancement du worker : rq worker veritas-shadow --url $REDIS_URL
"""

import logging
import secrets
from dataclasses import asdict, dataclass
from typing import Any, Protocol

from redis import Redis
from rq import Queue

from veritas.comparisons import Comparison, PostgresComparisonStore
from veritas.engine.model import VeritasModels
from veritas.scoring import score
from veritas.settings import database_url, redis_url, thresholds_config

QUEUE = "veritas-shadow"
TEXT_TTL_SECONDS = 3600

log = logging.getLogger("veritas.shadow")


@dataclass(frozen=True, slots=True)
class ShadowJob:
    """Avis externe déjà rendu, à comparer à celui de Veritas."""

    segment: str
    language: str
    plan: str
    external_engine: str
    external_probability: float
    external_band: str


class ShadowQueue(Protocol):
    def submit(self, text: str, job: ShadowJob) -> None: ...


def text_key(job_id: str) -> str:
    return f"veritas:shadow:{job_id}"


class RqShadowQueue:
    def __init__(self, connection: Redis | None = None) -> None:
        self._connection = connection or Redis.from_url(redis_url())

    def submit(self, text: str, job: ShadowJob) -> None:
        job_id = f"shd_{secrets.token_urlsafe(12)}"
        self._connection.set(text_key(job_id), text.encode("utf-8"), ex=TEXT_TTL_SECONDS)
        Queue(QUEUE, connection=self._connection).enqueue(
            run_shadow,
            job_id,
            asdict(job),
            job_id=job_id,
            result_ttl=0,
            failure_ttl=TEXT_TTL_SECONDS,
            job_timeout=120,
        )


_models: VeritasModels | None = None


def run_shadow(job_id: str, job: dict[str, Any]) -> None:
    """Tâche du worker : avis de Veritas, puis comparaison enregistrée (sans le texte)."""
    global _models  # modèles chargés une fois par worker
    connection = Redis.from_url(redis_url())
    raw_text = connection.getdel(text_key(job_id))
    if raw_text is None:
        return
    text = bytes(raw_text).decode("utf-8")  # type: ignore[arg-type]
    shadow = ShadowJob(**job)
    url = database_url()
    if url is None:
        log.warning("DATABASE_URL manquante : comparaison non enregistrée")
        return
    _models = _models or VeritasModels.load()
    if not _models.available(shadow.language):
        return
    veritas = score(
        _models.detect(text, shadow.language), text, shadow.language, thresholds_config().get()
    )
    PostgresComparisonStore(url).record(
        Comparison(
            source="shadow",
            segment=shadow.segment,
            language=shadow.language,
            plan=shadow.plan,
            word_count=veritas.output.word_count,
            external_engine=shadow.external_engine,
            external_probability=shadow.external_probability,
            external_band=shadow.external_band,
            veritas_engine=veritas.output.engine.primary,
            veritas_probability=round(veritas.probability, 4),
            veritas_band=veritas.output.verdict_band.value,
            agreement=round(1 - abs(shadow.external_probability - veritas.probability), 4),
            concordant=shadow.external_band == veritas.output.verdict_band.value,
        )
    )
