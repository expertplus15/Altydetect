"""Découpage du texte en mots normalisés, avec leurs positions dans le texte d'origine."""

import re
import unicodedata
from dataclasses import dataclass

_WORD = re.compile(r"[^\W_]+(?:['’][^\W_]+)*", re.UNICODE)
_LIGATURES = str.maketrans({"œ": "oe", "Œ": "oe", "æ": "ae", "Æ": "ae", "’": "'"})


@dataclass(frozen=True, slots=True)
class Token:
    """Un mot : forme normalisée et position [start, end) dans le texte d'origine."""

    norm: str
    start: int
    end: int


def normalize_word(word: str) -> str:
    """Minuscules, sans accents ni ligatures : « Élève » et « eleve » se correspondent."""
    decomposed = unicodedata.normalize("NFKD", word.translate(_LIGATURES).casefold())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def tokenize(text: str) -> list[Token]:
    """Mots du texte (les apostrophes internes restent dans le mot : « l'élève »)."""
    return [Token(normalize_word(m.group()), m.start(), m.end()) for m in _WORD.finditer(text)]
