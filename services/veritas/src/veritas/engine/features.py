"""Couche 1 de Veritas : traits statistiques du texte, calculés sur CPU (ADR-0008).

Les mêmes fonctions servent à l'entraînement (ml/train) et à l'inférence : un trait ajouté ici
change le format du paquet de modèle.
"""

import itertools
import math
import re
from collections import Counter

from veritas.text import words

FEATURES: tuple[str, ...] = (
    "mean_sentence_words",
    "sentence_length_cv",
    "type_token_ratio",
    "mean_word_length",
    "comma_rate",
    "semicolon_colon_rate",
    "question_exclamation_rate",
    "function_word_ratio",
    "repeated_bigram_ratio",
)

FUNCTION_WORDS: dict[str, frozenset[str]] = {
    "fr": frozenset(
        "le la les un une des du de et est que qui dans pour pas sur avec au aux ce cette ces "
        "son sa ses leur nous vous ils elles mais ou donc ne plus être été très aussi comme en "
        "il elle on se sont par je tu".split()
    ),
    "en": frozenset(
        "the a an and is are was were that which who in for not on with to of this these those "
        "its their we you they but or so be been very also as it from by have has he she i "
        "at".split()
    ),
}

_TTR_WINDOW = 50


def _ttr(tokens: list[str]) -> float:
    """Richesse du vocabulaire, moyenne sur fenêtres glissantes (indépendante de la longueur)."""
    if not tokens:
        return 0.0
    if len(tokens) <= _TTR_WINDOW:
        return len(set(tokens)) / len(tokens)
    ratios = [
        len(set(tokens[i : i + _TTR_WINDOW])) / _TTR_WINDOW
        for i in range(0, len(tokens) - _TTR_WINDOW + 1, 10)
    ]
    return sum(ratios) / len(ratios)


def extract(sentences: list[str], language: str) -> list[float]:
    """Vecteur de traits (ordre de FEATURES) d'un passage découpé en phrases."""
    text = " ".join(sentences)
    tokens = [w.lower() for w in words(text)]
    n = max(len(tokens), 1)
    lengths = [len(words(s)) for s in sentences if s.strip()] or [0]
    mean_len = sum(lengths) / len(lengths)
    variance = sum((x - mean_len) ** 2 for x in lengths) / len(lengths)
    function = FUNCTION_WORDS.get(language, FUNCTION_WORDS["en"])
    bigrams = Counter(itertools.pairwise(tokens))
    repeated = sum(c for c in bigrams.values() if c > 1)
    return [
        mean_len,
        math.sqrt(variance) / mean_len if mean_len else 0.0,
        _ttr(tokens),
        sum(len(t) for t in tokens) / n,
        text.count(",") / n,
        len(re.findall(r"[;:]", text)) / n,
        len(re.findall(r"[?!]", text)) / n,
        sum(t in function for t in tokens) / n,
        repeated / max(len(tokens) - 1, 1),
    ]
