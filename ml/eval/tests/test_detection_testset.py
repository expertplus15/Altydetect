"""Le jeu de test de détection reste gelé et ne recoupe jamais le corpus d'entraînement."""

from detection.testset import verify_frozen, verify_frozen_v2


def test_jeu_de_test_detection_gele() -> None:
    manifest = verify_frozen()
    assert manifest["version"] == "detection-v1"
    for language in ("fr", "en"):
        assert manifest["documents"][language] == {"ai": 1000, "human": 1000}


def test_jeu_de_robustesse_detection_v2_gele() -> None:
    manifest = verify_frozen_v2()
    assert manifest["version"] == "detection-v2"
    for language in ("fr", "en"):
        counts = manifest["documents"][language]
        assert counts["human_wikipedia"] == 300 and counts["mixed"] == 100
        assert set(counts) == {
            "ai_mistral",
            "ai_phi",
            "ai_qwen",
            "ai_reformulated",
            "ai_short",
            "human_short",
            "human_wikipedia",
            "mixed",
        }
