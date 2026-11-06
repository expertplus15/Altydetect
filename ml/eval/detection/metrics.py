"""Métriques de la détection sur le jeu de test gelé.

Avec les seuils de services/veritas/config/thresholds.yaml : précision et rappel de la bande
« likely_ai », taux de faux positifs sur les textes humains (porte : < 1 %), part
« undetermined », AUROC, et seuil de probabilité qui donnerait 1 % de faux positifs.
"""

from typing import Any

FALSE_POSITIVE_GATE = 0.01


def auroc(labels: list[int], scores: list[float]) -> float:
    positives = [s for s, y in zip(scores, labels, strict=True) if y == 1]
    negatives = [s for s, y in zip(scores, labels, strict=True) if y == 0]
    if not positives or not negatives:
        return float("nan")
    wins = sum((p > n) + 0.5 * (p == n) for p in positives for n in negatives)
    return wins / (len(positives) * len(negatives))


def threshold_for_fpr(labels: list[int], scores: list[float], fpr: float) -> float:
    """Plus petit seuil de probabilité gardant les faux positifs sous `fpr`."""
    human = sorted((s for s, y in zip(scores, labels, strict=True) if y == 0), reverse=True)
    allowed = int(fpr * len(human))
    return human[allowed] + 1e-6 if allowed < len(human) else 0.0


def detection_metrics(labels: list[int], bands: list[str], scores: list[float]) -> dict[str, Any]:
    """`bands` : bande du document (verdict_band), `scores` : probabilité du document."""
    ai = [b for b, y in zip(bands, labels, strict=True) if y == 1]
    human = [b for b, y in zip(bands, labels, strict=True) if y == 0]
    tp = ai.count("likely_ai")
    fp = human.count("likely_ai")
    false_positive_rate = fp / len(human) if human else 0.0
    return {
        "documents": {"ai": len(ai), "human": len(human)},
        "precision": tp / (tp + fp) if tp + fp else 0.0,
        "recall": tp / len(ai) if ai else 0.0,
        "false_positive_rate": false_positive_rate,
        "undetermined_rate": {
            "ai": ai.count("undetermined") / len(ai) if ai else 0.0,
            "human": human.count("undetermined") / len(human) if human else 0.0,
        },
        "auroc": auroc(labels, scores),
        "threshold_for_1pct_fpr": threshold_for_fpr(labels, scores, FALSE_POSITIVE_GATE),
        "gate_false_positives_passed": false_positive_rate < FALSE_POSITIVE_GATE,
    }
