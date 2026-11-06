"""Configuration de Veritas : variables d'environnement et fichiers YAML relus à chaud.

Les seuils (thresholds.yaml) et les règles d'aiguillage (routing.yaml) sont relus dès que le
fichier change : on les modifie sans redéploiement (CLAUDE.md §6).
"""

import os
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import yaml

CONFIG_DIR = Path(os.environ.get("VERITAS_CONFIG_DIR", Path(__file__).parents[2] / "config"))

Serve = Literal["external", "veritas", "both"]
Level = Literal["high", "medium", "low"]
LEVEL_RANK: dict[str, int] = {"low": 0, "medium": 1, "high": 2}


@dataclass(frozen=True, slots=True)
class Thresholds:
    min_words: int
    likely_ai: float
    likely_human: float
    high_margin: float
    medium_margin: float
    min_words_for_high: int

    @classmethod
    def parse(cls, raw: dict[str, Any]) -> "Thresholds":
        bands, confidence = raw["bands"], raw["confidence"]
        thresholds = cls(
            min_words=int(raw["min_words"]),
            likely_ai=float(bands["likely_ai"]),
            likely_human=float(bands["likely_human"]),
            high_margin=float(confidence["high_margin"]),
            medium_margin=float(confidence["medium_margin"]),
            min_words_for_high=int(confidence["min_words_for_high"]),
        )
        if not 0 <= thresholds.likely_human < 0.5 < thresholds.likely_ai <= 1:
            raise ValueError("thresholds.yaml : il faut likely_human < 0,5 < likely_ai")
        if not 0 < thresholds.medium_margin <= thresholds.high_margin <= 0.5:
            raise ValueError("thresholds.yaml : il faut 0 < medium_margin ≤ high_margin ≤ 0,5")
        return thresholds


@dataclass(frozen=True, slots=True)
class Segment:
    name: str
    serve: Serve = "external"
    primary: Literal["external", "veritas"] = "external"
    veritas_min_confidence: Level = "high"
    languages: frozenset[str] | None = None
    plans: frozenset[str] | None = None
    min_words: int | None = None
    max_words: int | None = None

    def matches(self, language: str, words: int, plan: str) -> bool:
        return (
            (self.languages is None or language in self.languages)
            and (self.plans is None or plan in self.plans)
            and (self.min_words is None or words >= self.min_words)
            and (self.max_words is None or words <= self.max_words)
        )

    @classmethod
    def parse(cls, raw: dict[str, Any]) -> "Segment":
        serve = raw.get("serve", "external")
        primary = raw.get("primary", "external")
        level = raw.get("veritas_min_confidence", "high")
        if serve not in ("external", "veritas", "both") or primary not in ("external", "veritas"):
            raise ValueError(f"routing.yaml : segment {raw.get('name')!r} invalide")
        if level not in LEVEL_RANK:
            raise ValueError(f"routing.yaml : veritas_min_confidence {level!r} invalide")
        return cls(
            name=str(raw["name"]),
            serve=serve,
            primary=primary,
            veritas_min_confidence=level,
            languages=frozenset(raw["languages"]) if "languages" in raw else None,
            plans=frozenset(raw["plans"]) if "plans" in raw else None,
            min_words=int(raw["min_words"]) if "min_words" in raw else None,
            max_words=int(raw["max_words"]) if "max_words" in raw else None,
        )


@dataclass(frozen=True, slots=True)
class Routing:
    agreement_threshold: float
    min_comparisons: int
    shadow_enabled: bool
    shadow_sample_rate: float
    segments: tuple[Segment, ...] = field(default_factory=tuple)
    default: Segment = field(default_factory=lambda: Segment(name="other"))

    def segment_for(self, language: str, words: int, plan: str) -> Segment:
        return next((s for s in self.segments if s.matches(language, words, plan)), self.default)

    @classmethod
    def parse(cls, raw: dict[str, Any]) -> "Routing":
        agreement, shadow = raw["agreement"], raw.get("shadow", {})
        routing = cls(
            agreement_threshold=float(agreement["threshold"]),
            min_comparisons=int(agreement["min_comparisons"]),
            shadow_enabled=bool(shadow.get("enabled", False)),
            shadow_sample_rate=float(shadow.get("sample_rate", 1.0)),
            segments=tuple(Segment.parse(s) for s in raw.get("segments", [])),
            default=Segment.parse(raw.get("default", {"name": "other"})),
        )
        if not 0 < routing.agreement_threshold <= 1 or not 0 <= routing.shadow_sample_rate <= 1:
            raise ValueError("routing.yaml : seuil d'accord ou taux d'échantillonnage invalide")
        return routing


class LiveConfig[T]:
    """Fichier YAML relu quand sa date de modification change. Une version invalide est
    refusée : la dernière version valide reste en service."""

    def __init__(self, path: Path, parse: Callable[[dict[str, Any]], T]) -> None:
        self._path = path
        self._parse = parse
        self._lock = threading.Lock()
        self._mtime: float | None = None
        self._value: T | None = None

    def get(self) -> T:
        mtime = self._path.stat().st_mtime
        with self._lock:
            if self._value is None or mtime != self._mtime:
                try:
                    value = self._parse(yaml.safe_load(self._path.read_text(encoding="utf-8")))
                except (KeyError, TypeError, ValueError, yaml.YAMLError):
                    if self._value is None:
                        raise
                else:
                    self._value = value
                self._mtime = mtime
            return self._value


def thresholds_config(directory: Path = CONFIG_DIR) -> LiveConfig[Thresholds]:
    return LiveConfig(directory / "thresholds.yaml", Thresholds.parse)


def routing_config(directory: Path = CONFIG_DIR) -> LiveConfig[Routing]:
    return LiveConfig(directory / "routing.yaml", Routing.parse)


def redis_url() -> str:
    return os.environ.get("REDIS_URL", "redis://localhost:6379")


def database_url() -> str | None:
    return os.environ.get("DATABASE_URL") or None
