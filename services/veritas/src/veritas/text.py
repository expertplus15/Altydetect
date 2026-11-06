"""Outils de texte de Veritas : mots, phrases avec leurs positions, langue.

Le texte n'est jamais conservé : ces fonctions travaillent en mémoire.
"""

import re
from dataclasses import dataclass

_WORD = re.compile(r"[^\W_]+(?:['’-][^\W_]+)*", re.UNICODE)
# Fin de phrase : ponctuation finale, puis guillemets ou parenthèses fermants (éventuellement
# précédés d'une espace, à la française), puis espace ; ou une ligne vide (titres, listes).
# Le groupe 1 se termine à la fin de la phrase, guillemets fermants compris.
_SENTENCE_END = re.compile(r"([.!?…](?:[ \u00a0\u202f]?[»”\")\]])*)\s+|()\n\s*\n")

_FR = frozenset(
    "le la les un une des du de et est que qui dans pour pas sur avec au aux ce cette ces son "
    "sa ses leur nous vous ils elles mais ou donc ne plus être été très aussi comme".split()
)
_EN = frozenset(
    "the a an and is are was were that which who in for not on with to of this these those its "
    "their we you they but or so be been very also as it from by have has".split()
)


@dataclass(frozen=True, slots=True)
class Sentence:
    start: int
    end: int
    words: int


def words(text: str) -> list[str]:
    return _WORD.findall(text)


def count_words(text: str) -> int:
    return len(_WORD.findall(text))


def split_sentences(text: str) -> list[Sentence]:
    """Phrases du texte, avec leurs positions (caractères, fin exclue), sans espaces autour."""
    sentences: list[Sentence] = []
    cursor = 0
    for match in _SENTENCE_END.finditer(text):
        end = match.end(1) if match.group(1) is not None else match.start()
        _append(sentences, text, cursor, end)
        cursor = match.end()
    _append(sentences, text, cursor, len(text))
    return sentences


def _append(sentences: list[Sentence], text: str, start: int, end: int) -> None:
    chunk = text[start:end]
    stripped = chunk.strip()
    if not stripped:
        return
    offset = start + (len(chunk) - len(chunk.lstrip()))
    n = count_words(stripped)
    if n == 0:
        return
    sentences.append(Sentence(offset, offset + len(stripped), n))


def detect_language(text: str) -> str:
    """« fr » ou « en » d'après les mots outils, comme @altydetect/core."""
    fr = en = 0
    for raw in words(text.lower()):
        word = re.sub(r"^[a-z]['’]", "", raw)
        fr += word in _FR
        en += word in _EN
    if re.search(r"[éèêàùçœ]", text):
        fr += 2
    return "en" if en > fr else "fr"
