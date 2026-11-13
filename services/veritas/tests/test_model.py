import json
from pathlib import Path
from typing import Any

import pytest
from conftest import french_text

from veritas.engine.features import FEATURES, extract
from veritas.engine.modal_encoder import ModalEncoder
from veritas.engine.model import ModelUnavailableError, VeritasModel, VeritasModels


def manifest(**overrides: Any) -> dict[str, Any]:
    n = len(FEATURES)
    base: dict[str, Any] = {
        "format": 1,
        "reference": "VRT-DET-FR-0.1",
        "language": "fr",
        "layer1": {
            "features": list(FEATURES),
            "mean": [0.0] * n,
            "scale": [1.0] * n,
            # Seul le trait « régularité des phrases » compte : phrases très régulières → IA.
            "coef": [0.0, -8.0] + [0.0] * (n - 2),
            "intercept": 1.0,
        },
        "layer2": None,
        "combine": {"layer1": 1.0, "layer2": 0.0, "bias": 0.0},
        "calibration": {"method": "platt", "a": 1.0, "b": 0.0},
    }
    base.update(overrides)
    return base


def test_features_have_expected_shape_and_values() -> None:
    values = extract(["Un deux trois quatre.", "Un deux trois quatre."], "fr")
    assert len(values) == len(FEATURES)
    named = dict(zip(FEATURES, values, strict=True))
    assert named["mean_sentence_words"] == 4
    assert named["sentence_length_cv"] == 0
    assert named["repeated_bigram_ratio"] > 0
    assert extract([], "fr")[0] == 0


def test_model_scores_document_and_each_sentence() -> None:
    model = VeritasModel.from_manifest(manifest())
    text = french_text(320)
    raw = model.detect(text, "fr")
    assert raw.engine == "VRT-DET-FR-0.1"
    assert 0 < raw.probability < 1
    assert len(raw.spans) == text.count(".")
    assert all(0 < s.probability < 1 for s in raw.spans)


def test_regular_text_scores_higher_than_irregular_text() -> None:
    model = VeritasModel.from_manifest(manifest())
    regular = "Un deux trois quatre cinq. " * 6
    irregular = "Un. Un deux trois quatre cinq six sept huit neuf dix onze douze. Deux mots. " * 2
    assert model.detect(regular, "fr").probability > model.detect(irregular, "fr").probability


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"format": 2}, "format"),
        ({"calibration": {"method": "isotonic"}}, "calibration"),
        ({"layer2": {"runtime": "modal"}}, "encodeur"),
    ],
)
def test_invalid_manifests_are_refused(overrides: dict[str, Any], message: str) -> None:
    with pytest.raises(ModelUnavailableError, match=message):
        VeritasModel.from_manifest(manifest(**overrides))


def test_feature_mismatch_is_refused() -> None:
    raw = manifest()
    raw["layer1"]["features"] = ["autre"]
    with pytest.raises(ModelUnavailableError, match="traits"):
        VeritasModel.from_manifest(raw)


def test_models_load_one_package_per_language(tmp_path: Path) -> None:
    (tmp_path / "fr").mkdir()
    (tmp_path / "fr" / "manifest.json").write_text(json.dumps(manifest()))
    (tmp_path / "en").mkdir()
    (tmp_path / "en" / "manifest.json").write_text(
        json.dumps(manifest(language="en", reference="VRT-DET-EN-0.1", layer2={"runtime": "x"}))
    )
    models = VeritasModels.load(tmp_path)
    assert models.available("fr") and not models.available("en")
    assert models.reference("fr") == "VRT-DET-FR-0.1"
    assert models.detect(french_text(200), "fr").engine == "VRT-DET-FR-0.1"
    with pytest.raises(ModelUnavailableError):
        models.detect("x", "en")
    assert not VeritasModels.load(tmp_path / "absent").available("fr")


def test_modal_layer2_is_wired_without_calling_modal(tmp_path: Path) -> None:
    (tmp_path / "fr").mkdir()
    layer2 = {"runtime": "modal", "reference": "VRT-DET-FR-0.1"}
    (tmp_path / "fr" / "manifest.json").write_text(json.dumps(manifest(layer2=layer2)))
    models = VeritasModels.load(tmp_path)
    assert models.available("fr")
    encoder = models._models["fr"].encoder
    assert isinstance(encoder, ModalEncoder) and encoder._reference == "VRT-DET-FR-0.1"


def test_layer2_combines_with_layer1() -> None:
    class Fixed:
        def logits(self, passages: list[str]) -> list[float]:
            return [4.0] * len(passages)

    raw = manifest(combine={"layer1": 0.0, "layer2": 1.0, "bias": 0.0})
    raw["layer2"] = {"runtime": "modal", "reference": "x"}
    model = VeritasModel.from_manifest(raw, Fixed())
    assert model.detect(french_text(200), "fr").probability > 0.98


# Paquets livrés : chargés tels qu'ils sont commités, sans appel à Modal. Français : run v1
# (ADR-0009) ; anglais : run v2 (ADR-0011, portes de sortie franchies).
DELIVERED = Path(__file__).resolve().parents[1] / "models"
DELIVERED_REFERENCES = {"fr": "VRT-DET-FR-0.1", "en": "VRT-DET-EN-0.2"}


@pytest.mark.parametrize("language", ["fr", "en"])
def test_delivered_packages_load(language: str) -> None:
    models = VeritasModels.load(DELIVERED)
    reference = DELIVERED_REFERENCES[language]
    assert models.reference(language) == reference
    encoder = models._models[language].encoder
    assert isinstance(encoder, ModalEncoder) and encoder._reference == reference


@pytest.mark.parametrize("language", ["fr", "en"])
def test_delivered_packages_follow_layer2(language: str) -> None:
    class Fixed:
        def __init__(self, value: float) -> None:
            self.value = value

        def logits(self, passages: list[str]) -> list[float]:
            return [self.value] * len(passages)

    raw = json.loads((DELIVERED / language / "manifest.json").read_text(encoding="utf-8"))
    text = french_text(200)
    ai = VeritasModel.from_manifest(raw, Fixed(10.0)).detect(text, language).probability
    human = VeritasModel.from_manifest(raw, Fixed(-10.0)).detect(text, language).probability
    assert ai > 0.9 and human < 0.1
