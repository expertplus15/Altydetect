"""Normalisation : d'un RawDetection à la sortie du contrat (ADR-0008).

Mêmes règles pour Veritas et pour chaque fournisseur, avec les seuils de thresholds.yaml :
- chaque phrase reçoit la probabilité moyenne des passages qui la recouvrent, puis une bande ;
- overall = parts du texte (en mots) par bande, ou parts données par le fournisseur ;
- confidence selon l'écart de la probabilité du document à 0,5 et la longueur du texte ;
- verdict_band selon les seuils, et toujours « undetermined » quand la confiance est faible.
"""

from dataclasses import dataclass

from veritas.contracts import (
    Confidence,
    DetectEngine,
    DetectOutput,
    DetectSignals,
    Humanization,
    Overall,
    SentenceScore,
    VerdictBand,
)
from veritas.providers.base import RawDetection, clamp
from veritas.settings import Thresholds
from veritas.text import Sentence, split_sentences


@dataclass(frozen=True, slots=True)
class Scored:
    """Sortie du contrat, avec la probabilité du document (utile pour comparer deux avis)."""

    output: DetectOutput
    probability: float


def band_for(probability: float, thresholds: Thresholds) -> VerdictBand:
    if probability >= thresholds.likely_ai:
        return VerdictBand.likely_ai
    if probability <= thresholds.likely_human:
        return VerdictBand.likely_human
    return VerdictBand.undetermined


def confidence_for(probability: float, words: int, thresholds: Thresholds) -> Confidence:
    margin = abs(probability - 0.5)
    if margin >= thresholds.high_margin and words >= thresholds.min_words_for_high:
        return Confidence.high
    if margin >= thresholds.medium_margin:
        return Confidence.medium
    return Confidence.low


def _sentence_probability(sentence: Sentence, raw: RawDetection) -> float:
    total = weighted = 0.0
    for span in raw.spans:
        overlap = min(sentence.end, span.end) - max(sentence.start, span.start)
        if overlap > 0:
            total += overlap
            weighted += overlap * clamp(span.probability)
    return weighted / total if total else clamp(raw.probability)


def _rounded_shares(ai: float, undetermined: float, human: float) -> Overall:
    """Parts arrondies au millième, de somme exactement 1."""
    total = ai + undetermined + human
    if total <= 0:
        return Overall(ai=0, undetermined=1, human=0)
    values = [round(v / total, 3) for v in (ai, undetermined, human)]
    largest = values.index(max(values))
    values[largest] = round(values[largest] + 1 - sum(values), 3)
    return Overall(ai=values[0], undetermined=values[1], human=values[2])


def score(raw: RawDetection, text: str, language: str, thresholds: Thresholds) -> Scored:
    sentences = split_sentences(text)
    words = sum(s.words for s in sentences)
    probability = clamp(raw.probability)

    scored: list[SentenceScore] = []
    shares = {band: 0 for band in VerdictBand}
    for sentence in sentences:
        p = _sentence_probability(sentence, raw)
        band = band_for(p, thresholds)
        shares[band] += sentence.words
        scored.append(
            SentenceScore(start=sentence.start, end=sentence.end, score=round(p, 4), band=band)
        )

    if raw.fractions is not None:
        f = raw.fractions
        overall = _rounded_shares(clamp(f.ai), clamp(f.assisted), clamp(f.human))
    else:
        overall = _rounded_shares(
            shares[VerdictBand.likely_ai],
            shares[VerdictBand.undetermined],
            shares[VerdictBand.likely_human],
        )

    confidence = confidence_for(probability, words, thresholds)
    verdict = (
        VerdictBand.undetermined
        if confidence == Confidence.low
        else band_for(probability, thresholds)
    )
    output = DetectOutput(
        overall=overall,
        confidence=confidence,
        verdict_band=verdict,
        language=language,
        sentences=scored,
        signals=DetectSignals(
            probable_model=raw.probable_model,
            # La détection de reformulation (VRT-HUM) arrive en phase 4.
            humanization=Humanization.none,
        ),
        engine=DetectEngine(primary=raw.engine),
        word_count=words,
    )
    return Scored(output=output, probability=probability)


def agreement(a: Scored, b: Scored) -> float:
    """Accord entre deux avis sur le même texte, de 0 à 1."""
    return round(1 - abs(a.probability - b.probability), 4)


def concordant(a: Scored, b: Scored) -> bool:
    """Deux avis concordent quand ils tombent dans la même bande."""
    return a.output.verdict_band == b.output.verdict_band
