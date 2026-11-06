"""Fournisseur simulé, déterministe : développement local et tests de bout en bout.

Chaque phrase reçoit une probabilité tirée de son empreinte. Aucune valeur de détection : il est
refusé tant que VERITAS_ALLOW_SIMULATED n'est pas « 1 », et interdit en production.
"""

import hashlib

from veritas.providers.base import RawDetection, ScoredSpan
from veritas.text import split_sentences


class SimulatedProvider:
    name = "simulated"

    def __init__(self, bias: float = 0.0) -> None:
        self._bias = bias

    def detect(self, text: str, language: str) -> RawDetection:
        spans: list[ScoredSpan] = []
        weighted = total = 0.0
        for sentence in split_sentences(text):
            digest = hashlib.blake2b(text[sentence.start : sentence.end].encode(), digest_size=2)
            p = min(1.0, max(0.0, int.from_bytes(digest.digest()) / 0xFFFF + self._bias))
            spans.append(ScoredSpan(sentence.start, sentence.end, p))
            weighted += p * sentence.words
            total += sentence.words
        return RawDetection(self.name, weighted / total if total else 0.5, tuple(spans))
