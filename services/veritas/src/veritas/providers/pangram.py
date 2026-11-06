"""Pangram, API v3 (fournisseur principal proposé par ADR-0001).

POST https://text.api.pangram.com/v3, clé dans l'en-tête x-api-key, corps {"text": …}.
Réponse utilisée : fraction_ai, fraction_ai_assisted, fraction_human et windows (passages avec
ai_assistance_score et positions start_index / end_index en caractères).
"""

from typing import Any

import httpx2

from veritas.providers.base import Fractions, ProviderError, RawDetection, ScoredSpan, clamp


class PangramProvider:
    name = "pangram"
    ENDPOINT = "https://text.api.pangram.com/v3"

    def __init__(self, api_key: str, client: httpx2.Client | None = None) -> None:
        self._key = api_key
        self._client = client or httpx2.Client(timeout=30.0)

    def detect(self, text: str, language: str) -> RawDetection:
        try:
            response = self._client.post(
                self.ENDPOINT, json={"text": text}, headers={"x-api-key": self._key}
            )
            response.raise_for_status()
            body: dict[str, Any] = response.json()
            fractions = Fractions(
                ai=clamp(body["fraction_ai"]),
                assisted=clamp(body.get("fraction_ai_assisted", 0.0)),
                human=clamp(body["fraction_human"]),
            )
            spans = tuple(
                ScoredSpan(
                    start=int(w["start_index"]),
                    end=int(w["end_index"]),
                    probability=clamp(w["ai_assistance_score"]),
                )
                for w in body.get("windows", [])
                if isinstance(w, dict) and "ai_assistance_score" in w
            )
        except (httpx2.HTTPError, KeyError, TypeError, ValueError) as error:
            raise ProviderError(f"pangram : {type(error).__name__}") from error
        # Probabilité du document : le texte retouché par une IA compte pour moitié.
        probability = clamp(fractions.ai + 0.5 * fractions.assisted)
        return RawDetection(self.name, probability, spans, fractions)
