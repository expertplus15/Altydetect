"""Banc d'essai d'un fournisseur externe face à Veritas 0.1, sur un échantillon du jeu gelé
`detection-v1` (ADR-0001, condition 2). Usage interne : aucun score n'est montré à un client.

Par langue : N textes humains et M textes générés tirés au hasard (graine fixe) dans la
partition « test » du volume Modal. Chaque texte est noté par le fournisseur et par Veritas
(couche 2 : application Modal déployée), avec les mêmes seuils que la production. Le rapport
ne contient aucun texte : identifiants, probabilités, métriques et accord.

Lancement : workflow « Entraînement Veritas », étape `benchmark` (ml/train/requests/run.json).
"""

import json
import random
import threading
import time
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Protocol

import modal

# Garde-fou de coût : nombre de mots envoyés au fournisseur, toutes langues confondues.
DEFAULT_MAX_WORDS = 600_000
# Arrêt si le fournisseur échoue sur autant d'appels consécutifs (clé refusée, API changée).
MAX_CONSECUTIVE_FAILURES = 10
CORPUS = "/corpus"
RUN = "v1"
REPO = Path(__file__).resolve().parents[3] if modal.is_local() else Path("/root")


class Detector(Protocol):
    def detect(self, text: str, language: str) -> Any: ...


class Throttle:
    """Espace les appels au fournisseur d'au moins `interval` secondes (tous fils confondus)."""

    def __init__(
        self,
        interval: float,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.interval = interval
        self._clock, self._sleep = clock, sleep
        self._lock = threading.Lock()
        self._next = 0.0

    def __call__(self) -> None:
        with self._lock:
            now = self._clock()
            wait = max(0.0, self._next - now)
            self._next = max(now, self._next) + self.interval
        if wait:
            self._sleep(wait)


def pangram_interval(qps_limit: float | None, parallel: int) -> float:
    """Intervalle entre deux tâches pour une langue : la limite du compte (GET /limits) est
    partagée entre les langues traitées en parallèle, avec 25 % de marge."""
    if not qps_limit or qps_limit <= 0:
        return 0.5
    return round(parallel / qps_limit * 1.25, 3)


def sample(
    documents: Sequence[dict[str, Any]], humans: int, ais: int, seed: int = 0
) -> list[dict[str, Any]]:
    """Échantillon déterministe de la partition « test » : `humans` humains, `ais` générés."""
    test = sorted((d for d in documents if d["split"] == "test"), key=lambda d: d["id"])
    rng = random.Random(seed)
    human = [d for d in test if d["label"] == "human"]
    ai = [d for d in test if d["label"] == "ai"]
    if len(human) < humans or len(ai) < ais:
        raise ValueError(f"jeu de test trop petit : {len(human)} humains, {len(ai)} générés")
    return rng.sample(human, humans) + rng.sample(ai, ais)


def compare(
    documents: Sequence[dict[str, Any]],
    language: str,
    external: Detector,
    veritas: Detector,
    score: Callable[[Any, str, str], Any],
    workers: int = 2,
    log: Callable[[str], None] = print,
    throttle: Callable[[], None] = lambda: None,
) -> dict[str, Any]:
    """Note chaque document par les deux moteurs. `score(raw, text, language)` renvoie un
    `Scored` (veritas.scoring). Un échec du fournisseur est compté, pas réessayé."""

    def external_one(document: dict[str, Any]) -> Any:
        try:
            throttle()
            return score(external.detect(document["text"], language), document["text"], language)
        except Exception as error:  # échec compté : jamais de nouvel appel payant
            return error

    results: list[Any] = []
    consecutive = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i, result in enumerate(pool.map(external_one, documents), start=1):
            results.append(result)
            consecutive = consecutive + 1 if isinstance(result, Exception) else 0
            if consecutive >= MAX_CONSECUTIVE_FAILURES:
                raise RuntimeError(f"{language} : fournisseur en échec ({result!r}), arrêt")
            if i % 100 == 0:
                log(f"{language} : {i}/{len(documents)} textes notés par le fournisseur")

    records: list[dict[str, Any]] = []
    for document, ext in zip(documents, results, strict=True):
        record: dict[str, Any] = {"id": document["id"], "label": document["label"]}
        if isinstance(ext, Exception):
            record["external_error"] = type(ext).__name__
        else:
            record["external"] = round(ext.probability, 4)
            record["external_band"] = ext.output.verdict_band.value
        try:
            ver = score(veritas.detect(document["text"], language), document["text"], language)
            record["veritas"] = round(ver.probability, 4)
            record["veritas_band"] = ver.output.verdict_band.value
        except Exception as error:
            record["veritas_error"] = type(error).__name__
        records.append(record)
    return summarize(records, language)


def summarize(records: list[dict[str, Any]], language: str) -> dict[str, Any]:
    from detection.metrics import detection_metrics

    def metrics(engine: str) -> dict[str, Any]:
        rows = [r for r in records if engine in r]
        return detection_metrics(
            [1 if r["label"] == "ai" else 0 for r in rows],
            [r[f"{engine}_band"] for r in rows],
            [r[engine] for r in rows],
        )

    both = [r for r in records if "external" in r and "veritas" in r]

    def agreement(rows: list[dict[str, Any]]) -> float | None:
        if not rows:
            return None
        return round(sum(r["external_band"] == r["veritas_band"] for r in rows) / len(rows), 4)

    return {
        "language": language,
        "documents": {
            "human": sum(r["label"] == "human" for r in records),
            "ai": sum(r["label"] == "ai" for r in records),
        },
        "errors": {
            "external": sum("external_error" in r for r in records),
            "veritas": sum("veritas_error" in r for r in records),
        },
        "external": metrics("external"),
        "veritas": metrics("veritas"),
        # Porte de la phase 3 : même bande pour les deux moteurs (veritas.scoring.concordant).
        "agreement": {
            "all": agreement(both),
            "human": agreement([r for r in both if r["label"] == "human"]),
            "ai": agreement([r for r in both if r["label"] == "ai"]),
            "compared": len(both),
        },
        "records": records,
    }


image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("pydantic==2.14.3", "pyyaml==6.0.3", "httpx2==2.16.0")
    .env({"VERITAS_CONFIG_DIR": "/root/config", "PYTHONPATH": "/root"})
    .add_local_python_source("veritas")
    .add_local_dir(REPO / "ml/eval/detection", "/root/detection")
    .add_local_dir(REPO / "services/veritas/config", "/root/config")
    .add_local_dir(REPO / "services/veritas/models", "/root/models")
)
corpus_volume = modal.Volume.from_name("altydetect-veritas-corpus")
app = modal.App("altydetect-provider-benchmark", image=image)


@app.function(
    volumes={CORPUS: corpus_volume},
    timeout=90 * 60,
    # Créé par le workflow depuis le secret GitHub PANGRAM_API_KEY.
    secrets=[modal.Secret.from_name("altydetect-pangram")],
)
def benchmark(
    provider: str, language: str, humans: int, ais: int, max_words: int, parallel: int
) -> dict[str, Any]:
    import os

    import httpx2
    from veritas.engine.model import VeritasModels
    from veritas.providers import provider_from_name
    from veritas.scoring import score
    from veritas.settings import thresholds_config

    def log(message: str) -> None:
        print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)

    documents = []
    for name in ("human", "ai"):
        with open(f"{CORPUS}/{RUN}/{language}/{name}.jsonl", encoding="utf-8") as f:
            documents += [json.loads(line) for line in f if line.strip()]
    chosen = sample(documents, humans, ais)
    words = sum(int(d["words"]) for d in chosen)
    if words > max_words:
        raise RuntimeError(f"{language} : {words} mots, au-delà du plafond de {max_words}")
    log(f"{language} : {len(chosen)} textes, {words} mots envoyés au fournisseur")
    thresholds = thresholds_config().get()
    # Limite de requêtes du compte (lecture gratuite), partagée entre les langues.
    qps = None
    if provider == "pangram":
        response = httpx2.get(
            "https://text.external-api.pangram.com/limits",
            headers={"x-api-key": os.environ["PANGRAM_API_KEY"]},
            timeout=30.0,
        )
        response.raise_for_status()
        qps = response.json().get("qps_limit")
    interval = pangram_interval(qps, parallel)
    log(f"{language} : limite du compte {qps} req/s, une tâche toutes les {interval} s")
    report = compare(
        chosen,
        language,
        provider_from_name(provider, dict(os.environ)),
        VeritasModels.load("/root/models"),
        lambda raw, text, lang: score(raw, text, lang, thresholds),
        log=log,
        throttle=Throttle(interval),
    )
    report["provider"] = provider
    report["words"] = words
    return report


@app.local_entrypoint()
def main(
    provider: str = "pangram",
    languages: str = "fr,en",
    humans: int = 500,
    ais: int = 100,
    max_words: int = DEFAULT_MAX_WORDS,
    out: str = "ml/train/out",
) -> None:
    langs = languages.split(",")
    # Estimation avant tout appel : 1 000 textes de test font en moyenne ≈ 450 mots.
    estimate = len(langs) * (humans + ais) * 450
    if estimate > max_words:
        raise SystemExit(f"≈ {estimate} mots prévus, au-delà du plafond de {max_words}")
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    # Plafond réparti entre les langues, vérifié sur les mots réels avant tout appel.
    per_language = max_words // len(langs)
    reports = benchmark.starmap(
        [(provider, lang, humans, ais, per_language, len(langs)) for lang in langs]
    )
    for lang, report in zip(langs, reports, strict=True):
        (out_dir / f"benchmark-{provider}-detection-v1-{lang}.json").write_text(
            json.dumps(report, indent=1) + "\n", encoding="utf-8"
        )
        summary = {k: v for k, v in report.items() if k != "records"}
        print(json.dumps(summary, indent=1), flush=True)
