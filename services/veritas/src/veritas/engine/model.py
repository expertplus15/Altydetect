"""Modèles Veritas : paquet versionné, couches 1 à 3, une instance par langue (ADR-0008).

Un paquet est un dossier VERITAS_MODEL_DIR/<langue>/ avec un manifest.json :

    {
      "format": 1,
      "reference": "VRT-DET-FR-0.1",
      "language": "fr",
      "layer1": {"features": [...], "mean": [...], "scale": [...], "coef": [...],
                 "intercept": 0.0},
      "layer2": null | {"runtime": "modal", "app": "...", "function": "..."},
      "combine": {"layer1": 1.0, "layer2": 0.0, "bias": 0.0},
      "calibration": {"method": "platt", "a": 1.0, "b": 0.0}
    }

Sans paquet pour une langue, Veritas est indisponible pour cette langue.
"""

import json
import math
import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from veritas.engine.features import FEATURES, extract
from veritas.providers.base import RawDetection, ScoredSpan
from veritas.text import split_sentences

MANIFEST_FORMAT = 1


class Encoder(Protocol):
    """Couche 2 : encodeur affiné. Rend un logit par passage (positif = plutôt IA)."""

    def logits(self, passages: list[str]) -> list[float]: ...


class ModelUnavailableError(RuntimeError):
    """Aucun modèle Veritas pour cette langue, ou paquet invalide."""


def _sigmoid(z: float) -> float:
    if z >= 0:
        return 1 / (1 + math.exp(-z))
    e = math.exp(z)
    return e / (1 + e)


@dataclass(frozen=True, slots=True)
class Layer1:
    mean: tuple[float, ...]
    scale: tuple[float, ...]
    coef: tuple[float, ...]
    intercept: float

    def logit(self, features: list[float]) -> float:
        return self.intercept + sum(
            c * (x - m) / (s or 1.0)
            for c, x, m, s in zip(self.coef, features, self.mean, self.scale, strict=True)
        )


@dataclass(frozen=True, slots=True)
class VeritasModel:
    reference: str
    language: str
    layer1: Layer1
    weight1: float
    weight2: float
    bias: float
    platt_a: float
    platt_b: float
    encoder: Encoder | None = None

    @property
    def name(self) -> str:
        return self.reference

    def _probabilities(self, passages: list[list[str]]) -> list[float]:
        l1 = [self.layer1.logit(extract(p, self.language)) for p in passages]
        l2 = (
            self.encoder.logits([" ".join(p) for p in passages])
            if self.encoder is not None and self.weight2
            else [0.0] * len(passages)
        )
        return [
            _sigmoid(
                self.platt_a * (self.weight1 * a + self.weight2 * b + self.bias) + self.platt_b
            )
            for a, b in zip(l1, l2, strict=True)
        ]

    def detect(self, text: str, language: str) -> RawDetection:
        sentences = split_sentences(text)
        chunks = [text[s.start : s.end] for s in sentences]
        # Chaque phrase est notée avec ses voisines : les traits de régularité ont besoin de
        # plusieurs phrases. Le document entier est le dernier passage.
        windows = [chunks[max(0, i - 1) : i + 2] for i in range(len(chunks))]
        probabilities = self._probabilities([*windows, chunks])
        spans = tuple(
            ScoredSpan(s.start, s.end, p)
            for s, p in zip(sentences, probabilities[:-1], strict=True)
        )
        return RawDetection(self.reference, probabilities[-1], spans)

    @classmethod
    def from_manifest(
        cls, raw: Mapping[str, Any], encoder: Encoder | None = None
    ) -> "VeritasModel":
        if raw.get("format") != MANIFEST_FORMAT:
            raise ModelUnavailableError("format de paquet inconnu")
        layer1 = raw["layer1"]
        if tuple(layer1["features"]) != FEATURES:
            raise ModelUnavailableError("traits de la couche 1 différents de ceux du code")
        if raw.get("layer2") is not None and encoder is None:
            raise ModelUnavailableError("couche 2 demandée mais aucun encodeur fourni")
        calibration = raw["calibration"]
        if calibration.get("method") != "platt":
            raise ModelUnavailableError("méthode de calibration inconnue")
        combine = raw.get("combine", {})
        return cls(
            reference=str(raw["reference"]),
            language=str(raw["language"]),
            layer1=Layer1(
                mean=tuple(map(float, layer1["mean"])),
                scale=tuple(map(float, layer1["scale"])),
                coef=tuple(map(float, layer1["coef"])),
                intercept=float(layer1["intercept"]),
            ),
            weight1=float(combine.get("layer1", 1.0)),
            weight2=float(combine.get("layer2", 0.0)),
            bias=float(combine.get("bias", 0.0)),
            platt_a=float(calibration["a"]),
            platt_b=float(calibration["b"]),
            encoder=encoder,
        )


class VeritasModels:
    """Modèles chargés, par langue."""

    def __init__(self, models: Mapping[str, VeritasModel] | None = None) -> None:
        self._models = dict(models or {})

    def available(self, language: str) -> bool:
        return language in self._models

    def reference(self, language: str) -> str | None:
        model = self._models.get(language)
        return model.reference if model else None

    def detect(self, text: str, language: str) -> RawDetection:
        model = self._models.get(language)
        if model is None:
            raise ModelUnavailableError(f"aucun modèle Veritas pour {language!r}")
        return model.detect(text, language)

    @classmethod
    def load(cls, directory: str | Path | None = None) -> "VeritasModels":
        """Charge les paquets de VERITAS_MODEL_DIR (un sous-dossier par langue)."""
        root = directory or os.environ.get("VERITAS_MODEL_DIR")
        models: dict[str, VeritasModel] = {}
        if root and Path(root).is_dir():
            for manifest in sorted(Path(root).glob("*/manifest.json")):
                raw = json.loads(manifest.read_text(encoding="utf-8"))
                if raw.get("layer2") is not None:
                    # L'encodeur Modal arrive avec l'entraînement (étape 6) : paquet ignoré.
                    continue
                model = VeritasModel.from_manifest(raw)
                models[model.language] = model
        return cls(models)
