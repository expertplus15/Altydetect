"""Corpus de Veritas FR 0.5 (ADR-0014) : textes humains « difficiles » pour FR 0.4.

Trois sources de textes humains nouveaux, hors de tout document du corpus 0.4 et des jeux de
test :
- pages universitaires de French Science Commons, sur douze fichiers jamais lus (mêmes licences
  et même date limite qu'en 0.3) ;
- pages web mC4 du fragment 2 (avril 2019, jamais utilisé : 0 pour l'entraînement, 1 pour le
  jeu de test detection-v1) ;
- le corpus déposé par l'utilisateur dans le volume (`incoming/`), déclaré libre de droits,
  écrit par des humains, aux dates mêlées : seuls les textes datés d'avant la date limite sont
  gardés, découpés en passages de 180 à 900 mots.

FR 0.4 note chaque candidat ; on garde en priorité ceux qu'il classe à tort vers « IA »
(probabilité ≥ HARD_MIN), puis des candidats ordinaires, tirés de façon stable. Chaque texte
humain retenu reçoit un texte généré apparié (mêmes générateurs ouverts qu'en 0.2, Phi tenu à
l'écart), comme en 0.3 et 0.4.
"""

import re
from collections import Counter
from collections.abc import Iterable, Sequence
from typing import Any

from corpus.clean import MAX_WORDS, MIN_WORDS, count_words
from corpus.manifest import assign_split

from train.corpus_v2 import choose
from train.corpus_v3 import CUTOFF, human_document, in_period
from train.incoming import DATE_KEY, language_of, pick_text

FSC_FILES_V5 = tuple(
    f"french_open_science_{n:03d}.parquet" for n in (3, 5, 11, 13, 19, 21, 27, 29, 35, 37, 43, 45)
)
WEB_SHARD = "multilingual/c4-fr.tfrecord-00002-of-02048.json.gz"
INCOMING_FILE = "corpus_ressources.jsonl.gz"
INCOMING_LICENCE = "libre de droits, déclaration du déposant (15/11/2026)"

# Candidats notés par FR 0.4, au plus, par source (tirage stable avant notation).
MAX_CANDIDATES = {"academic": 10_000, "web": 5_000, "resource": 6_000}
# Textes humains ajoutés, par source ; moitié « difficiles » au plus.
SIZES_V5 = {"academic": 1_500, "web": 800, "resource": 700}
# En dessous : le run s'arrête avant toute génération (sources insuffisantes).
MIN_SIZES = {"academic": 1_500, "web": 800, "resource": 100}
HARD_MIN = 0.5
HARD_SHARE = 0.5
MAX_PASSAGES_PER_DOCUMENT = 3
# Corpus déposé : part maximale de passages recoupant un jeu de test avant arrêt du run.
MAX_TEST_OVERLAP = 0.05

_PARAGRAPH = re.compile(r"\n\s*\n")
_SENTENCE = re.compile(r"(?<=[.!?…])\s+")


def _date_of(record: dict[str, Any]) -> str | None:
    for key, value in record.items():
        if DATE_KEY.search(key.lower()) and isinstance(value, (str, int)) and str(value).strip():
            return str(value).strip()
    return None


def _plain_prose(text: str) -> bool:
    """Prose : surtout des lettres, peu de chiffres (pas de tableau ni de liste de comptes)."""
    n = max(len(text), 1)
    letters = sum(c.isalpha() for c in text)
    digits = sum(c.isdigit() for c in text)
    return letters >= 0.7 * n and digits <= 0.05 * n


def _blocks(text: str) -> Iterable[str]:
    """Paragraphes ; un paragraphe trop long (texte sans saut de ligne) est découpé en
    groupes de phrases d'au plus MAX_WORDS // 3 mots."""
    for paragraph in _PARAGRAPH.split(text):
        paragraph = " ".join(paragraph.split())
        if count_words(paragraph) <= MAX_WORDS:
            yield paragraph
            continue
        group: list[str] = []
        words = 0
        for sentence in _SENTENCE.split(paragraph):
            group.append(sentence)
            words += count_words(sentence)
            if words >= MAX_WORDS // 3:
                yield " ".join(group)
                group, words = [], 0
        if group:
            yield " ".join(group)


def passages(text: str) -> list[str]:
    """Paragraphes consécutifs regroupés en passages de MIN_WORDS à MAX_WORDS mots."""
    out: list[str] = []
    current: list[str] = []
    words = 0
    for paragraph in _blocks(text):
        n = count_words(paragraph)
        if not paragraph or n > MAX_WORDS or not _plain_prose(paragraph):
            current, words = [], 0
            continue
        if words + n > MAX_WORDS:
            current, words = [], 0
        current.append(paragraph)
        words += n
        if words >= MIN_WORDS:
            out.append("\n\n".join(current))
            current, words = [], 0
        if len(out) >= MAX_PASSAGES_PER_DOCUMENT:
            break
    return out


def resource_documents(
    records: Iterable[tuple[Any, bool]], inventory: Counter[str]
) -> list[dict[str, Any]]:
    """Passages humains du corpus déposé : français, datés d'avant la date limite."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for record, _ in records:
        inventory["resource_records"] += 1
        _, text = pick_text(record)
        if not text:
            inventory["resource_no_text"] += 1
            continue
        meta = record if isinstance(record, dict) else {}
        date = _date_of(meta)
        if date is None:
            inventory["resource_undated"] += 1
            continue
        if not in_period(date, end=CUTOFF):
            inventory["resource_after_cutoff"] += 1
            continue
        if language_of(text) != "fr":
            inventory["resource_not_french"] += 1
            continue
        inventory["resource_kept_records"] += 1
        origin = str(meta.get("source") or "").strip()[:80]
        licence = str(meta.get("licence") or meta.get("license") or "").strip()[:80]
        for passage in passages(text):
            document = human_document(
                "resource",
                passage,
                f"depot:{INCOMING_FILE}" + (f":{origin}" if origin else ""),
                str(meta.get("url") or meta.get("id") or ""),
                licence or INCOMING_LICENCE,
                date,
            )
            if document["sha256"] in seen:
                continue
            seen.add(document["sha256"])
            out.append(document)
    inventory["resource_passages"] = len(out)
    return out


def web_document(page: dict[str, Any]) -> dict[str, Any]:
    """Page mC4 nettoyée (corpus.human.collect) au format des textes humains de 0.3 et 0.4."""
    return human_document(
        "web",
        str(page["text"]),
        str(page["source"]),
        str(page.get("url") or ""),
        str(page["licence"]),
        "2019-04",
    )


def cap_candidates(register: str, documents: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Au plus MAX_CANDIDATES[register] candidats, tirage stable (avant notation)."""
    unique = {d["sha256"]: d for d in documents}
    return choose(list(unique.values()), MAX_CANDIDATES[register], f"v5-{register}-candidates")


def select_v5(register: str, scored: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """SIZES_V5[register] textes : d'abord des « difficiles » (probabilité FR 0.4 ≥ HARD_MIN),
    au plus HARD_SHARE du total, puis des candidats ordinaires. Jamais en partition test."""
    n = SIZES_V5[register]
    hard = [d for d in scored if float(d["prior_probability"]) >= HARD_MIN]
    chosen = choose(hard, int(n * HARD_SHARE), f"v5-{register}-hard")
    taken = {d["sha256"] for d in chosen}
    ordinary = [d for d in scored if float(d["prior_probability"]) < HARD_MIN]
    chosen += choose(ordinary, n - len(chosen), f"v5-{register}-rest")
    # Trop peu de candidats ordinaires : on complète avec les difficiles restants.
    taken |= {d["sha256"] for d in chosen}
    leftover = [d for d in hard if d["sha256"] not in taken]
    chosen += choose(leftover, n - len(chosen), f"v5-{register}-fill")
    out = []
    for d in sorted(chosen, key=lambda d: d["id"]):
        out.append({**d, "split": assign_split(d, test=False)})
    return out


def check_sources(counts: dict[str, int], resource_overlap: float) -> list[str]:
    """Raisons d'arrêter le run avant toute notation et toute génération (liste vide : on
    continue)."""
    problems = [
        f"{register} : {counts.get(register, 0)} candidats (minimum {minimum})"
        for register, minimum in MIN_SIZES.items()
        if counts.get(register, 0) < minimum
    ]
    if resource_overlap > MAX_TEST_OVERLAP:
        problems.append(
            f"corpus déposé : {resource_overlap:.1%} des passages recoupent un jeu de test "
            f"(maximum {MAX_TEST_OVERLAP:.0%})"
        )
    return problems
