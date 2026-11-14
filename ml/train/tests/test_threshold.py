"""Seuil propre à un modèle Veritas, choisi sur la calibration (ADR-0013)."""

import pytest

from train.threshold import TARGET_FALSE_POSITIVE_RATE, choose_threshold, grid


def records(human: list[float], ai: list[float]) -> list[dict]:
    return [
        *({"label": "human", "category": "human_academic", "probability": p} for p in human),
        *({"label": "ai", "category": "ai_open", "probability": p} for p in ai),
        {"label": "mixed", "category": "mixed", "probability": 0.99},
    ]


def test_grid_spans_the_allowed_range() -> None:
    values = grid()
    assert values[0] == 0.70 and values[-1] == 0.90 and len(values) == 21
    assert TARGET_FALSE_POSITIVE_RATE == 0.005


def test_smallest_threshold_meeting_the_target_is_chosen() -> None:
    # 1 000 humains : 5 faux positifs au plus (0,5 %). Six à 0,70, cinq à partir de 0,73.
    human = [0.1] * 994 + [0.72, 0.75, 0.81, 0.83, 0.86, 0.95]
    result = choose_threshold(records(human, [0.97] * 99 + [0.72]))
    assert result["chosen"] == 0.73
    assert result["at_chosen"]["false_positives"] == 5
    assert result["at_chosen"]["recall"] == 0.99
    assert result["humans"] == 1000 and result["ais"] == 100
    assert result["false_positives_by_category"] == {"human_academic": 5}
    assert len(result["grid"]) == 21


def test_no_threshold_when_the_target_cannot_be_met() -> None:
    human = [0.1] * 990 + [0.95] * 10
    result = choose_threshold(records(human, [0.99] * 100))
    assert result["chosen"] is None and result["at_chosen"] is None
    assert result["false_positives_by_category"] == {}


def test_calibration_needs_both_labels() -> None:
    with pytest.raises(ValueError, match="calibration"):
        choose_threshold(records([0.1] * 10, []))
