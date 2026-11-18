import random

import pytest
from veritas.engine.model import VeritasModel

from train.layers import build_manifest, fit_combination, fit_layer1, layer1_logits
from train.samples import label_of, passages

REGULAR = " ".join("Un deux trois quatre cinq six sept huit." for _ in range(40))
IRREGULAR = " ".join(
    "Oui. Un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze. Bon, "
    "deux mots ici."
    for _ in range(20)
)


def test_passages_contain_document_and_windows() -> None:
    doc = {"text": REGULAR, "label": "ai"}
    out = passages(doc, random.Random(0))
    assert len(out[0]) == 40 and 2 <= len(out) <= 3
    assert all(len(w) <= 4 for w in out[1:])
    assert label_of(doc) == 1 and label_of({"label": "human"}) == 0


def test_layers_learn_a_separable_signal_and_produce_a_valid_package() -> None:
    rng = random.Random(0)
    train = [p for _ in range(15) for p in passages({"text": REGULAR}, rng)] + [
        p for _ in range(15) for p in passages({"text": IRREGULAR}, rng)
    ]
    half = len(train) // 2
    labels = [1] * half + [0] * (len(train) - half)
    layer1 = fit_layer1(train, labels, "fr")
    l1 = layer1_logits(layer1, train, "fr")
    combine, calibration = fit_combination(l1, None, labels)
    manifest = build_manifest("VRT-DET-FR-0.1", "fr", layer1, combine, calibration, False)

    model = VeritasModel.from_manifest(manifest)
    regular = model.detect(REGULAR, "fr").probability
    irregular = model.detect(IRREGULAR, "fr").probability
    assert regular > 0.8 and irregular < 0.2
    assert manifest["layer2"] is None and combine["layer2"] == 0.0


def test_combination_with_layer2_and_modal_reference() -> None:
    l1 = [0.0, 0.1, -0.1, 0.05] * 5
    l2 = [3.0, 2.5, -3.0, -2.0] * 5
    labels = [1, 1, 0, 0] * 5
    combine, _ = fit_combination(l1, l2, labels)
    assert combine["layer2"] > abs(combine["layer1"])
    manifest = build_manifest("VRT-DET-EN-0.1", "en", {"features": []}, combine, {}, True)
    assert manifest["layer2"] == {"runtime": "modal", "reference": "VRT-DET-EN-0.1"}


def test_layer1_needs_two_classes() -> None:
    with pytest.raises(ValueError):
        fit_layer1([[REGULAR]] * 4, [1] * 4, "fr")


def test_encoder_settings_large_only_for_french_0_6() -> None:
    from train.encoder import BASE_MODELS, encoder_settings, optimizer_steps

    large = encoder_settings("v6", "fr")
    assert large.base_model == "almanach/camembert-large"
    assert large.learning_rate == 1e-5
    # Lot effectif inchangé (16) : lots de 8 accumulés sur 2 pas.
    assert large.batch_size * large.accumulation == 16
    for run, language in (("v5", "fr"), ("v2", "en"), ("v6", "en")):
        settings = encoder_settings(run, language)
        assert settings.base_model == BASE_MODELS[language]
        assert (settings.learning_rate, settings.batch_size, settings.accumulation) == (
            2e-5,
            16,
            1,
        )
    # Même nombre de pas de l'optimiseur pour un même lot effectif ; le dernier lot incomplet
    # d'une époque compte pour un pas.
    base = encoder_settings("v5", "fr")
    assert optimizer_steps(65_678, base, 2) == 8_210
    assert optimizer_steps(65_678, large, 2) == 8_210
    assert optimizer_steps(17, large, 1) == 2


def test_pipeline_versions_and_corpus_files() -> None:
    import ast
    from pathlib import Path

    tree = ast.parse((Path(__file__).parents[1] / "pipeline.py").read_text(encoding="utf-8"))
    values = {
        t.id: ast.literal_eval(node.value)
        for node in tree.body
        if isinstance(node, ast.Assign)
        for t in node.targets
        if isinstance(t, ast.Name) and t.id in ("VERSIONS", "CORPUS_V5_FILES", "V2_RUNS")
    }
    assert values["VERSIONS"]["v6"] == "0.6"
    assert "v6" in values["V2_RUNS"]
    # FR 0.6 recopie tout le corpus 0.5, textes difficiles compris.
    assert values["CORPUS_V5_FILES"][-2:] == ["human_v5", "ai_v5"]
    assert len(set(values["CORPUS_V5_FILES"])) == 10
