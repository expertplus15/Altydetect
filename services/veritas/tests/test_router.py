"""Aiguillage : les quatre cas de CLAUDE.md §9 (Veritas seul, externe seul, deux avis
concordants, deux avis discordants), plus repli, mode fantôme et erreurs."""

from dataclasses import replace

import pytest
from conftest import THRESHOLDS, FixedProvider, french_text

from veritas.comparisons import MemoryComparisonStore
from veritas.contracts import Confidence, Language, Mode, Plan, VerdictBand, VeritasDetectRequest
from veritas.engine.model import ModelUnavailableError, VeritasModels
from veritas.providers.base import ProviderError, RawDetection
from veritas.router import DetectionUnavailableError, Router, TextTooShortError
from veritas.settings import Routing, Segment
from veritas.shadow import ShadowJob

TEXT = french_text(320)


class FakeVeritas(VeritasModels):
    def __init__(self, probability: float | None, languages: tuple[str, ...] = ("fr",)) -> None:
        super().__init__()
        self.inner = FixedProvider("VRT-DET-FR-0.1", probability or 0.0)
        self.languages = languages if probability is not None else ()
        self.calls = 0

    def available(self, language: str) -> bool:
        return language in self.languages

    def detect(self, text: str, language: str) -> RawDetection:
        if not self.available(language):
            raise ModelUnavailableError(language)
        self.calls += 1
        return self.inner.detect(text, language)


class FakeShadow:
    def __init__(self) -> None:
        self.jobs: list[tuple[str, ShadowJob]] = []

    def submit(self, text: str, job: ShadowJob) -> None:
        self.jobs.append((text, job))


def routing(serve: str = "external", **segment: object) -> Routing:
    fr = Segment(name="fr", serve=serve, languages=frozenset({"fr"}))  # type: ignore[arg-type]
    return Routing(
        agreement_threshold=0.85,
        min_comparisons=10,
        shadow_enabled=True,
        shadow_sample_rate=1.0,
        segments=(replace(fr, **segment),),  # type: ignore[arg-type]
    )


def make(
    rules: Routing,
    externals: list[FixedProvider],
    veritas: FakeVeritas,
    sample: float = 0.0,
) -> tuple[Router, MemoryComparisonStore, FakeShadow]:
    store, shadow = MemoryComparisonStore(), FakeShadow()
    router = Router(
        thresholds=lambda: THRESHOLDS,
        routing=lambda: rules,
        externals=externals,
        veritas=veritas,
        store=store,
        shadow=shadow,
        sample=lambda: sample,
    )
    return router, store, shadow


def request(text: str = TEXT, **fields: object) -> VeritasDetectRequest:
    return VeritasDetectRequest(text=text, **fields)  # type: ignore[arg-type]


# --- Les quatre cas ---


def test_veritas_alone_when_segment_promoted_and_confident() -> None:
    external = FixedProvider("pangram", 0.9)
    router, store, shadow = make(routing("veritas"), [external], FakeVeritas(0.95))
    out = router.detect(request())
    assert out.engine.primary == "VRT-DET-FR-0.1"
    assert out.engine.secondary is None
    assert out.verdict_band == VerdictBand.likely_ai
    assert external.calls == 0
    assert store.items == [] and shadow.jobs == []


def test_external_alone_by_default_with_shadow_comparison_queued() -> None:
    veritas = FakeVeritas(0.1)
    router, store, shadow = make(routing("external"), [FixedProvider("pangram", 0.9)], veritas)
    out = router.detect(request(plan=Plan.pro))
    assert out.engine.primary == "pangram"
    assert out.verdict_band == VerdictBand.likely_ai
    assert veritas.calls == 0  # Veritas tourne en arrière-plan, pas pendant la requête
    assert store.items == []
    [(text, job)] = shadow.jobs
    assert text == TEXT
    assert (job.segment, job.language, job.plan, job.external_engine) == (
        "fr",
        "fr",
        "pro",
        "pangram",
    )
    assert job.external_band == "likely_ai"


def test_both_concordant_primary_answers_and_comparison_is_recorded() -> None:
    router, store, _ = make(routing("both"), [FixedProvider("pangram", 0.9)], FakeVeritas(0.8))
    out = router.detect(request())
    assert out.engine.primary == "pangram"
    assert out.engine.secondary == "VRT-DET-FR-0.1"
    assert out.engine.agreement == pytest.approx(0.9)
    assert out.verdict_band == VerdictBand.likely_ai
    assert out.confidence == Confidence.high
    [comparison] = store.items
    assert comparison.concordant and comparison.source == "sync"
    assert comparison.external_band == comparison.veritas_band == "likely_ai"


def test_both_discordant_gives_undetermined_with_low_confidence() -> None:
    router, store, _ = make(routing("both"), [FixedProvider("pangram", 0.9)], FakeVeritas(0.1))
    out = router.detect(request())
    assert out.verdict_band == VerdictBand.undetermined
    assert out.confidence == Confidence.low
    assert out.engine.agreement == pytest.approx(0.2)
    [comparison] = store.items
    assert not comparison.concordant
    assert (comparison.external_band, comparison.veritas_band) == ("likely_ai", "likely_human")


# --- Variantes ---


def test_both_can_put_veritas_first() -> None:
    rules = routing("both", primary="veritas")
    router, _, _ = make(rules, [FixedProvider("pangram", 0.9)], FakeVeritas(0.8))
    out = router.detect(request())
    assert (out.engine.primary, out.engine.secondary) == ("VRT-DET-FR-0.1", "pangram")


def test_unconfident_veritas_asks_external_which_becomes_primary() -> None:
    rules = routing("veritas", veritas_min_confidence="high")
    router, store, _ = make(rules, [FixedProvider("pangram", 0.85)], FakeVeritas(0.75))
    out = router.detect(request())
    assert (out.engine.primary, out.engine.secondary) == ("pangram", "VRT-DET-FR-0.1")
    assert len(store.items) == 1


def test_deep_mode_always_asks_both() -> None:
    router, store, shadow = make(
        routing("external"), [FixedProvider("pangram", 0.9)], FakeVeritas(0.9)
    )
    out = router.detect(request(mode=Mode.deep))
    assert out.engine.secondary == "VRT-DET-FR-0.1"
    assert len(store.items) == 1 and shadow.jobs == []


def test_fallback_provider_answers_when_primary_fails() -> None:
    failing = FixedProvider("pangram", 0.9, ProviderError("panne"))
    router, _, _ = make(
        routing("external"), [failing, FixedProvider("copyleaks", 0.2)], FakeVeritas(None)
    )
    assert router.detect(request()).engine.primary == "copyleaks"
    assert failing.calls == 1


def test_veritas_answers_when_every_external_fails_if_fallback_enabled() -> None:
    failing = FixedProvider("pangram", 0.9, ProviderError("panne"))
    rules = replace(routing("external"), veritas_fallback=True)
    router, _, shadow = make(rules, [failing], FakeVeritas(0.1))
    out = router.detect(request())
    assert out.engine.primary == "VRT-DET-FR-0.1"
    assert shadow.jobs == []


def test_phase_3_veritas_never_answers_alone_when_external_fails() -> None:
    failing = FixedProvider("pangram", 0.9, ProviderError("panne"))
    veritas = FakeVeritas(0.1)
    router, store, shadow = make(routing("external"), [failing], veritas)
    with pytest.raises(DetectionUnavailableError):
        router.detect(request())
    with pytest.raises(DetectionUnavailableError):
        router.detect(request(mode=Mode.deep))
    # Ni appel GPU inutile, ni comparaison, ni tâche fantôme.
    assert veritas.calls == 0 and store.items == [] and shadow.jobs == []


def test_unavailable_when_nobody_can_answer() -> None:
    failing = FixedProvider("pangram", 0.9, ProviderError("panne"))
    router, _, _ = make(routing("external"), [failing], FakeVeritas(None))
    with pytest.raises(DetectionUnavailableError):
        router.detect(request())


def test_language_without_veritas_model_goes_external_even_if_segment_says_veritas() -> None:
    english = "The results show a clear improvement in pupils' work over the year. " * 30
    router, _, shadow = make(routing("veritas"), [FixedProvider("pangram", 0.2)], FakeVeritas(0.9))
    out = router.detect(request(english))
    assert out.language == "en"
    assert out.engine.primary == "pangram"
    assert shadow.jobs == []  # aucun modèle anglais : rien à comparer


def test_requested_language_overrides_detection() -> None:
    router, _, _ = make(routing("external"), [FixedProvider("pangram", 0.5)], FakeVeritas(None))
    assert router.detect(request(language=Language.en)).language == "en"


def test_shadow_respects_sample_rate_and_switch() -> None:
    half = replace(routing("external"), shadow_sample_rate=0.5)
    router, _, shadow = make(half, [FixedProvider("pangram", 0.9)], FakeVeritas(0.9), sample=0.6)
    router.detect(request())
    assert shadow.jobs == []
    off = replace(routing("external"), shadow_enabled=False)
    router, _, shadow = make(off, [FixedProvider("pangram", 0.9)], FakeVeritas(0.9))
    router.detect(request())
    assert shadow.jobs == []


def test_text_too_short_never_scores() -> None:
    external = FixedProvider("pangram", 0.9)
    router, _, _ = make(routing("external"), [external], FakeVeritas(None))
    with pytest.raises(TextTooShortError) as error:
        router.detect(request(french_text(20)))
    assert error.value.min_words == 150
    assert external.calls == 0


def test_store_failure_does_not_break_the_answer() -> None:
    router, store, _ = make(routing("both"), [FixedProvider("pangram", 0.9)], FakeVeritas(0.9))

    def broken(_: object) -> None:
        raise RuntimeError("base indisponible")

    store.record = broken  # type: ignore[method-assign,assignment]
    assert router.detect(request()).engine.secondary == "VRT-DET-FR-0.1"
