"""Empreintes de passages : n-grammes de mots hachés, sélection par winnowing."""

from collections.abc import Sequence
from hashlib import blake2b

from indexa.text import Token

# Taille des n-grammes de mots : 5 mots, assez long pour être distinctif, assez court pour
# retrouver un passage retouché.
K = 5
# Fenêtre du winnowing : garantit de retenir au moins une empreinte par passage commun de
# K + WINDOW - 1 mots.
WINDOW = 4


def shingle_hash(words: Sequence[str]) -> int:
    """Empreinte signée sur 64 bits (type bigint de PostgreSQL)."""
    digest = blake2b(" ".join(words).encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big", signed=True)


def shingles(tokens: Sequence[Token], k: int = K) -> list[int]:
    """Empreinte de chaque suite de k mots ; l'indice i correspond aux mots [i, i + k)."""
    norms = [t.norm for t in tokens]
    return [shingle_hash(norms[i : i + k]) for i in range(len(norms) - k + 1)]


def winnow(hashes: Sequence[int], window: int = WINDOW) -> list[tuple[int, int]]:
    """Empreintes retenues (empreinte, position) : le minimum de chaque fenêtre glissante."""
    if not hashes:
        return []
    if len(hashes) <= window:
        position = min(range(len(hashes)), key=lambda i: (hashes[i], -i))
        return [(hashes[position], position)]
    selected: list[tuple[int, int]] = []
    last = -1
    for start in range(len(hashes) - window + 1):
        # Minimum le plus à droite de la fenêtre (règle du winnowing).
        position = min(range(start, start + window), key=lambda i: (hashes[i], -i))
        if position != last:
            selected.append((hashes[position], position))
            last = position
    return selected
