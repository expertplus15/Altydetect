from dataclasses import replace

import pytest
from conftest import THRESHOLDS, french_text

from veritas.contracts import Confidence, VerdictBand
from veritas.providers.base import Fractions, RawDetection, ScoredSpan
from veritas.scoring import agreement, band_for, concordant, confidence_for, score


@pytest.mark.parametrize(
    ("probability", "band"),
    [
        (0.70, VerdictBand.likely_ai),
        (0.69, VerdictBand.undetermined),
        (0.31, VerdictBand.undetermined),
        (0.30, VerdictBand.likely_human),
    ],
)
def test_bands_follow_thresholds(probability: float, band: VerdictBand) -> None:
    assert band_for(probability, THRESHOLDS) == band


def test_confidence_depends_on_margin_and_length() -> None:
    assert confidence_for(0.9, 400, THRESHOLDS) == Confidence.high
    assert confidence_for(0.9, 200, THRESHOLDS) == Confidence.medium
    assert confidence_for(0.25, 400, THRESHOLDS) == Confidence.medium
    assert confidence_for(0.6, 400, THRESHOLDS) == Confidence.low


def test_sentence_bands_give_word_shares() -> None:
    text = "Une phrase écrite par une machine. Une phrase écrite par une personne."
    raw = RawDetection("x", 0.5, (ScoredSpan(0, 34, 0.95), ScoredSpan(35, len(text), 0.05)))
    out = score(raw, text, "fr", THRESHOLDS).output
    assert [s.band for s in out.sentences] == [VerdictBand.likely_ai, VerdictBand.likely_human]
    assert (out.overall.ai, out.overall.undetermined, out.overall.human) == (0.5, 0.0, 0.5)
    # Probabilité du document à 0,5 : confiance faible, donc jamais de bande tranchée.
    assert out.confidence == Confidence.low
    assert out.verdict_band == VerdictBand.undetermined
    assert out.word_count == 12
    assert out.engine.primary == "x"


def test_sentence_without_span_gets_document_probability() -> None:
    text = french_text(320)
    out = score(RawDetection("x", 0.9), text, "fr", THRESHOLDS).output
    assert {s.score for s in out.sentences} == {0.9}
    assert out.verdict_band == VerdictBand.likely_ai
    assert out.confidence == Confidence.high
    assert out.overall.ai == 1.0


def test_provider_fractions_feed_overall_with_assisted_as_undetermined() -> None:
    raw = RawDetection("pangram", 0.6, fractions=Fractions(ai=0.5, assisted=0.2, human=0.3))
    out = score(raw, french_text(320), "fr", THRESHOLDS).output
    assert (out.overall.ai, out.overall.undetermined, out.overall.human) == (0.5, 0.2, 0.3)


def test_shares_always_sum_to_one() -> None:
    raw = RawDetection("x", 0.6, fractions=Fractions(ai=1, assisted=1, human=1))
    out = score(raw, french_text(320), "fr", THRESHOLDS).output
    assert out.overall.ai + out.overall.undetermined + out.overall.human == pytest.approx(1)


def test_agreement_and_concordance() -> None:
    text = french_text(320)
    a = score(RawDetection("a", 0.9), text, "fr", THRESHOLDS)
    b = score(RawDetection("b", 0.8), text, "fr", THRESHOLDS)
    c = score(RawDetection("c", 0.1), text, "fr", THRESHOLDS)
    assert agreement(a, b) == pytest.approx(0.9)
    assert concordant(a, b) and not concordant(a, c)


def test_model_threshold_applies_to_its_model_only() -> None:
    """ADR-0013 : un modèle Veritas peut avoir son propre seuil « Probablement IA »."""
    thresholds = replace(THRESHOLDS, model_likely_ai={"VRT-DET-FR-0.4": 0.85})
    text = french_text(320)
    veritas = score(RawDetection("VRT-DET-FR-0.4", 0.8), text, "fr", thresholds).output
    assert veritas.verdict_band == VerdictBand.undetermined
    assert {s.band for s in veritas.sentences} == {VerdictBand.undetermined}
    # Les fournisseurs et les autres modèles gardent le seuil général (0,70).
    for engine in ("copyleaks", "VRT-DET-EN-0.2"):
        other = score(RawDetection(engine, 0.8), text, "fr", thresholds).output
        assert other.verdict_band == VerdictBand.likely_ai
    assert thresholds.for_model("copyleaks") is thresholds
    assert thresholds.for_model("VRT-DET-FR-0.4").likely_ai == 0.85
