"""Le jeu de test de détection reste gelé et ne recoupe jamais le corpus d'entraînement."""

from detection.testset import verify_frozen


def test_jeu_de_test_detection_gele() -> None:
    manifest = verify_frozen()
    assert manifest["version"] == "detection-v1"
    for language in ("fr", "en"):
        assert manifest["documents"][language] == {"ai": 1000, "human": 1000}
