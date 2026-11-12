"""Adaptateurs fournisseurs : appels HTTP simulés (aucun appel à une API payante)."""

import json
from collections.abc import Callable

import httpx2
import pytest

from veritas.providers import (
    ProviderError,
    ProviderNotConfiguredError,
    external_providers_from_env,
    provider_from_name,
)
from veritas.providers.copyleaks import CopyleaksProvider
from veritas.providers.gptzero import GPTZeroProvider
from veritas.providers.pangram import PangramProvider
from veritas.providers.simulated import SimulatedProvider

TEXT = "Première phrase du texte. Deuxième phrase du texte."

Handler = Callable[[httpx2.Request], httpx2.Response]


def client(handler: Handler) -> httpx2.Client:
    return httpx2.Client(transport=httpx2.MockTransport(handler))


SUCCESS = {
    "stage": "STAGE_SUCCESS",
    "text": TEXT,
    "version": "4.1",
    "fraction_ai": 0.5,
    "fraction_ai_assisted": 0.2,
    "fraction_human": 0.3,
    "windows": [
        {"start_index": 0, "end_index": 25, "ai_assistance_score": 0.9},
        {"start_index": 26, "end_index": 51, "ai_assistance_score": 0.1},
    ],
}


def pangram(handler: Handler, **options: object) -> PangramProvider:
    return PangramProvider("cle-test", client(handler), sleep=lambda _: None, **options)  # type: ignore[arg-type]


def test_pangram_submits_a_task_then_polls_until_success() -> None:
    seen: list[httpx2.Request] = []
    stages = iter([{"task_id": "t1", "stage": "STAGE_PREPROCESSING"}, SUCCESS])

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        if request.method == "POST":
            return httpx2.Response(200, json={"task_id": "t1"})
        return httpx2.Response(200, json=next(stages))

    raw = pangram(handler).detect(TEXT, "fr")
    post, *polls = seen
    assert str(post.url) == "https://text.external-api.pangram.com/task"
    assert post.headers["x-api-key"] == "cle-test"
    assert json.loads(post.content) == {"text": TEXT, "model": "pangram-4"}
    assert [str(r.url) for r in polls] == ["https://text.external-api.pangram.com/task/t1"] * 2
    assert raw.engine == "pangram"
    assert raw.probability == pytest.approx(0.6)
    assert raw.fractions is not None and raw.fractions.assisted == 0.2
    assert [(s.start, s.end, s.probability) for s in raw.spans] == [(0, 25, 0.9), (26, 51, 0.1)]


def test_pangram_drops_windows_when_text_was_normalized() -> None:
    body = {**SUCCESS, "text": TEXT.replace("Première", "Premiere")}

    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.method == "POST":
            return httpx2.Response(200, json={"task_id": "t1"})
        return httpx2.Response(200, json=body)

    raw = pangram(handler).detect(TEXT, "fr")
    assert raw.probability == pytest.approx(0.6) and raw.spans == ()


@pytest.mark.parametrize("status", [401, 402, 403, 422, 429, 503])
def test_pangram_http_error_names_the_status_only(status: int) -> None:
    provider = pangram(lambda _: httpx2.Response(status, json={"detail": TEXT}))
    with pytest.raises(ProviderError, match=f"HTTP {status}") as error:
        provider.detect(TEXT, "fr")
    assert TEXT not in str(error.value)


def test_pangram_failed_task_and_deadline_become_provider_errors() -> None:
    def failed(request: httpx2.Request) -> httpx2.Response:
        if request.method == "POST":
            return httpx2.Response(200, json={"task_id": "t1"})
        return httpx2.Response(200, json={"stage": "STAGE_FAILED"})

    with pytest.raises(ProviderError, match="STAGE_FAILED"):
        pangram(failed).detect(TEXT, "fr")

    def pending(request: httpx2.Request) -> httpx2.Response:
        if request.method == "POST":
            return httpx2.Response(200, json={"task_id": "t1"})
        return httpx2.Response(200, json={"task_id": "t1", "stage": "STAGE_INFERENCE"})

    ticks = iter(range(0, 1000, 10))
    provider = pangram(pending, deadline=45.0, clock=lambda: float(next(ticks)))
    with pytest.raises(ProviderError, match="45 s"):
        provider.detect(TEXT, "fr")


def test_pangram_unexpected_body_becomes_provider_error() -> None:
    provider = pangram(lambda _: httpx2.Response(200, json={"x": 1}))
    with pytest.raises(ProviderError):
        provider.detect(TEXT, "fr")


def test_pangram_model_comes_from_environment() -> None:
    provider = provider_from_name("pangram", {"PANGRAM_API_KEY": "k", "PANGRAM_MODEL": "default"})
    assert isinstance(provider, PangramProvider) and provider._model == "default"
    provider = provider_from_name("pangram", {"PANGRAM_API_KEY": "k"})
    assert isinstance(provider, PangramProvider) and provider._model == "pangram-4"


def test_copyleaks_logs_in_once_and_maps_sections() -> None:
    logins = 0

    def handler(request: httpx2.Request) -> httpx2.Response:
        nonlocal logins
        if request.url.host == "id.copyleaks.com":
            logins += 1
            assert json.loads(request.content) == {"email": "a@b.c", "key": "cle"}
            return httpx2.Response(200, json={"access_token": "jeton"})
        assert request.headers["Authorization"] == "Bearer jeton"
        assert request.url.path.startswith("/v2/writer-detector/alty-")
        assert json.loads(request.content)["language"] == "fr"
        return httpx2.Response(
            200,
            json={
                "summary": {"ai": 0.7, "human": 0.3},
                "results": [
                    {
                        "classification": 2,
                        "probability": 0.95,
                        "matches": [{"text": {"chars": {"starts": [0], "lengths": [25]}}}],
                    },
                    {
                        "classification": 1,
                        "probability": 0.8,
                        "matches": [{"text": {"chars": {"starts": [26], "lengths": [25]}}}],
                    },
                ],
            },
        )

    provider = CopyleaksProvider("a@b.c", "cle", client(handler))
    raw = provider.detect(TEXT, "fr")
    provider.detect(TEXT, "fr")
    assert logins == 1
    assert raw.probability == 0.7
    assert [(s.start, s.end) for s in raw.spans] == [(0, 25), (26, 51)]
    assert raw.spans[0].probability == 0.95
    assert raw.spans[1].probability == pytest.approx(0.2)


def test_copyleaks_forgets_token_after_401() -> None:
    calls: list[str] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        calls.append(request.url.host)
        if request.url.host == "id.copyleaks.com":
            return httpx2.Response(200, json={"access_token": "jeton"})
        return httpx2.Response(401, json={})

    provider = CopyleaksProvider("a@b.c", "cle", client(handler))
    for _ in range(2):
        with pytest.raises(ProviderError):
            provider.detect(TEXT, "en")
    assert calls.count("id.copyleaks.com") == 2


def test_gptzero_places_sentences_in_text() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.headers["x-api-key"] == "cle"
        assert json.loads(request.content)["document"] == TEXT
        return httpx2.Response(
            200,
            json={
                "documents": [
                    {
                        "completely_generated_prob": 0.4,
                        "class_probabilities": {"ai": 0.35, "human": 0.6, "mixed": 0.05},
                        "sentences": [
                            {"sentence": "Première phrase du texte.", "generated_prob": 0.8},
                            {"sentence": "absente", "generated_prob": 0.5},
                            {"sentence": " Deuxième phrase du texte.", "generated_prob": 0.1},
                        ],
                    }
                ]
            },
        )

    raw = GPTZeroProvider("cle", client(handler)).detect(TEXT, "fr")
    assert raw.probability == 0.35
    assert [(s.start, s.end, s.probability) for s in raw.spans] == [(0, 25, 0.8), (26, 51, 0.1)]


def test_simulated_is_deterministic() -> None:
    a = SimulatedProvider().detect(TEXT, "fr")
    assert a == SimulatedProvider().detect(TEXT, "fr")
    assert len(a.spans) == 2 and 0 <= a.probability <= 1


def test_registry_reads_environment() -> None:
    env = {
        "DETECTION_PROVIDER": "pangram",
        "DETECTION_FALLBACK_PROVIDER": "copyleaks",
        "PANGRAM_API_KEY": "k",
        "COPYLEAKS_EMAIL": "a@b.c",
        "COPYLEAKS_API_KEY": "k",
    }
    assert [p.name for p in external_providers_from_env(env)] == ["pangram", "copyleaks"]
    assert external_providers_from_env({}) == []


def test_registry_refuses_missing_key_unknown_name_and_simulated_in_production() -> None:
    with pytest.raises(ProviderNotConfiguredError):
        provider_from_name("gptzero", {})
    with pytest.raises(ProviderNotConfiguredError):
        provider_from_name("autre", {})
    with pytest.raises(ProviderNotConfiguredError):
        provider_from_name("simulated", {})
    with pytest.raises(ProviderNotConfiguredError):
        provider_from_name(
            "simulated", {"VERITAS_ALLOW_SIMULATED": "1", "VERITAS_ENV": "production"}
        )
    assert provider_from_name("simulated", {"VERITAS_ALLOW_SIMULATED": "1"}).name == "simulated"
