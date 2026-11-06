import os
from pathlib import Path

import pytest

from veritas.settings import CONFIG_DIR, LiveConfig, Routing, routing_config, thresholds_config


def test_shipped_configuration_is_valid() -> None:
    thresholds = thresholds_config().get()
    routing = routing_config().get()
    assert thresholds.min_words == 150
    assert routing.agreement_threshold == 0.85
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
