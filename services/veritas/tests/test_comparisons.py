from conftest import THRESHOLDS, french_text

from veritas.comparisons import Comparison, MemoryComparisonStore, agreement_report
from veritas.providers.base import RawDetection
from veritas.scoring import score
from veritas.settings import Routing

TEXT = french_text(320)
ROUTING = Routing(
    agreement_threshold=0.85, min_comparisons=10, shadow_enabled=True, shadow_sample_rate=1
)


def comparison(external: float, veritas: float, engine: str = "VRT-DET-FR-0.1") -> Comparison:
    return Comparison.of(
        "shadow",
        "fr",
        "free",
        score(RawDetection("pangram", external), TEXT, "fr", THRESHOLDS),
        score(RawDetection(engine, veritas), TEXT, "fr", THRESHOLDS),
    )


def test_comparison_keeps_no_text() -> None:
    c = comparison(0.9, 0.8)
    assert TEXT not in repr(c)
    assert c.concordant and c.word_count >= 320


def test_gate_needs_threshold_and_sample_size() -> None:
    store = MemoryComparisonStore()
    for _ in range(9):
        store.record(comparison(0.9, 0.8))
    report = agreement_report(store, ROUTING)
    [segment] = report.segments
    assert (segment.comparisons, segment.rate, segment.gate_passed) == (9, 1.0, False)

    store.record(comparison(0.9, 0.1))
    store.record(comparison(0.9, 0.85))
    [segment] = agreement_report(store, ROUTING).segments
    # 10 accords sur 11 : 90,9 % ≥ 85 %, échantillon suffisant.
    assert segment.concordant == 10 and segment.gate_passed


def test_gate_fails_under_threshold_and_models_are_measured_separately() -> None:
    store = MemoryComparisonStore()
    for i in range(10):
        store.record(comparison(0.9, 0.8 if i < 8 else 0.1))
        store.record(comparison(0.9, 0.8, engine="VRT-DET-FR-0.2"))
    old, new = agreement_report(store, ROUTING).segments
    assert (old.veritas_engine, old.rate, old.gate_passed) == ("VRT-DET-FR-0.1", 0.8, False)
    assert (new.veritas_engine, new.rate, new.gate_passed) == ("VRT-DET-FR-0.2", 1.0, True)
    assert agreement_report(store, ROUTING).threshold == 0.85
