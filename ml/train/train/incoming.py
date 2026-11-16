"""Inspection d'un corpus déposé dans le volume Modal (`/corpus/incoming/`), sans recopier de texte.

Le rapport donne la forme du fichier (lignes, champs, longueurs, langue probable, années), les
doublons internes et les recoupements avec les corpus et les jeux de test déjà présents dans le
volume : empreinte exacte du texte normalisé, et part de suites de 8 mots communes avec un jeu
de test (copie partielle). Aucun texte, aucun extrait n'entre dans le rapport ; seules les
valeurs courtes des champs de description (source, licence, langue, date…) y figurent.
"""

import json
import re
import zlib
from collections import Counter
from collections.abc import Iterable, Iterator
from typing import Any

from corpus.clean import count_words, fingerprint

# Champs candidats pour le texte, dans l'ordre de préférence ; sinon la plus longue chaîne.
TEXT_KEYS = ("text", "texte", "content", "contenu", "body", "corps")
# Champs de description dont les valeurs courtes sont résumées (jamais le texte).
META_KEY = re.compile(r"source|licen[cs]e|lang|date|year|ann[ée]e|type|categor|label|origin|genre")
DATE_KEY = re.compile(r"date|year|ann[ée]e")
YEAR = re.compile(r"\b(1[5-9]\d\d|20\d\d)\b")
SHINGLE = 8
# Une suite de 8 mots sur quatre suffit à repérer une copie partielle.
SHINGLE_STRIDE = 4
PARTIAL_COPY = 0.2
TOP = 15
VALUE_MAX = 60

_WORD = re.compile(r"[^\W_]+(?:['’-][^\W_]+)*", re.UNICODE)
_FR = frozenset(
    (
        "le la les des une est dans pour que qui sur avec pas sont par ce cette nous vous aux du"
    ).split()
)
_EN = frozenset(
    "the and of to is in that for with are this was be by not from have which on as".split()
)


def pick_text(record: Any) -> tuple[str, str | None]:
    """(nom du champ, texte) d'un enregistrement : chaîne seule, ou objet JSON."""
    if isinstance(record, str):
        return "<ligne>", record
    if not isinstance(record, dict):
        return "<autre>", None
    for key in TEXT_KEYS:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return key, value
    strings = [(k, v) for k, v in record.items() if isinstance(v, str)]
    if not strings:
        return "<aucun>", None
    key, value = max(strings, key=lambda kv: len(kv[1]))
    return key, value


def language_of(text: str) -> str:
    """Langue probable par les mots grammaticaux les plus fréquents : fr, en ou autre."""
    words = [w.lower() for w in _WORD.findall(text[:5000])]
    if len(words) < 20:
        return "trop_court"
    fr = sum(w in _FR for w in words) / len(words)
    en = sum(w in _EN for w in words) / len(words)
    if max(fr, en) < 0.05:
        return "autre"
    return "fr" if fr >= en else "en"


def shingles(text: str, stride: int = 1) -> set[int]:
    """Suites de SHINGLE mots (normalisées), réduites à un entier de 32 bits."""
    words = [w.lower() for w in _WORD.findall(text)]
    return {
        zlib.crc32(" ".join(words[i : i + SHINGLE]).encode("utf-8"))
        for i in range(0, max(len(words) - SHINGLE + 1, 0), stride)
    }


def _length_bucket(words: int) -> str:
    if words < 150:
        return "<150"
    if words < 180:
        return "150-179"
    if words <= 900:
        return "180-900"
    if words <= 5000:
        return "901-5000"
    return ">5000"


def _percentiles(values: list[int]) -> dict[str, int]:
    if not values:
        return {}
    ordered = sorted(values)
    pick = lambda q: ordered[min(int(q * len(ordered)), len(ordered) - 1)]  # noqa: E731
    return {
        "min": ordered[0],
        "p10": pick(0.1),
        "p50": pick(0.5),
        "p90": pick(0.9),
        "max": ordered[-1],
    }


def parse_lines(lines: Iterable[bytes | str]) -> Iterator[tuple[Any, bool]]:
    """(enregistrement, lisible) par ligne non vide : JSON si possible, sinon texte brut."""
    for line in lines:
        raw = line.decode("utf-8", errors="replace") if isinstance(line, bytes) else line
        raw = raw.strip()
        if not raw:
            continue
        try:
            yield json.loads(raw), True
        except json.JSONDecodeError:
            yield raw, False


def inspect(
    records: Iterable[tuple[Any, bool]],
    known: dict[str, set[str]],
    test_shingles: set[int],
) -> dict[str, Any]:
    """Rapport sans texte. known : empreintes (fingerprint) par corpus ou jeu de test existant ;
    test_shingles : suites de mots des jeux de test."""
    keys: Counter[str] = Counter()
    text_fields: Counter[str] = Counter()
    languages: Counter[str] = Counter()
    lengths: Counter[str] = Counter()
    years: Counter[str] = Counter()
    meta: dict[str, Counter[str]] = {}
    overlaps: Counter[str] = Counter()
    seen: set[str] = set()
    words_list: list[int] = []
    lines = json_lines = empty = duplicates = partial = 0
    for record, is_json in records:
        lines += 1
        json_lines += is_json
        if isinstance(record, dict):
            keys.update(record.keys())
            for key, value in record.items():
                if not META_KEY.search(key.lower()) or isinstance(value, (dict, list)):
                    continue
                if isinstance(value, str) and len(value) > 200:
                    continue
                meta.setdefault(key, Counter())[str(value)[:VALUE_MAX]] += 1
                if DATE_KEY.search(key.lower()):
                    match = YEAR.search(str(value))
                    years[match.group(1) if match else "illisible"] += 1
        field, text = pick_text(record)
        text_fields[field] += 1
        if not text or not text.strip():
            empty += 1
            continue
        words = count_words(text)
        words_list.append(words)
        lengths[_length_bucket(words)] += 1
        languages[language_of(text)] += 1
        digest = fingerprint(text)
        if digest in seen:
            duplicates += 1
        seen.add(digest)
        for name, digests in known.items():
            if digest in digests:
                overlaps[name] += 1
        sample = shingles(text, SHINGLE_STRIDE)
        if sample and len(sample & test_shingles) / len(sample) >= PARTIAL_COPY:
            partial += 1
    return {
        "lines": lines,
        "json_lines": json_lines,
        "empty_texts": empty,
        "texts": len(words_list),
        "keys": dict(keys.most_common(30)),
        "text_field": dict(text_fields.most_common()),
        "words": {"total": sum(words_list), **_percentiles(words_list)},
        "length_buckets": dict(lengths),
        "languages": dict(languages.most_common()),
        "years": dict(sorted(years.items())),
        "metadata": {k: dict(c.most_common(TOP)) for k, c in sorted(meta.items())},
        "duplicates_in_file": duplicates,
        "exact_overlap": dict(overlaps),
        "partial_copy_of_testsets": partial,
        "partial_copy_rule": {
            "shingle_words": SHINGLE,
            "stride": SHINGLE_STRIDE,
            "min_share": PARTIAL_COPY,
        },
    }
