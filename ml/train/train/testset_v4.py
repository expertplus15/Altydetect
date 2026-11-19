"""Jeu de test gelé `detection-v4` (français, ADR-0017) et mesure unique de FR 0.6.

`detection-v1` à `detection-v3` ne servent plus à mesurer un seuil de FR 0.6 (ADR-0015 §4).
Ce jeu neuf est construit comme eux, à partir de sources jamais utilisées :

- textes humains : pages mC4 (fragment 3), Wikipédia du 01/03/2022 (fragment 3 sur 15), pages
  universitaires (French Science Commons, fichiers jamais lus), arrêts (Judilibre, une autre
  tranche du tirage), textes courts coupés dans d'autres pages mC4 ;
- textes générés : Claude, Qwen, Mistral, Granite (vus à l'entraînement), Phi-3.5-mini (jamais
  vu), textes de Claude reformulés par Mistral, textes mixtes (début humain, fin Claude).

Fonctions pures, testées dans tests/test_testset_v4.py. Les textes restent dans le volume
Modal ; seuls les manifestes (sans texte) et les métriques sortent.
"""

import hashlib
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from corpus.clean import count_words, fingerprint

from train.corpus_v2 import HELD_OUT, OPEN_GENERATORS, OPEN_LICENCES

VERSION = "detection-v4"
LANGUAGE = "fr"
REFERENCE = "VRT-DET-FR-0.6"
RUN = "v6"

# Sources jamais utilisées (fragments 0 à 2 de mC4, fichier Wikipédia 2, fichiers French
# Science Commons 1 à 45 déjà lus par FR 0.3 à 0.5 ; tranche 0 du tirage des arrêts).
WEB_SHARD = "multilingual/c4-fr.tfrecord-00003-of-02048.json.gz"
WIKIPEDIA_SHARD = "20220301.fr/train-00003-of-00015.parquet"
FSC_FILES_V4 = tuple(f"french_open_science_{n:03d}.parquet" for n in (7, 15, 23, 31))
LEGAL_RESIDUE = 1

# Effectifs (ADR-0017 §2).
HUMAN_SIZES = {
    "human_web": 400,
    "human_wikipedia": 300,
    "human_academic": 200,
    "human_legal": 100,
    "human_short": 100,
}
# Pages mC4 tirées, sans recouvrement : 400 textes humains ; 80 sujets de plus pour les modèles
# ouverts ; sources des textes courts et débuts des mixtes, avec une marge pour les échecs.
WEB_POOLS = {"human_web": 400, "open_source": 80, "short_source": 120, "mixed_source": 120}
# Consignes de génération : 20 % de plus que l'effectif visé (textes vides, refus, trop courts),
# puis tirage stable de l'effectif exact.
OVERSAMPLE = 1.2
CLAUDE_TOPICS = round(OVERSAMPLE * 200)
AI_SIZES = {
    "ai_claude": 200,
    "ai_qwen": 100,
    "ai_mistral": 100,
    "ai_granite": 100,
    "ai_phi": 100,
    "ai_reformulated": 100,
    "mixed": 100,
}
# Générateurs ouverts : vus à l'entraînement (Qwen, Mistral, Granite) et jamais vu (Phi).
GENERATORS = {
    "qwen": OPEN_GENERATORS["qwen"],
    "mistral": OPEN_GENERATORS["mistral"],
    "granite": OPEN_GENERATORS["granite"],
    "phi": HELD_OUT["phi"],
}
LICENCES = {**OPEN_LICENCES, "phi": "MIT"}
REFORMULATOR = "mistral"

# Portes d'ADR-0015 §2, inchangées.
GATES = {
    "max_false_positive_rate": 0.01,
    "min_recall_claude": 0.95,
    "min_recall_seen": 0.80,
    "min_recall_unseen": 0.60,
}
SEEN = ("ai_qwen", "ai_mistral", "ai_granite", "ai_reformulated")
UNSEEN = ("ai_phi",)
# Catégories qui peuvent manquer de textes sans arrêter le run (ADR-0017 : arrêts).
OPTIONAL = ("human_legal",)


def _rank(seed: str, document: Mapping[str, Any]) -> str:
    return hashlib.sha256(f"{VERSION}:{seed}:{document['id']}".encode()).hexdigest()


def pick(documents: Iterable[dict[str, Any]], n: int, seed: str) -> list[dict[str, Any]]:
    """Tirage stable : indépendant de l'ordre d'entrée."""
    return sorted(documents, key=lambda d: _rank(seed, d))[:n]


def split_web(pages: Sequence[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Pages mC4 réparties sans recouvrement entre les trois usages."""
    ordered = pick(pages, len(pages), "web")
    out, start = {}, 0
    for pool, size in WEB_POOLS.items():
        out[pool] = ordered[start : start + size]
        start += size
    return out


def document(category: str, label: str, text: str, **fields: Any) -> dict[str, Any]:
    """Document du jeu : identifiant tiré de l'empreinte, préfixé par la version."""
    digest = fingerprint(text)
    return {
        "id": f"v4-{LANGUAGE}-{category}-{digest[:16]}",
        "sha256": digest,
        "category": category,
        "label": label,
        "language": LANGUAGE,
        "words": count_words(text),
        **fields,
        "text": text,
    }


def as_category(source: Mapping[str, Any], category: str) -> dict[str, Any]:
    """Texte humain d'une source déjà nettoyée, rangé dans sa catégorie du jeu."""
    keep = ("url", "licence", "source", "date")
    return document(
        category,
        "human",
        str(source["text"]),
        **{k: source[k] for k in keep if source.get(k)},
        derived_from=source["id"],
    )


# Même forme que les consignes du corpus 0.2 (découpage en lots partagé) : langue, catégorie,
# source, mots.
Job = tuple[str, str, dict[str, Any], int]


def plan_open_jobs(
    topics: Sequence[dict[str, Any]], claude: Sequence[dict[str, Any]]
) -> dict[str, list[Job]]:
    """Consignes des modèles ouverts : un texte par page humaine, pages distinctes d'un
    générateur à l'autre (120 chacun), et 120 reformulations de textes de Claude par Mistral."""
    jobs: dict[str, list[Job]] = {key: [] for key in GENERATORS}
    pages = pick(topics, len(topics), "open")
    size = round(OVERSAMPLE * 100)
    for n, key in enumerate(GENERATORS):
        for page in pages[n * size : (n + 1) * size]:
            jobs[key].append((LANGUAGE, f"ai_{key}", page, int(page["words"])))
    for text in pick(claude, round(OVERSAMPLE * AI_SIZES["ai_reformulated"]), "reformulated"):
        jobs[REFORMULATOR].append((LANGUAGE, "ai_reformulated", text, int(text["words"])))
    return jobs


def check_sizes(counts: Mapping[str, int]) -> list[str]:
    """Catégories en dessous de leur effectif (les catégories facultatives sont signalées à
    part, sans arrêter le run)."""
    wanted = {**HUMAN_SIZES, **AI_SIZES}
    return [
        f"{category} : {counts.get(category, 0)} pour {size}"
        for category, size in wanted.items()
        if counts.get(category, 0) < size and category not in OPTIONAL
    ]


def check_gates(categories: Mapping[str, Any]) -> dict[str, Any]:
    """Portes d'ADR-0015 §2 sur le rapport par catégorie (`category_report`) de detection-v4."""

    def rows(names: Sequence[str]) -> list[Mapping[str, Any]]:
        return [
            categories[c]
            for c in names
            if categories.get(c) and categories[c].get("likely_ai") is not None
        ]

    def rate(selected: list[Mapping[str, Any]]) -> float | None:
        total = sum(r["documents"] - r["errors"] for r in selected)
        hits = sum(r["likely_ai"] * (r["documents"] - r["errors"]) for r in selected)
        return round(hits / total, 4) if total else None

    humans = [c for c in categories if c.startswith("human_")]
    measured: dict[str, Any] = {
        "false_positive_rate": rate(rows(humans)),
        "false_positive_rate_by_category": {
            c: categories[c]["likely_ai"] for c in sorted(humans) if categories[c]
        },
        "recall_claude": rate(rows(("ai_claude",))),
        "recall_seen": rate(rows(SEEN)),
        "recall_unseen": rate(rows(UNSEEN)),
    }

    def at_most(value: float | None, limit: float) -> bool:
        return value is not None and value <= limit

    def at_least(value: float | None, limit: float) -> bool:
        return value is not None and value >= limit

    checks = {
        "false_positive_rate": at_most(
            measured["false_positive_rate"], GATES["max_false_positive_rate"]
        ),
        "recall_claude": at_least(measured["recall_claude"], GATES["min_recall_claude"]),
        "recall_seen": at_least(measured["recall_seen"], GATES["min_recall_seen"]),
        "recall_unseen": at_least(measured["recall_unseen"], GATES["min_recall_unseen"]),
    }
    return {"gates": GATES, "measured": measured, "checks": checks, "passed": all(checks.values())}


def manifest(documents: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Manifeste du jeu, trié par identifiant, sans texte."""
    return [
        {k: v for k, v in sorted(d.items()) if k != "text"}
        for d in sorted(documents, key=lambda d: d["id"])
    ]
