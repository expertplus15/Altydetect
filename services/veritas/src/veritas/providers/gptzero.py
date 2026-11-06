"""GPTZero, API v2 (non retenu en l'état par ADR-0001, disponible pour le benchmark).

POST https://api.gptzero.me/v2/predict/text, clé dans l'en-tête x-api-key, corps
{"document": …, "multilingual": true}. Réponse utilisée : documents[0].class_probabilities.ai
(sinon completely_generated_prob) et sentences[] (sentence, generated_prob), replacées dans le
texte par recherche successive.
"""

from typing import Any

import httpx2

from veritas.providers.base import ProviderError, RawDetection, ScoredSpan, clamp


class GPTZeroProvider:
    name = "gptzero"
    ENDPOINT = "https://api.gptzero.me/v2/predict/text"

    def __init__(self, api_key: str, client: httpx2.Client | None = None) -> None:
        self._key = api_key
        self._client = client or httpx2.Client(timeout=30.0)

    def detect(self, text: str, language: str) -> RawDetection:
        try:
            response = self._client.post(
                self.ENDPOINT,
                json={"document": text, "multilingual": True},
                headers={"x-api-key": self._key},
            )
            response.raise_for_status()
            document: dict[str, Any] = response.json()["documents"][0]
            classes = document.get("class_probabilities") or {}
            probability = clamp(classes.get("ai", document["completely_generated_prob"]))
            spans: list[ScoredSpan] = []
            cursor = 0
            for sentence in document.get("sentences", []):
                fragment = str(sentence.get("sentence", "")).strip()
                start = text.find(fragment, cursor) if fragment else -1
                if start < 0:
                    continue
                cursor = start + len(fragment)
                spans.append(ScoredSpan(start, cursor, clamp(sentence["generated_prob"])))
        except (httpx2.HTTPError, KeyError, IndexError, TypeError, ValueError) as error:
            raise ProviderError(f"gptzero : {type(error).__name__}") from error
        return RawDetection(self.name, probability, tuple(spans))
