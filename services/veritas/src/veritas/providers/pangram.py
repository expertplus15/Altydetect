"""Pangram, API d'inférence asynchrone (fournisseur principal proposé par ADR-0001).

L'ancien point d'entrée synchrone POST /v3 est déprécié (docs.pangram.com, novembre 2026).
Flux actuel, sur https://text.external-api.pangram.com, clé dans l'en-tête x-api-key :
1. POST /task {"text", "model"} → {"task_id"} ;
2. GET /task/{task_id} jusqu'à l'étape STAGE_SUCCESS ou STAGE_FAILED.

Réponse utilisée : fraction_ai, fraction_ai_assisted, fraction_human et windows (passages avec
ai_assistance_score et positions start_index / end_index en caractères). Les positions portent
sur le texte renvoyé par Pangram, qui peut être normalisé : si ce texte diffère du texte envoyé,
les passages sont ignorés (les phrases prennent alors la probabilité du document).

GET /balance, /usage et /limits ne consomment ni crédit ni quota (vérification de la clé).
"""

import time
from collections.abc import Callable
from typing import Any

import httpx2

from veritas.providers.base import Fractions, ProviderError, RawDetection, ScoredSpan, clamp

# Sélecteur explicite, comme le recommande la documentation ; la version mineure servie (4.0,
# 4.1…) peut changer sans changer le sélecteur. Modifiable par PANGRAM_MODEL.
DEFAULT_MODEL = "pangram-4"


class PangramProvider:
    name = "pangram"
    BASE_URL = "https://text.external-api.pangram.com"

    def __init__(
        self,
        api_key: str,
        client: httpx2.Client | None = None,
        model: str = DEFAULT_MODEL,
        poll_interval: float = 0.5,
        deadline: float = 45.0,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._key = api_key
        self._client = client or httpx2.Client(timeout=30.0)
        self._model = model
        self._poll_interval = poll_interval
        # Le client web attend 60 s : la réponse doit arriver avant.
        self._deadline = deadline
        self._sleep = sleep
        self._clock = clock

    def _call(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        response = self._client.request(
            method, f"{self.BASE_URL}{path}", headers={"x-api-key": self._key}, **kwargs
        )
        if response.status_code >= 400:
            # Code HTTP seul : jamais le corps (il peut reprendre le texte envoyé).
            raise ProviderError(f"pangram : HTTP {response.status_code} sur {method} {path}")
        body: dict[str, Any] = response.json()
        return body

    def _result(self, text: str) -> dict[str, Any]:
        task_id = self._call("POST", "/task", json={"text": text, "model": self._model})["task_id"]
        started = self._clock()
        while True:
            body = self._call("GET", f"/task/{task_id}")
            stage = body.get("stage")
            if stage == "STAGE_SUCCESS":
                return body
            if stage == "STAGE_FAILED":
                raise ProviderError("pangram : tâche en échec (STAGE_FAILED)")
            if self._clock() - started > self._deadline:
                raise ProviderError(f"pangram : pas de résultat après {self._deadline:.0f} s")
            self._sleep(self._poll_interval)

    def detect(self, text: str, language: str) -> RawDetection:
        try:
            body = self._result(text)
            fractions = Fractions(
                ai=clamp(body["fraction_ai"]),
                assisted=clamp(body.get("fraction_ai_assisted", 0.0)),
                human=clamp(body["fraction_human"]),
            )
            same_text = body.get("text", text) == text
            spans = tuple(
                ScoredSpan(
                    start=int(w["start_index"]),
                    end=int(w["end_index"]),
                    probability=clamp(w["ai_assistance_score"]),
                )
                for w in (body.get("windows", []) if same_text else [])
                if isinstance(w, dict) and "ai_assistance_score" in w
            )
        except ProviderError:
            raise
        except (httpx2.HTTPError, KeyError, TypeError, ValueError) as error:
            raise ProviderError(f"pangram : {type(error).__name__}") from error
        # Probabilité du document : le texte retouché par une IA compte pour moitié.
        probability = clamp(fractions.ai + 0.5 * fractions.assisted)
        return RawDetection(self.name, probability, spans, fractions)
