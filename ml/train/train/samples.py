"""Passages d'entraînement : le document entier et des fenêtres de quelques phrases, pour
coller à l'inférence (Veritas note chaque phrase avec ses voisines, puis le document)."""

import random
from typing import Any

from veritas.text import split_sentences

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
