"""Choix des requêtes : les phrases les plus distinctives du texte, en citation exacte."""

import re

from indexa.text import tokenize

_SENTENCE = re.compile(r"[^.!?…\n]+[.!?…]?")
# Mots outils exclus du calcul de rareté.
_STOP = frozenset(
    (
        "le la les un une des du de et est que qui dans pour pas sur avec au aux ce cette ces "
        "son sa ses the a an and is are was were that which in for not on with to of this it "
        "as by be"
    ).split()
)
QUERY_WORDS = 12


def select_queries(text: str, max_queries: int) -> list[str]:
    """Jusqu'à max_queries extraits de QUERY_WORDS mots, pris dans les phrases les plus riches."""
    candidates: list[tuple[float, int, str]] = []
    for index, match in enumerate(_SENTENCE.finditer(text)):
        tokens = tokenize(match.group())
        if len(tokens) < QUERY_WORDS:
            continue
        content = [t.norm for t in tokens if t.norm not in _STOP]
        # Phrases longues, riches en mots pleins et en mots longs.
        score = len(set(content)) + sum(len(w) >= 8 for w in content)
        middle = max(0, (len(tokens) - QUERY_WORDS) // 2)
        window = tokens[middle : middle + QUERY_WORDS]
        excerpt = match.group()[window[0].start : window[-1].end]
        candidates.append((score, index, excerpt))
    best = sorted(candidates, key=lambda c: (-c[0], c[1]))[:max_queries]
    # Ordre du texte, entre guillemets pour une recherche exacte.
    return [f'"{excerpt}"' for _, _, excerpt in sorted(best, key=lambda c: c[1])]
