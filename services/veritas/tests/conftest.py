"""Outils communs des tests de Veritas."""

from veritas.providers.base import RawDetection, ScoredSpan
from veritas.settings import Thresholds
from veritas.text import split_sentences

THRESHOLDS = Thresholds(
    min_words=150,
    likely_ai=0.70,
    likely_human=0.30,
    high_margin=0.35,
    medium_margin=0.20,
    min_words_for_high=300,
)

_PHRASES_FR = [
    "Les enseignants observent une progression nette des élèves au cours de l'année.",
    "Cette évolution tient surtout à la régularité des retours qu'ils reçoivent.",
    "Chaque semaine, un court bilan permet de corriger les méthodes de travail.",
    "Les familles disent mieux comprendre les attentes de l'école grâce à ces bilans.",
    "Il reste toutefois des écarts importants entre les établissements étudiés.",
]


def french_text(words: int = 320) -> str:
    """Texte français d'au moins `words` mots, en phrases complètes."""
    sentences: list[str] = []
    while sum(len(s.split()) for s in sentences) < words:
        sentences.append(_PHRASES_FR[len(sentences) % len(_PHRASES_FR)])
    return " ".join(sentences)


class FixedProvider:
    """Fournisseur simulé : même probabilité pour tout le texte, ou une erreur."""

    def __init__(self, name: str, probability: float, error: Exception | None = None) -> None:
        self.name = name
        self.probability = probability
        self.error = error
        self.calls = 0

    def detect(self, text: str, language: str) -> RawDetection:
        self.calls += 1
        if self.error is not None:
            raise self.error
        spans = tuple(ScoredSpan(s.start, s.end, self.probability) for s in split_sentences(text))
        return RawDetection(self.name, self.probability, spans)
