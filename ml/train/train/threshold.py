"""Seuil « Probablement IA » propre à un modèle Veritas (ADR-0013).

Choisi sur la partition de calibration du corpus, par une règle fixée à l'avance : le plus
petit seuil de la grille (0,70 à 0,95 depuis ADR-0017, pas de 0,01) qui donne au plus 0,5 %
de faux positifs sur les textes humains de calibration. Aucun seuil ne convient : `chosen` vaut
None et rien ne change.
"""

from collections import Counter
from typing import Any

from veritas.settings import MODEL_LIKELY_AI_RANGE

# La moitié de la porte de 1 % : Wikipédia et les textes courts n'ont pas de partition de
# calibration, et la couche 3 a été ajustée sur ces mêmes documents (passages).
TARGET_FALSE_POSITIVE_RATE = 0.005
STEP = 0.01


def grid() -> list[float]:
    low, high = MODEL_LIKELY_AI_RANGE
    steps = round((high - low) / STEP)
    return [round(low + i * STEP, 2) for i in range(steps + 1)]


def choose_threshold(records: list[dict[str, Any]]) -> dict[str, Any]:
    """records : {"label": "human"|"ai"|…, "category": …, "probability": float} par document.
    Les documents d'une autre étiquette (textes mixtes) sont ignorés."""
    humans = [r for r in records if r["label"] == "human"]
    ais = [r["probability"] for r in records if r["label"] == "ai"]
    if not humans or not ais:
        raise ValueError("calibration : il faut des textes humains et des textes générés")
    rows = []
    for threshold in grid():
        false_positives = sum(r["probability"] >= threshold for r in humans)
        rows.append(
            {
                "threshold": threshold,
                "false_positives": false_positives,
                "false_positive_rate": round(false_positives / len(humans), 4),
                "recall": round(sum(p >= threshold for p in ais) / len(ais), 4),
            }
        )
    chosen = next(
        (row for row in rows if row["false_positives"] <= TARGET_FALSE_POSITIVE_RATE * len(humans)),
        None,
    )
    by_category: Counter[str] = Counter()
    if chosen is not None:
        by_category.update(
            str(r.get("category") or "human")
            for r in humans
            if r["probability"] >= chosen["threshold"]
        )
    return {
        "rule": {
            "target_false_positive_rate": TARGET_FALSE_POSITIVE_RATE,
            "range": list(MODEL_LIKELY_AI_RANGE),
            "step": STEP,
        },
        "humans": len(humans),
        "ais": len(ais),
        "humans_by_category": dict(Counter(str(r.get("category") or "human") for r in humans)),
        "chosen": chosen["threshold"] if chosen else None,
        "at_chosen": chosen,
        "false_positives_by_category": dict(by_category),
        "grid": rows,
    }
