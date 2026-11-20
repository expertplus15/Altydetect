"""Jeu de vérification `verification-en-v1` de VRT-DET-EN-0.2 sur des textes réels (ADR-0016).

Fonctions pures, sans réseau ni Modal (testées dans tests/test_verification.py) :

- textes humains publics, d'avant le 30/11/2022 (sortie de ChatGPT) :
  - `human_non_native` : questions d'English Language Learners Stack Exchange ;
  - `human_forum` : questions et réponses d'Academia, The Workplace et Writing Stack Exchange ;
  - `human_abstract` : résumés arXiv dont l'article est sous CC BY, CC BY-SA ou CC0 ;
- dépôt de l'équipe (`incoming/verification-en-v1/*.jsonl` du volume des corpus) :
  - `human_volunteer` : textes de volontaires, avec consentement écrit (jamais conservés) ;
  - `ai_assistant` : textes produits à la main dans ChatGPT, Gemini ou Copilot ;
  - `ai_edited` : textes générés puis retouchés à la main (publiés, sans porte) ;
- portes d'ADR-0016 §3, et borne haute à 95 % du taux de faux positifs.

Aucun texte ne sort du volume : les rapports ne portent que des identifiants, des empreintes et
des probabilités.
"""

import hashlib
import html
import json
import math
import re
import xml.etree.ElementTree as ET
from collections import Counter
from collections.abc import Iterable, Iterator, Mapping
from typing import Any, BinaryIO

from corpus.clean import count_words, fingerprint

from train.incoming import PARTIAL_COPY, SHINGLE_STRIDE, language_of, shingles

VERSION = "verification-en-v1"
LANGUAGE = "en"
REFERENCE = "VRT-DET-EN-0.2"
# Sortie de ChatGPT : tout texte humain public est créé et modifié au plus tard ce jour-là.
CUTOFF = "2022-11-30"
# En dessous de 150 mots, Veritas ne rend aucun score ; au-delà de 1 500, le texte est écarté.
MIN_WORDS, MAX_WORDS = 150, 1500

# Effectifs des textes humains publics (ADR-0016 §1).
QUOTAS = {"human_non_native": 150, "human_forum": 150, "human_abstract": 200}
# Sites Stack Exchange : English Language Learners (questions seulement : les réponses sont
# souvent écrites par des natifs) ; forums en anglais courant, 50 textes chacun.
NON_NATIVE_SITE = "ell"
FORUM_SITES = ("academia", "workplace", "writers")
STACK_EXCHANGE_DUMP = "https://archive.org/download/stackexchange/{site}.stackexchange.com.7z"
STACK_EXCHANGE_LICENCE = "CC BY-SA 4.0 (vidage Stack Exchange, archive.org, avril 2024)"
# arXiv : licence de chaque article, lue dans ses métadonnées. Seules les licences qui
# permettent un usage commercial sont gardées (ni NC ni ND).
ARXIV_OAI = "https://export.arxiv.org/oai2"
ARXIV_WINDOW = ("2021-06-01", "2021-06-30")
OPEN_LICENCES = {
    "http://creativecommons.org/licenses/by/4.0/": "CC BY 4.0",
    "http://creativecommons.org/licenses/by-sa/4.0/": "CC BY-SA 4.0",
    "http://creativecommons.org/licenses/by/3.0/": "CC BY 3.0",
    "http://creativecommons.org/publicdomain/zero/1.0/": "CC0 1.0",
}

# Dépôt de l'équipe.
DEPOSIT_DIR = f"incoming/{VERSION}"
KINDS = {
    "volunteer": ("human_volunteer", "human"),
    "assistant": ("ai_assistant", "ai"),
    # Retouchés à la main : ni humains ni générés, mesurés sans porte.
    "edited": ("ai_edited", "mixed"),
}
ASSISTANTS = ("chatgpt", "gemini", "copilot", "other")
GENRES = ("essay", "letter", "email", "report", "answer", "article", "other")

# Arrêts avant toute dépense GPU, et portes (ADR-0016 §3).
MIN_HUMANS = 600
MIN_ASSISTANTS = 100
# En dessous de ce nombre de textes, une catégorie est publiée sans porte propre.
MIN_CATEGORY_FOR_GATE = 100
GATES = {
    "max_false_positive_rate": 0.01,
    "max_category_false_positive_rate": 0.02,
    "min_recall_assistants": 0.60,
}

_BLOCKS = re.compile(r"<(pre|code|blockquote|table)\b[^>]*>.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
_BREAKS = re.compile(r"<\s*(br|/p|/li|/h[1-6]|/div)\b[^>]*>", re.IGNORECASE)
_TAGS = re.compile(r"<[^>]+>")
_SPACES = re.compile(r"[ \t\r\f\v]+")
_URL = re.compile(r"https?://\S+")


# --- textes ---


def html_to_text(body: str) -> str:
    """Corps HTML d'un message Stack Exchange → texte : code, citations et tableaux retirés
    (ce n'est pas l'auteur qui les a écrits, ou ce n'est pas de la prose)."""
    text = _BLOCKS.sub(" ", body)
    text = _BREAKS.sub("\n", text)
    text = html.unescape(_TAGS.sub(" ", text))
    text = _URL.sub(" ", text)
    paragraphs = (_SPACES.sub(" ", p).strip() for p in text.split("\n"))
    return "\n\n".join(p for p in paragraphs if p)


def _usable(text: str, inventory: Counter[str], prefix: str) -> bool:
    words = count_words(text)
    if words < MIN_WORDS:
        inventory[f"{prefix}_too_short"] += 1
        return False
    if words > MAX_WORDS:
        inventory[f"{prefix}_too_long"] += 1
        return False
    if language_of(text) != LANGUAGE:
        inventory[f"{prefix}_not_english"] += 1
        return False
    return True


def _document(id_: str, category: str, label: str, text: str, **meta: Any) -> dict[str, Any]:
    return {
        "id": id_,
        "category": category,
        "label": label,
        "language": LANGUAGE,
        "words": count_words(text),
        "sha256": fingerprint(text),
        **meta,
        "text": text,
    }


def _before_cutoff(*dates: str | None) -> bool:
    return all(not d or d[:10] <= CUTOFF for d in dates)


# --- Stack Exchange ---


def iter_posts(stream: BinaryIO) -> Iterator[dict[str, str]]:
    """Lignes `<row …/>` de Posts.xml, en flux (le fichier fait plusieurs centaines de Mo)."""
    for _, element in ET.iterparse(stream, events=("end",)):
        if element.tag == "row":
            yield dict(element.attrib)
        element.clear()


def stack_exchange_document(
    row: Mapping[str, str], site: str, inventory: Counter[str]
) -> dict[str, Any] | None:
    """Message retenu, ou None (motif compté dans `inventory`). ELL : questions seulement."""
    kind = row.get("PostTypeId")
    non_native = site == NON_NATIVE_SITE
    if kind not in (("1",) if non_native else ("1", "2")):
        return None
    prefix = f"se_{site}"
    if not _before_cutoff(row.get("CreationDate"), row.get("LastEditDate")):
        inventory[f"{prefix}_after_cutoff"] += 1
        return None
    text = html_to_text(row.get("Body", ""))
    if not _usable(text, inventory, prefix):
        return None
    post = row["Id"]
    path = "q" if kind == "1" else "a"
    return _document(
        f"se-{site}-{post}",
        "human_non_native" if non_native else "human_forum",
        "human",
        text,
        source=f"stackexchange:{site}",
        url=f"https://{site}.stackexchange.com/{path}/{post}",
        licence=STACK_EXCHANGE_LICENCE,
        date=row.get("CreationDate", "")[:10],
    )


# --- arXiv ---

_OAI = "{http://www.openarchives.org/OAI/2.0/}"
_ARXIV = "{http://arxiv.org/OAI/arXiv/}"


def arxiv_page(xml: bytes) -> tuple[list[dict[str, str]], str | None]:
    """Une page de réponse OAI-PMH (format `arXiv`) : métadonnées et jeton de la suite."""
    root = ET.fromstring(xml)
    records = []
    for record in root.iter(f"{_OAI}record"):
        meta = record.find(f"{_OAI}metadata/{_ARXIV}arXiv")
        if meta is None:
            continue
        records.append(
            {
                field: " ".join((meta.findtext(f"{_ARXIV}{field}") or "").split())
                for field in ("id", "created", "updated", "license", "abstract")
            }
        )
    token = root.findtext(f".//{_OAI}resumptionToken")
    return records, (token.strip() or None) if token else None


def arxiv_document(record: Mapping[str, str], inventory: Counter[str]) -> dict[str, Any] | None:
    """Résumé retenu : article sous licence ouverte, créé et modifié avant la date limite."""
    licence = OPEN_LICENCES.get(record.get("license", ""))
    if licence is None:
        inventory["arxiv_licence_excluded"] += 1
        return None
    if not _before_cutoff(record.get("created"), record.get("updated")):
        inventory["arxiv_after_cutoff"] += 1
        return None
    text = record.get("abstract", "")
    if not _usable(text, inventory, "arxiv"):
        return None
    article = record["id"]
    return _document(
        f"arxiv-{article.replace('/', '_')}",
        "human_abstract",
        "human",
        text,
        source="arxiv",
        url=f"https://arxiv.org/abs/{article}",
        licence=f"{licence} (licence de l'article)",
        date=record.get("created", "")[:10],
    )


# --- sélection ---


def exclude_known(
    documents: Iterable[dict[str, Any]],
    used: set[str],
    tests: set[str],
    test_shingles: set[int],
    inventory: Counter[str],
) -> list[dict[str, Any]]:
    """Retire les textes (empreinte) et adresses déjà vus, et les copies partielles d'un jeu
    de test (20 % de suites de 8 mots communes)."""
    kept, seen = [], set()
    for d in documents:
        if d["sha256"] in seen:
            inventory[f"{d['category']}_duplicate"] += 1
            continue
        seen.add(d["sha256"])
        if d["sha256"] in used or (d.get("url") and d["url"] in used):
            inventory[f"{d['category']}_already_used"] += 1
            continue
        sample = shingles(d["text"], SHINGLE_STRIDE)
        if d["sha256"] in tests or (
            sample and len(sample & test_shingles) / len(sample) >= PARTIAL_COPY
        ):
            inventory[f"{d['category']}_test_overlap"] += 1
            continue
        kept.append(d)
    return kept


def _rank(document: Mapping[str, Any]) -> str:
    return hashlib.sha256(f"{VERSION}:{document['id']}".encode()).hexdigest()


def select(documents: Iterable[dict[str, Any]], size: int) -> list[dict[str, Any]]:
    """Tirage stable : le même ensemble de candidats donne toujours la même sélection."""
    return sorted(documents, key=_rank)[:size]


def select_forum(documents: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Forums : la même part de chaque site (50 chacun), le reste complété au besoin."""
    documents = list(documents)
    share = QUOTAS["human_forum"] // len(FORUM_SITES)
    chosen = []
    for site in FORUM_SITES:
        chosen += select((d for d in documents if d["source"] == f"stackexchange:{site}"), share)
    ids = {d["id"] for d in chosen}
    rest = select((d for d in documents if d["id"] not in ids), QUOTAS["human_forum"] - len(chosen))
    return chosen + rest


# --- dépôt de l'équipe ---


def parse_deposit(
    lines: Iterable[bytes | str], inventory: Counter[str]
) -> list[tuple[dict[str, Any] | None, bytes | str]]:
    """Lignes JSON du dépôt → (document, ligne brute). Le document vaut None si la ligne est
    refusée (motif dans `inventory`). Format d'une ligne :

    - `kind` : `volunteer`, `assistant` ou `edited` ;
    - `text` : le texte, en anglais, de 150 à 1 500 mots ;
    - volontaire : `consent_id` (référence du consentement écrit, gardé par l'équipe hors du
      dépôt) et `year` (année d'écriture, au plus 2022) ;
    - assistant ou retouché : `source` parmi chatgpt, gemini, copilot, other ;
    - facultatif : `genre` parmi essay, letter, email, report, answer, article, other.
    """
    out: list[tuple[dict[str, Any] | None, bytes | str]] = []
    for raw in lines:
        line = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
        if not line.strip():
            continue
        out.append((_deposit_document(line, inventory), raw))
    return out


def _deposit_document(line: str, inventory: Counter[str]) -> dict[str, Any] | None:
    try:
        record = json.loads(line)
    except json.JSONDecodeError:
        inventory["deposit_invalid_json"] += 1
        return None
    if not isinstance(record, dict) or record.get("kind") not in KINDS:
        inventory["deposit_unknown_kind"] += 1
        return None
    kind = str(record["kind"])
    text = record.get("text")
    if not isinstance(text, str):
        inventory[f"deposit_{kind}_no_text"] += 1
        return None
    text = text.strip()
    genre = record.get("genre", "other")
    if genre not in GENRES:
        inventory[f"deposit_{kind}_unknown_genre"] += 1
        genre = "other"
    meta: dict[str, Any] = {"genre": genre}
    if kind == "volunteer":
        consent = record.get("consent_id")
        year = record.get("year")
        if not isinstance(consent, str) or not consent.strip():
            inventory["deposit_volunteer_no_consent"] += 1
            return None
        if not isinstance(year, int) or isinstance(year, bool) or not 1950 <= year <= 2022:
            inventory["deposit_volunteer_bad_year"] += 1
            return None
        meta.update(source="volunteer", year=year)
    else:
        source = record.get("source")
        if source not in ASSISTANTS:
            inventory[f"deposit_{kind}_unknown_source"] += 1
            return None
        meta.update(source=str(source))
    if not _usable(text, inventory, f"deposit_{kind}"):
        return None
    category, label = KINDS[kind]
    digest = fingerprint(text)
    return _document(f"dep-{kind}-{digest[:16]}", category, label, text, **meta)


def keep_line(document: Mapping[str, Any] | None) -> bool:
    """Ligne gardée dans le dépôt après la mesure : seuls les textes d'assistants (retouchés
    compris) restent. Les textes de volontaires et les lignes refusées sont effacés."""
    return document is not None and document["category"] != "human_volunteer"


# --- arrêts et portes ---


def check_sizes(counts: Mapping[str, int]) -> list[str]:
    """Motifs d'arrêt avant la notation (aucune dépense GPU)."""
    problems = []
    for category, quota in QUOTAS.items():
        if counts.get(category, 0) < quota:
            problems.append(f"{category} : {counts.get(category, 0)} textes pour {quota}")
    humans = sum(n for c, n in counts.items() if c.startswith("human_"))
    if humans < MIN_HUMANS:
        problems.append(f"textes humains : {humans} pour {MIN_HUMANS}")
    if counts.get("ai_assistant", 0) < MIN_ASSISTANTS:
        problems.append(
            f"ai_assistant : {counts.get('ai_assistant', 0)} textes pour {MIN_ASSISTANTS}"
        )
    return problems


def upper_bound(errors: int, total: int, confidence: float = 0.95) -> float | None:
    """Borne haute exacte (Clopper-Pearson, unilatérale) d'un taux observé errors / total."""
    if total <= 0:
        return None
    if errors >= total:
        return 1.0
    alpha = 1 - confidence
    low, high = errors / total, 1.0
    for _ in range(60):
        mid = (low + high) / 2
        tail = sum(
            math.comb(total, k) * mid**k * (1 - mid) ** (total - k) for k in range(errors + 1)
        )
        low, high = (mid, high) if tail > alpha else (low, mid)
    return round(high, 4)


def check_gates(records: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """Portes d'ADR-0016 §3 sur les enregistrements notés (catégorie, étiquette, bande)."""
    rows = [r for r in records if "band" in r]
    humans = [r for r in rows if r["label"] == "human"]
    assistants = [r for r in rows if r["category"] == "ai_assistant"]
    false_positives = sum(r["band"] == "likely_ai" for r in humans)
    by_category: dict[str, dict[str, Any]] = {}
    for category in sorted({r["category"] for r in humans}):
        group = [r for r in humans if r["category"] == category]
        errors = sum(r["band"] == "likely_ai" for r in group)
        by_category[category] = {
            "documents": len(group),
            "false_positives": errors,
            "false_positive_rate": round(errors / len(group), 4),
            "upper_bound_95": upper_bound(errors, len(group)),
            "gated": len(group) >= MIN_CATEGORY_FOR_GATE,
        }
    recall = (
        round(sum(r["band"] == "likely_ai" for r in assistants) / len(assistants), 4)
        if assistants
        else None
    )
    measured = {
        "humans": len(humans),
        "false_positives": false_positives,
        "false_positive_rate": round(false_positives / len(humans), 4) if humans else None,
        "false_positive_upper_bound_95": upper_bound(false_positives, len(humans)),
        "categories": by_category,
        "assistants": len(assistants),
        "recall_assistants": recall,
        "recall_by_source": {
            source: round(
                sum(r["band"] == "likely_ai" for r in assistants if r.get("source") == source) / n,
                4,
            )
            for source, n in sorted(Counter(r.get("source") for r in assistants).items())
            if source
        },
    }
    evaluable = {
        "false_positive_rate": len(humans) >= MIN_HUMANS,
        "recall_assistants": len(assistants) >= MIN_ASSISTANTS,
    }
    checks = {
        "false_positive_rate": evaluable["false_positive_rate"]
        and measured["false_positive_rate"] is not None
        and measured["false_positive_rate"] <= GATES["max_false_positive_rate"],
        "category_false_positive_rate": all(
            c["false_positive_rate"] <= GATES["max_category_false_positive_rate"]
            for c in by_category.values()
            if c["gated"]
        ),
        "recall_assistants": evaluable["recall_assistants"]
        and recall is not None
        and recall >= GATES["min_recall_assistants"],
    }
    return {
        "gates": GATES,
        "measured": measured,
        "evaluable": evaluable,
        "checks": checks,
        "passed": all(checks.values()),
    }


def manifest_entry(document: Mapping[str, Any]) -> dict[str, Any]:
    """Entrée de manifeste, sans texte. Volontaires : ni source détaillée ni consentement."""
    keys: tuple[str, ...] = ("id", "sha256", "category", "label", "words")
    if document["category"] != "human_volunteer":
        keys += ("source", "url", "licence", "date")
    return {k: document[k] for k in keys if k in document}
