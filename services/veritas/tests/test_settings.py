import os
from pathlib import Path
from typing import Any

import pytest
import yaml

from veritas.settings import (
    CONFIG_DIR,
    LiveConfig,
    Routing,
    Thresholds,
    routing_config,
    thresholds_config,
)


def test_shipped_configuration_is_valid() -> None:
    thresholds = thresholds_config().get()
    routing = routing_config().get()
    assert thresholds.min_words == 150
    assert routing.agreement_threshold == 0.85
    # Phase 3 : Veritas jamais seul, comparaison sur 10 % des requêtes (ADR-0010).
    assert routing.veritas_fallback is False
    assert routing.shadow_enabled and routing.shadow_sample_rate == 0.1
    assert all(s.serve == "external" for s in (*routing.segments, routing.default))
    assert routing.segment_for("fr", 300, "free").name == "fr"
    assert routing.segment_for("de", 300, "free").name == "other"


def _write(path: Path, threshold: float, mtime: int) -> None:
    path.write_text(
        f"agreement: {{threshold: {threshold}, min_comparisons: 10}}\n"
        "segments:\n  - {name: pro-fr, languages: [fr], plans: [pro], min_words: 300, "
        "serve: veritas, veritas_min_confidence: medium}\n",
        encoding="utf-8",
    )
    os.utime(path, (mtime, mtime))


def test_routing_is_reloaded_without_restart(tmp_path: Path) -> None:
    path = tmp_path / "routing.yaml"
    _write(path, 0.85, 1_000)
    config = LiveConfig(path, Routing.parse)
    routing = config.get()
    assert routing.agreement_threshold == 0.85
    segment = routing.segment_for("fr", 400, "pro")
    assert (segment.name, segment.serve, segment.veritas_min_confidence) == (
        "pro-fr",
        "veritas",
        "medium",
    )
    assert routing.segment_for("fr", 200, "pro").name == "other"
    assert routing.segment_for("fr", 400, "free").name == "other"

    _write(path, 0.9, 2_000)
    assert config.get().agreement_threshold == 0.9


def test_invalid_update_keeps_last_valid_version(tmp_path: Path) -> None:
    path = tmp_path / "routing.yaml"
    _write(path, 0.85, 1_000)
    config = LiveConfig(path, Routing.parse)
    config.get()
    path.write_text("agreement: {threshold: 2, min_comparisons: 1}\n", encoding="utf-8")
    os.utime(path, (3_000, 3_000))
    assert config.get().agreement_threshold == 0.85


def test_invalid_first_version_fails(tmp_path: Path) -> None:
    path = tmp_path / "thresholds.yaml"
    path.write_text((CONFIG_DIR / "thresholds.yaml").read_text().replace("0.70", "0.40"))
    with pytest.raises(ValueError, match="likely_ai"):
        thresholds_config(tmp_path).get()


def test_delivered_model_thresholds() -> None:
    """ADR-0015, ADR-0017 : seuils propres d'EN 0.2 et de FR 0.6 inscrits."""
    raw = yaml.safe_load((CONFIG_DIR / "thresholds.yaml").read_text(encoding="utf-8"))
    assert Thresholds.parse(raw).model_likely_ai == {
        "VRT-DET-EN-0.2": 0.70,
        "VRT-DET-FR-0.6": 0.93,
    }


def _thresholds(models: str) -> dict[str, Any]:
    raw: dict[str, Any] = yaml.safe_load(
        "min_words: 150\nbands: {likely_ai: 0.70, likely_human: 0.30}\n"
        "confidence: {high_margin: 0.35, medium_margin: 0.20, min_words_for_high: 300}\n" + models
    )
    return raw


def test_model_thresholds_are_parsed_and_bounded() -> None:
    """ADR-0013, ADR-0017 : seuil propre à un modèle, entre 0,70 et 0,95."""
    assert Thresholds.parse(_thresholds("")).model_likely_ai == {}
    assert Thresholds.parse(_thresholds("models: {}\n")).model_likely_ai == {}
    parsed = Thresholds.parse(_thresholds("models: {VRT-DET-FR-0.4: {likely_ai: 0.84}}\n"))
    assert parsed.model_likely_ai == {"VRT-DET-FR-0.4": 0.84}
    assert parsed.for_model("VRT-DET-FR-0.4").likely_ai == 0.84
    assert parsed.for_model("VRT-DET-FR-0.4").likely_human == 0.30
    for value in (0.69, 0.96):
        with pytest.raises(ValueError, match=r"VRT-DET-FR-0\.4"):
            Thresholds.parse(_thresholds(f"models: {{VRT-DET-FR-0.4: {{likely_ai: {value}}}}}\n"))
