"""Interface unique des moteurs de détection (CLAUDE.md §4.3).

Chaque fournisseur externe, comme Veritas lui-même, rend un RawDetection : la probabilité du
document, des passages notés (positions dans le texte) et, s'il en donne, des parts du texte.
veritas.scoring le transforme ensuite en sortie du contrat, avec les mêmes seuils pour tous.
"""

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True, slots=True)
class ScoredSpan:
    """Passage noté : positions en caractères (fin exclue), probabilité IA de 0 à 1."""

    start: int
    end: int
    probability: float


@dataclass(frozen=True, slots=True)
class Fractions:
    """Parts du texte données par le fournisseur. « assisted » (texte retouché par une IA)
    alimente la part « undetermined » du contrat (ADR-0001)."""

    ai: float
    assisted: float
    human: float


@dataclass(frozen=True, slots=True)
class RawDetection:
    engine: str
    probability: float
    spans: tuple[ScoredSpan, ...] = field(default_factory=tuple)
    fractions: Fractions | None = None
    probable_model: str | None = None


class ProviderError(RuntimeError):
    """Le fournisseur n'a pas pu répondre (réseau, quota, réponse inattendue)."""


class ProviderNotConfiguredError(ProviderError):
    """Le fournisseur est demandé mais sa clé manque."""


class DetectionProvider(Protocol):
    """Fournisseur de détection. `name` est la valeur de DETECTION_PROVIDER."""

    name: str

    def detect(self, text: str, language: str) -> RawDetection: ...


def clamp(value: float) -> float:
    return min(1.0, max(0.0, float(value)))
