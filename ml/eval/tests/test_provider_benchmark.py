"""Banc d'essai fournisseur / Veritas : échantillon, comptage des échecs, accord (sans réseau)."""

import pytest

from detection.provider_benchmark import (
    MAX_CONSECUTIVE_FAILURES,
    Throttle,
    compare,
    pangram_interval,
    sample,
)


def corpus() -> list[dict[str, object]]:
    docs: list[dict[str, object]] = []
    for label in ("human", "ai"):
        for i in range(20):
            docs.append(
                {
                    "id": f"{label}-{i:02}",
                    "label": label,
                    "split": "test",
                    "words": 300,
                    "text": f"{label} {i}",
                }
            )
            docs.append(
                {
                    "id": f"train-{label}-{i:02}",
                    "label": label,
                    "split": "train",
                    "words": 300,
                    "text": "x",
                }
            )
    return docs


def test_sample_is_deterministic_and_test_only() -> None:
    first = sample(corpus(), 5, 3, seed=1)
    assert first == sample(corpus(), 5, 3, seed=1)
    assert [d["label"] for d in first].count("human") == 5
    assert all(d["split"] == "test" for d in first)
    with pytest.raises(ValueError):
        sample(corpus(), 50, 3)


class Band:
    def __init__(self, value: str) -> None:
        self.value = value


class Scored:
    def __init__(self, probability: float) -> None:
        self.probability = probability
        band = (
            "likely_ai"
            if probability >= 0.7
            else "likely_human"
            if probability <= 0.3
            else "undetermined"
        )
        self.output = type("Out", (), {"verdict_band": Band(band)})()


class Fixed:
    """Détecteur qui répond selon l'étiquette contenue dans le texte."""

    def __init__(self, human: float, ai: float, fail_on: str = "") -> None:
        self.human, self.ai, self.fail_on = human, ai, fail_on
        self.calls = 0

    def detect(self, text: str, language: str) -> float:
        self.calls += 1
        if self.fail_on and text == self.fail_on:
            raise RuntimeError("panne")
        return self.ai if text.startswith("ai") else self.human


def run(external: Fixed, veritas: Fixed) -> dict[str, object]:
    docs = sample(corpus(), 10, 4)
    return compare(
        docs,
        "fr",
        external,
        veritas,
        lambda raw, text, lang: Scored(raw),
        workers=2,
        log=lambda _: None,
    )


def test_agreement_and_metrics() -> None:
    report = run(Fixed(0.1, 0.9), Fixed(0.2, 0.95))
    assert report["agreement"] == {"all": 1.0, "human": 1.0, "ai": 1.0, "compared": 14}
    assert report["external"]["false_positive_rate"] == 0.0
    assert report["documents"] == {"human": 10, "ai": 4}
    assert all("text" not in r for r in report["records"])  # aucun texte dans le rapport


def test_disagreement_is_measured_per_label() -> None:
    report = run(Fixed(0.1, 0.9), Fixed(0.8, 0.9))  # Veritas se trompe sur les humains
    assert report["agreement"]["human"] == 0.0 and report["agreement"]["ai"] == 1.0


def test_provider_failure_is_counted_not_retried() -> None:
    docs = sample(corpus(), 10, 4)
    external = Fixed(0.1, 0.9, fail_on=str(docs[0]["text"]))
    report = compare(
        docs, "fr", external, Fixed(0.1, 0.9), lambda raw, t, lang: Scored(raw), log=lambda _: None
    )
    assert report["errors"]["external"] == 1 and external.calls == len(docs)
    assert report["agreement"]["compared"] == len(docs) - 1


def test_stops_when_provider_keeps_failing() -> None:
    class Down(Fixed):
        def detect(self, text: str, language: str) -> float:
            self.calls += 1
            raise RuntimeError("clé refusée")

    docs = sample(corpus(), 20, 5)
    with pytest.raises(RuntimeError, match="arrêt"):
        compare(
            docs,
            "fr",
            Down(0, 0),
            Fixed(0.1, 0.9),
            lambda raw, t, lang: Scored(raw),
            workers=1,
            log=lambda _: None,
        )
    assert MAX_CONSECUTIVE_FAILURES == 10


def test_throttle_spaces_calls() -> None:
    now = [0.0]
    waits: list[float] = []

    def sleep(seconds: float) -> None:
        waits.append(seconds)

    throttle = Throttle(2.0, clock=lambda: now[0], sleep=sleep)
    throttle()
    throttle()
    throttle()
    assert waits == [2.0, 4.0]


def test_pangram_interval_shares_account_limit() -> None:
    assert pangram_interval(2.5, 2) == 1.0  # 2 langues, 2,5 req/s : 1 tâche par seconde chacune
    assert pangram_interval(None, 2) == 0.5
