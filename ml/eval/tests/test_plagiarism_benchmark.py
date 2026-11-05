"""Le jeu de test plagiat reste gelé et Indexa ne régresse pas (exécuté en CI)."""

from plagiarism.benchmark import run, verify_frozen


def test_jeu_de_test_gele() -> None:
    manifest = verify_frozen()
    assert manifest["version"] == "plagiarism-v1"
    assert manifest["cases"] == 56


def test_pas_de_regression() -> None:
    report = run()
    # Garde-fou de non-régression ; la porte de sortie utilise RECALL_THRESHOLD (à fixer).
    assert report["recall_gate"] >= 0.95
    assert report["false_positive_rate_negatives"] == 0.0
    assert report["precision"] >= 0.95
