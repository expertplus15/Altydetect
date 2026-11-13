"""Passages d'entraînement : le document entier et des fenêtres de quelques phrases, pour
coller à l'inférence (Veritas note chaque phrase avec ses voisines, puis le document)."""

import random
from typing import Any

from veritas.text import Sentence, split_sentences

MIN_WINDOW_WORDS = 25


def sentences_of(text: str) -> list[str]:
    return [text[s.start : s.end] for s in split_sentences(text)]


def passages(document: dict[str, Any], rng: random.Random, windows: int = 2) -> list[list[str]]:
    """Le document (liste de phrases) suivi de `windows` fenêtres de 1 à 4 phrases."""
    sentences = sentences_of(str(document["text"]))
    out = [sentences]
    for _ in range(windows):
        if len(sentences) < 2:
            break
        size = rng.randint(1, min(4, len(sentences)))
        start = rng.randrange(0, len(sentences) - size + 1)
        window = sentences[start : start + size]
        if sum(len(s.split()) for s in window) >= MIN_WINDOW_WORDS:
            out.append(window)
    return out


def label_of(document: dict[str, Any]) -> int:
    return 1 if document["label"] == "ai" else 0


def _windows(sentences: list[str], rng: random.Random, count: int) -> list[list[str]]:
    out: list[list[str]] = []
    for _ in range(count):
        if not sentences:
            break
        size = rng.randint(1, min(4, len(sentences)))
        start = rng.randrange(0, len(sentences) - size + 1)
        window = sentences[start : start + size]
        if sum(len(s.split()) for s in window) >= MIN_WINDOW_WORDS:
            out.append(window)
    return out


def labelled_passages(
    document: dict[str, Any], rng: random.Random, windows: int = 2
) -> list[tuple[list[str], int]]:
    """Passages étiquetés. Texte humain ou généré : le document et ses fenêtres, avec son
    étiquette. Texte mixte (Veritas 0.2) : pas de passage du document entier (ni humain ni
    généré), des fenêtres prises d'un seul côté de `ai_starts_at`, étiquetées par leur côté."""
    if document["label"] != "mixed":
        label = label_of(document)
        return [(p, label) for p in passages(document, rng, windows)]
    text = str(document["text"])
    boundary = int(document["ai_starts_at"])
    spans: list[Sentence] = split_sentences(text)
    human = [text[s.start : s.end] for s in spans if s.end <= boundary]
    ai = [text[s.start : s.end] for s in spans if s.start >= boundary]
    return [(w, 0) for w in _windows(human, rng, windows)] + [
        (w, 1) for w in _windows(ai, rng, windows)
    ]
