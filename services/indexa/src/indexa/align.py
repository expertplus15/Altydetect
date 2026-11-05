"""Alignement des passages communs entre le texte analysé et une source."""

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass

from indexa.fingerprint import K, shingles
from indexa.text import Token

# Écart toléré (en mots) entre deux morceaux d'un même passage retouché.
MAX_GAP = 6
# Longueur minimale d'un passage retenu, en mots.
MIN_TOKENS = 8


@dataclass(frozen=True, slots=True)
class Span:
    """Passage commun : mots [q_start, q_end) du texte, [s_start, s_end) de la source."""

    q_start: int
    q_end: int
    s_start: int
    s_end: int
    score: float


def _runs(query: Sequence[int], source_index: dict[int, list[int]]) -> list[list[int]]:
    """Suites de n-grammes communs sur une même diagonale : [q_debut, q_fin, s_debut, s_fin)."""
    by_diagonal: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for i, h in enumerate(query):
        for j in source_index.get(h, ()):
            by_diagonal[j - i].append((i, j))
    runs: list[list[int]] = []
    for seeds in by_diagonal.values():
        seeds.sort()
        current: list[int] | None = None
        for i, j in seeds:
            if current is not None and i <= current[1] - K + 1:
                current[1], current[3] = i + K, j + K
            else:
                current = [i, i + K, j, j + K]
                runs.append(current)
    return runs


def align(query_tokens: Sequence[Token], source_tokens: Sequence[Token]) -> list[Span]:
    """Passages du texte retrouvés dans la source, fusionnés malgré de petites retouches."""
    query = shingles(query_tokens)
    source = shingles(source_tokens)
    if not query or not source:
        return []
    index: dict[int, list[int]] = defaultdict(list)
    for j, h in enumerate(source):
        index[h].append(j)

    runs = sorted(_runs(query, index), key=lambda r: (r[0], r[2]))
    merged: list[tuple[list[int], int]] = []  # (passage, mots couverts exactement)
    for run in runs:
        if merged:
            span, covered = merged[-1]
            q_gap, s_gap = run[0] - span[1], run[2] - span[3]
            if -K < q_gap <= MAX_GAP and -K < s_gap <= MAX_GAP:
                covered += run[1] - max(run[0], span[1])
                span[1], span[3] = max(span[1], run[1]), max(span[3], run[3])
                merged[-1] = (span, covered)
                continue
        merged.append((run, run[1] - run[0]))

    spans: list[Span] = []
    for (q_start, q_end, s_start, s_end), covered in merged:
        length = q_end - q_start
        if length >= MIN_TOKENS:
            score = min(1.0, covered / length)
            spans.append(Span(q_start, q_end, s_start, s_end, round(score, 3)))
    return spans


def coverage(spans: Sequence[Span], total_tokens: int) -> float:
    """Part des mots du texte couverts par au moins un passage."""
    if total_tokens == 0:
        return 0.0
    covered: set[int] = set()
    for span in spans:
        covered.update(range(span.q_start, span.q_end))
    return round(len(covered) / total_tokens, 4)
