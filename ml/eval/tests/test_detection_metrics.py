import math

from detection.metrics import auroc, detection_metrics, threshold_for_fpr


def test_metrics_on_a_small_set() -> None:
    labels = [1, 1, 1, 1, 0, 0, 0, 0]
    bands = [
        "likely_ai",
        "likely_ai",
        "undetermined",
        "likely_human",
        "likely_human",
        "likely_human",
        "undetermined",
        "likely_ai",
    ]
    scores = [0.9, 0.8, 0.5, 0.2, 0.1, 0.2, 0.5, 0.75]
    m = detection_metrics(labels, bands, scores)
    assert m["precision"] == 2 / 3 and m["recall"] == 0.5
    assert m["false_positive_rate"] == 0.25 and not m["gate_false_positives_passed"]
    assert m["undetermined_rate"] == {"ai": 0.25, "human": 0.25}


def test_auroc_and_threshold() -> None:
    assert auroc([1, 0], [0.9, 0.1]) == 1.0
    assert auroc([1, 0], [0.5, 0.5]) == 0.5
    assert math.isnan(auroc([1], [0.5]))
    human_scores = [i / 200 for i in range(200)]
    t = threshold_for_fpr([0] * 200, human_scores, 0.01)
    assert sum(s >= t for s in human_scores) <= 2
