"""Aiguillage de la détection (CLAUDE.md §4.4, ADR-0008).

Décide qui répond selon la langue, la longueur, l'offre, le mode et la confiance de Veritas,
d'après les règles de config/routing.yaml (relues sans redéploiement). Quatre issues :

- Veritas seul : segment promu et Veritas assez confiant ;
- externe seul : cas par défaut en phase 3, avec Veritas en arrière-plan (mode fantôme) ;
- les deux, concordants : le principal répond, l'autre est cité avec l'accord ;
- les deux, discordants : résultat « undetermined », confiance faible.

Quand les deux ont tourné, la comparaison est toujours enregistrée.
"""

import logging
import random
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from functools import partial

from veritas.comparisons import Comparison, ComparisonStore
from veritas.contracts import (
    Confidence,
    DetectEngine,
    DetectOutput,
    Language,
    Mode,
    Plan,
    VerdictBand,
    VeritasDetectRequest,
)
from veritas.engine.model import VeritasModels
from veritas.providers.base import DetectionProvider, ProviderError
from veritas.scoring import Scored, agreement, concordant, score
from veritas.settings import LEVEL_RANK, Routing, Segment, Thresholds
from veritas.shadow import ShadowJob, ShadowQueue
from veritas.text import count_words, detect_language

log = logging.getLogger("veritas.router")


class TextTooShortError(Exception):
    def __init__(self, min_words: int) -> None:
        super().__init__(f"moins de {min_words} mots")
        self.min_words = min_words


class DetectionUnavailableError(Exception):
    """Ni le fournisseur externe ni Veritas ne peuvent répondre."""


@dataclass
class Router:
    thresholds: Callable[[], Thresholds]
    routing: Callable[[], Routing]
    externals: Sequence[DetectionProvider]
    veritas: VeritasModels
    store: ComparisonStore | None = None
    shadow: ShadowQueue | None = None
    sample: Callable[[], float] = field(default=random.random)

    def detect(self, request: VeritasDetectRequest) -> DetectOutput:
        text = request.text
        thresholds, routing = self.thresholds(), self.routing()
        words = count_words(text)
        if words < thresholds.min_words:
            raise TextTooShortError(thresholds.min_words)
        language = (
            detect_language(text)
            if request.language in (None, Language.auto)
            else str(request.language.value)
        )
        plan = (request.plan or Plan.free).value
        segment = routing.segment_for(language, words, plan)
        serve = "both" if request.mode == Mode.deep else segment.serve
        if not self.veritas.available(language):
            serve = "external"

        external = partial(self._external, text, language, thresholds)
        veritas = partial(self._veritas, text, language, thresholds)

        if serve == "veritas":
            v = veritas()
            if (
                v is not None
                and LEVEL_RANK[v.output.confidence.value]
                >= LEVEL_RANK[segment.veritas_min_confidence]
            ):
                return v.output
            e = external()
            if e is None or v is None:
                return self._alone(v or e)
            return self._combine(e, v, "external", segment, plan)

        if serve == "both":
            e, v = external(), veritas()
            if e is None or v is None:
                return self._alone(e or v)
            return self._combine(e, v, segment.primary, segment, plan)

        e = external()
        if e is None:
            return self._alone(veritas() if self.veritas.available(language) else None)
        self._maybe_shadow(text, e, segment, language, plan, routing)
        return e.output

    # --- avis ---

    def _external(self, text: str, language: str, thresholds: Thresholds) -> Scored | None:
        for provider in self.externals:
            try:
                return score(provider.detect(text, language), text, language, thresholds)
            except ProviderError as error:
                log.warning("fournisseur %s indisponible : %s", provider.name, error)
        return None

    def _veritas(self, text: str, language: str, thresholds: Thresholds) -> Scored | None:
        try:
            return score(self.veritas.detect(text, language), text, language, thresholds)
        except Exception:
            log.exception("Veritas indisponible pour %s", language)
            return None

    @staticmethod
    def _alone(scored: Scored | None) -> DetectOutput:
        if scored is None:
            raise DetectionUnavailableError
        return scored.output

    # --- deux avis ---

    def _combine(
        self, external: Scored, veritas: Scored, primary: str, segment: Segment, plan: str
    ) -> DetectOutput:
        self._record(Comparison.of("sync", segment.name, plan, external, veritas))
        first, second = (external, veritas) if primary == "external" else (veritas, external)
        engine = DetectEngine(
            primary=first.output.engine.primary,
            secondary=second.output.engine.primary,
            agreement=agreement(external, veritas),
        )
        if concordant(external, veritas):
            return first.output.model_copy(update={"engine": engine})
        return first.output.model_copy(
            update={
                "engine": engine,
                "verdict_band": VerdictBand.undetermined,
                "confidence": Confidence.low,
            }
        )

    def _record(self, comparison: Comparison) -> None:
        if self.store is None:
            return
        try:
            self.store.record(comparison)
        except Exception:
            log.exception("comparaison non enregistrée")

    def _maybe_shadow(
        self,
        text: str,
        external: Scored,
        segment: Segment,
        language: str,
        plan: str,
        routing: Routing,
    ) -> None:
        if (
            self.shadow is None
            or not routing.shadow_enabled
            or not self.veritas.available(language)
            or self.sample() >= routing.shadow_sample_rate
        ):
            return
        try:
            self.shadow.submit(
                text,
                ShadowJob(
                    segment=segment.name,
                    language=language,
                    plan=plan,
                    external_engine=external.output.engine.primary,
                    external_probability=round(external.probability, 4),
                    external_band=external.output.verdict_band.value,
                ),
            )
        except Exception:
            log.exception("comparaison en arrière-plan non mise en file")
