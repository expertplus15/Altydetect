"""Corpus de Veritas 0.2 (ADR-0011) : le corpus v1 (C4 / mC4 et Claude) enrichi de textes
écrits par des modèles ouverts, de textes de Claude reformulés et de textes mixtes.

Fonctions pures (aucun réseau, aucun GPU) ; les appels Modal sont dans ml/train/pipeline.py.

Règles :
- seules les partitions « train » et « calibration » de v1 servent de sources ; un texte dérivé
  suit la partition de son texte humain d'origine (`paired_with`) ;
- Phi-3.5-mini (HELD_OUT) n'est jamais utilisé : c'est le générateur inconnu du jeu de
  robustesse detection-v2, celui qui mesure la généralisation ;
- aucun texte de detection-v2 ni de sa source n'entre dans ce corpus (sources : partition test
  de detection-v1, jamais lue ici).
"""

import hashlib
import random
from collections.abc import Sequence
from typing import Any

from corpus.generate import prompt_for
from corpus.manifest import assign_split
from detection.robustness import REFORMULATE, clean_generation, mix
from veritas.text import count_words

# Générateurs ouverts du corpus 0.2 : sans accès restreint sur Hugging Face, licences
# permissives (vérifié le 13/11/2026). Tous tiennent sur un GPU L4 en bf16.
OPEN_GENERATORS = {
    "qwen": "Qwen/Qwen2.5-7B-Instruct",  # Apache-2.0
    "mistral": "mistralai/Mistral-7B-Instruct-v0.3",  # Apache-2.0
    "granite": "ibm-granite/granite-3.3-8b-instruct",  # Apache-2.0
    "olmo": "allenai/OLMo-2-1124-7B-Instruct",  # Apache-2.0
}
OPEN_LICENCES = {key: "Apache-2.0" for key in OPEN_GENERATORS}
# OLMo 2 est entraîné presque seulement sur de l'anglais : pas de français.
BY_LANGUAGE = {"fr": ("qwen", "mistral", "granite"), "en": ("qwen", "mistral", "granite", "olmo")}
HELD_OUT = {"phi": "microsoft/Phi-3.5-mini-instruct"}

# Effectifs par langue (en plus des 4 400 textes humains et 4 400 textes de Claude de v1).
SIZES = {"open": 2400, "reformulated": 600, "mixed": 1000}
MAX_NEW_TOKENS = 2000

Job = tuple[str, str, dict[str, Any], int]  # langue, catégorie, source, mots


def _digest(text: str) -> str:
    return hashlib.sha256(" ".join(text.lower().split()).encode()).hexdigest()


def choose(docs: Sequence[dict[str, Any]], n: int, seed: str) -> list[dict[str, Any]]:
    """Tirage déterministe, indépendant de l'ordre d'entrée."""
    ordered = sorted(docs, key=lambda d: d["id"])
    return random.Random(seed).sample(ordered, min(n, len(ordered)))


def assign_generator(key: str, language: str) -> str:
    """Générateur attribué à une source, réparti uniformément et stable d'un run à l'autre."""
    choices = BY_LANGUAGE[language]
    return choices[int(hashlib.sha256(key.encode()).hexdigest()[:8], 16) % len(choices)]


def budget(words: int) -> int:
    return min(MAX_NEW_TOKENS, int(words * 2.2) + 100)


def plan_jobs(
    language: str, humans: Sequence[dict[str, Any]], claude: Sequence[dict[str, Any]]
) -> dict[str, list[Job]]:
    """Consignes par générateur : textes sur les sujets des textes humains, et reformulations
    de textes de Claude. Partition test exclue."""
    pool_h = [h for h in humans if h["split"] != "test"]
    pool_c = [a for a in claude if a["split"] != "test"]
    jobs: dict[str, list[Job]] = {key: [] for key in BY_LANGUAGE[language]}
    for h in choose(pool_h, SIZES["open"], f"v2-{language}-open"):
        key = assign_generator(h["id"], language)
        jobs[key].append((language, "ai_open", h, int(h["words"])))
    for a in choose(pool_c, SIZES["reformulated"], f"v2-{language}-reform"):
        key = assign_generator(f"{a['id']}/reform", language)
        jobs[key].append((language, "ai_reformulated", a, int(a["words"])))
    return jobs


def prompt(job: Job) -> str:
    language, category, source, _ = job
    if category == "ai_reformulated":
        return REFORMULATE[language].format(text=source["text"])
    return prompt_for(source)


def generated_document(job: Job, generator: str, raw: str) -> dict[str, Any] | None:
    """Document généré par un modèle ouvert (nettoyé), ou None s'il est inutilisable."""
    language, category, source, _ = job
    text = clean_generation(raw)
    if text is None:
        return None
    digest = _digest(text)
    human_id = source["id"] if category == "ai_open" else source["paired_with"]
    document: dict[str, Any] = {
        "id": f"o-{language}-{digest[:16]}",
        "sha256": digest,
        "label": "ai",
        "category": category,
        "language": language,
        "text": text,
        "words": count_words(text),
        "generator": OPEN_GENERATORS[generator],
        "source": f"generated:{OPEN_GENERATORS[generator]}",
        "licence": f"Généré par {OPEN_GENERATORS[generator]} ({OPEN_LICENCES[generator]})",
        "paired_with": human_id,
        "derived_from": source["id"],
    }
    document["split"] = assign_split(document, test=False)
    return document


def mixed_documents(
    language: str, humans: Sequence[dict[str, Any]], claude: Sequence[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Début d'un texte humain suivi de la fin du texte de Claude sur le même sujet ;
    `ai_starts_at` donne la frontière (les fenêtres d'entraînement sont étiquetées par côté)."""
    by_human = {a["paired_with"]: a for a in claude if a["split"] != "test"}
    pool = [h for h in humans if h["split"] != "test" and h["id"] in by_human]
    out: list[dict[str, Any]] = []
    for h in choose(pool, len(pool), f"v2-{language}-mixed"):
        mixed = mix(h["text"], by_human[h["id"]]["text"])
        if mixed is None:
            continue
        text, boundary = mixed
        digest = _digest(text)
        document: dict[str, Any] = {
            "id": f"m-{language}-{digest[:16]}",
            "sha256": digest,
            "label": "mixed",
            "category": "mixed",
            "language": language,
            "text": text,
            "words": count_words(text),
            "source": "mixed:c4+claude",
            "licence": f"{h['licence']} ; {by_human[h['id']]['licence']}",
            "paired_with": h["id"],
            "derived_from": [h["id"], by_human[h["id"]]["id"]],
            "ai_starts_at": boundary,
        }
        document["split"] = assign_split(document, test=False)
        out.append(document)
        if len(out) == SIZES["mixed"]:
            break
    return out


# Portes de sortie de Veritas 0.2, proposées le 13/11/2026 (ADR-0011) : À VALIDER.
# Mesurées avec les seuils de production (thresholds.yaml), par langue.
GATES = {
    # Faux positifs sur tous les textes humains (detection-v1 et detection-v2) : porte du PRD.
    "max_false_positive_rate": 0.01,
    # Rappel sur les textes de Claude de detection-v1.
    "min_recall_claude": 0.95,
    # Rappel sur les générateurs vus à l'entraînement (Qwen, Mistral, reformulations).
    "min_recall_seen": 0.80,
    # Rappel sur le générateur jamais vu (Phi-3.5-mini) : la généralisation.
    "min_recall_unseen": 0.60,
}
SEEN = ("ai_qwen", "ai_mistral", "ai_reformulated")
UNSEEN = ("ai_phi",)


def check_gates(v1: dict[str, Any], v2: dict[str, Any]) -> dict[str, Any]:
    """`v1` : detection_metrics sur detection-v1 ; `v2` : category_report sur detection-v2."""

    def recall(categories: Sequence[str]) -> float:
        rows = [v2[c] for c in categories if v2.get(c) and v2[c]["likely_ai"] is not None]
        total = sum(r["documents"] - r["errors"] for r in rows)
        hits = sum(r["likely_ai"] * (r["documents"] - r["errors"]) for r in rows)
        return round(hits / total, 4) if total else 0.0

    humans_v1 = v1["documents"]["human"]
    humans_v2 = v2["_overall"]["humans"]
    fp = (
        v1["false_positive_rate"] * humans_v1 + v2["_overall"]["false_positive_rate"] * humans_v2
    ) / max(humans_v1 + humans_v2, 1)
    measured = {
        "false_positive_rate": round(fp, 4),
        "recall_claude": round(v1["recall"], 4),
        "recall_seen": recall(SEEN),
        "recall_unseen": recall(UNSEEN),
    }
    checks = {
        "false_positive_rate": measured["false_positive_rate"] <= GATES["max_false_positive_rate"],
        "recall_claude": measured["recall_claude"] >= GATES["min_recall_claude"],
        "recall_seen": measured["recall_seen"] >= GATES["min_recall_seen"],
        "recall_unseen": measured["recall_unseen"] >= GATES["min_recall_unseen"],
    }
    return {"gates": GATES, "measured": measured, "checks": checks, "passed": all(checks.values())}
