"""Couche 1 (régression logistique sur les traits statistiques) et couche 3 (combinaison des
couches 1 et 2, calibrée sur le jeu de calibration). scikit-learn n'est utilisé qu'ici :
l'inférence de Veritas n'en dépend pas."""

from typing import Any

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from veritas.engine.features import FEATURES, extract
from veritas.engine.model import Layer1


def fit_layer1(passages: list[list[str]], labels: list[int], language: str) -> dict[str, Any]:
    features = np.array([extract(p, language) for p in passages], dtype=float)
    scaler = StandardScaler().fit(features)
    model = LogisticRegression(max_iter=2000, C=1.0).fit(scaler.transform(features), labels)
    return {
        "features": list(FEATURES),
        "mean": [float(x) for x in scaler.mean_],
        "scale": [float(x) for x in scaler.scale_],
        "coef": [float(x) for x in model.coef_[0]],
        "intercept": float(model.intercept_[0]),
    }


def layer1_logits(layer1: dict[str, Any], passages: list[list[str]], language: str) -> list[float]:
    """Logits de la couche 1 calculés exactement comme à l'inférence (veritas.engine.model)."""
    layer = Layer1(
        mean=tuple(layer1["mean"]),
        scale=tuple(layer1["scale"]),
        coef=tuple(layer1["coef"]),
        intercept=float(layer1["intercept"]),
    )
    return [layer.logit(extract(p, language)) for p in passages]


def fit_combination(
    l1: list[float],
    l2: list[float] | None,
    labels: list[int],
    c: float = 10.0,
    balanced: bool = False,
) -> tuple[dict[str, float], dict[str, Any]]:
    """Régression logistique sur [logit couche 1, logit couche 2] ajustée sur la calibration :
    sa sortie est déjà une probabilité calibrée, la mise à l'échelle de Platt reste neutre.
    Veritas 0.2 : régularisation plus forte (`c` = 1) et classes équilibrées."""
    columns = [l1] if l2 is None else [l1, l2]
    x = np.array(columns, dtype=float).T
    model = LogisticRegression(
        max_iter=2000, C=c, class_weight="balanced" if balanced else None
    ).fit(x, labels)
    weights = [float(w) for w in model.coef_[0]]
    combine = {
        "layer1": weights[0],
        "layer2": weights[1] if l2 is not None else 0.0,
        "bias": float(model.intercept_[0]),
    }
    return combine, {"method": "platt", "a": 1.0, "b": 0.0}


def build_manifest(
    reference: str,
    language: str,
    layer1: dict[str, Any],
    combine: dict[str, float],
    calibration: dict[str, Any],
    with_encoder: bool,
) -> dict[str, Any]:
    return {
        "format": 1,
        "reference": reference,
        "language": language,
        "layer1": layer1,
        "layer2": {"runtime": "modal", "reference": reference} if with_encoder else None,
        "combine": combine,
        "calibration": calibration,
    }
