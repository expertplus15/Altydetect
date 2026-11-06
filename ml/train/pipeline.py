"""Chaîne d'entraînement de Veritas VRT-DET-FR/EN-0.1 sur Modal (ADR-0008, ADR-0009).

Étapes, par langue :
1. corpus humain : pages C4 / mC4 nettoyées (fragment 0 : entraînement et calibration,
   fragment 1 : jeu de test gelé) ;
2. corpus IA : un texte généré par Claude par texte humain (API Message Batches) ;
3. entraînement : couche 1 (CPU), couche 2 (GPU L4, à la demande), couche 3 (calibration) ;
4. évaluation sur le jeu de test gelé, puis paquet versionné écrit dans le volume des modèles.

Les textes ne quittent jamais les volumes Modal ; ce script rapporte seulement les manifestes
(empreintes, sources, licences), le paquet du modèle et les métriques, dans --out.

Lancement (GitHub Actions, .github/workflows/veritas-train.yml) :
    modal run ml/train/pipeline.py --stage all --languages fr,en --out ml/train/out
"""

import json
import os
import random
import time
from pathlib import Path
from typing import Any

import modal

# Côté conteneur, ce fichier est dans /root : le dépôt n'existe que côté lanceur.
REPO = Path(__file__).resolve().parents[2] if modal.is_local() else Path("/root")
CORPUS = "/corpus"
MODELS = "/models"
REFERENCES = {"fr": "VRT-DET-FR-0.1", "en": "VRT-DET-EN-0.1"}
TESTSET = "detection-v1"
# « v1 » : corpus et modèles 0.1 ; tout autre nom (« pilot ») est isolé : corpus à part,
# références suffixées, jeu de test v1 intact.
MAIN_RUN = "v1"


def reference_for(language: str, run: str) -> str:
    base = REFERENCES[language]
    return base if run == MAIN_RUN else f"{base}-{run}"


image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "torch==2.8.0",
        "transformers==4.57.1",
        "sentencepiece==0.2.1",
        "protobuf==6.33.0",
        "scikit-learn==1.7.2",
        "numpy==2.3.4",
        "anthropic==2.6.0",
        "pydantic==2.14.3",
        "pyyaml==6.0.3",
        "httpx2==2.16.0",
    )
    .env({"VERITAS_CONFIG_DIR": "/root/config", "PYTHONPATH": "/root"})
    .add_local_python_source("veritas")
    .add_local_dir(REPO / "ml/corpus/corpus", "/root/corpus")
    .add_local_dir(REPO / "ml/train/train", "/root/train")
    .add_local_dir(REPO / "ml/eval/detection", "/root/detection")
    .add_local_dir(REPO / "services/veritas/config", "/root/config")
)
corpus_volume = modal.Volume.from_name("altydetect-veritas-corpus", create_if_missing=True)
models_volume = modal.Volume.from_name("altydetect-veritas-models", create_if_missing=True)
app = modal.App("altydetect-veritas-train", image=image)


def _read(path: str) -> list[dict[str, Any]]:
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _write(path: str, documents: list[dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for document in documents:
            f.write(json.dumps(document, ensure_ascii=False) + "\n")


@app.function(volumes={CORPUS: corpus_volume}, timeout=3 * 3600, cpu=2)
def build_human(run: str, language: str, train_size: int, test_size: int) -> dict[str, Any]:
    """Textes humains. Le jeu de test, une fois écrit, n'est plus jamais régénéré (gelé)."""
    import urllib.request

    from corpus.human import collect, iter_records
    from corpus.manifest import assign_split
    from corpus.sources import SOURCES

    source = SOURCES[language]
    path = f"{CORPUS}/{run}/{language}/human.jsonl"
    existing = _read(path)
    frozen = [d for d in existing if d["split"] == "test"]
    documents = [d for d in existing if d["split"] != "test"]

    plan = [(source.train_shard, train_size, False, documents)]
    if not frozen:
        plan.append((source.test_shard, test_size, True, frozen))
    for shard, size, is_test, target in plan:
        if len(target) >= size:
            continue
        with urllib.request.urlopen(source.url(shard), timeout=120) as response:
            collected = collect(iter_records(response), source, shard, size)
        target.clear()
        for document in collected:
            document["split"] = assign_split(document, test=is_test)
            target.append(document)
    _write(path, documents + frozen)
    corpus_volume.commit()
    return {"language": language, "train_calibration": len(documents), "test": len(frozen)}


@app.function(
    volumes={CORPUS: corpus_volume},
    timeout=24 * 3600,
    # Créé par le workflow depuis le secret GitHub ANTHROPIC_API_KEY (ADR-0009).
    secrets=[modal.Secret.from_name("altydetect-anthropic")],
)
def generate_ai(run: str, language: str, model: str) -> dict[str, Any]:
    """Un texte généré par texte humain qui n'en a pas encore, par lot (reprise possible :
    l'identifiant du lot en cours est gardé dans le volume)."""
    import anthropic
    from corpus.generate import ai_document, batch_request
    from corpus.manifest import assign_split

    client = anthropic.Anthropic()
    humans = {d["id"]: d for d in _read(f"{CORPUS}/{run}/{language}/human.jsonl")}
    ai_path = f"{CORPUS}/{run}/{language}/ai.jsonl"
    ai = _read(ai_path)
    done = {d["paired_with"] for d in ai}
    state_path = f"{CORPUS}/{run}/{language}/batch.json"

    if os.path.exists(state_path):
        with open(state_path, encoding="utf-8") as f:
            batch_id = json.load(f)["batch_id"]
    else:
        todo = [h for h in humans.values() if h["id"] not in done]
        if not todo:
            return {"language": language, "ai": len(ai), "submitted": 0}
        batch = client.messages.batches.create(
            requests=[batch_request(h, model) for h in todo]  # type: ignore[misc]
        )
        batch_id = batch.id
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump({"batch_id": batch_id, "requests": len(todo)}, f)
        corpus_volume.commit()

    while client.messages.batches.retrieve(batch_id).processing_status != "ended":
        time.sleep(60)
    failed = 0
    for result in client.messages.batches.results(batch_id):
        human = humans.get(result.custom_id.replace("a-", "h-", 1))
        if result.result.type != "succeeded" or human is None:
            failed += 1
            continue
        message = result.result.message
        text = "".join(b.text for b in message.content if b.type == "text")
        document = ai_document(result.custom_id, text, human, model)
        if document is None or human["id"] in done:
            failed += 1
            continue
        document["split"] = assign_split(document, test=human["split"] == "test")
        ai.append(document)
        done.add(human["id"])
    _write(ai_path, ai)
    os.remove(state_path)
    corpus_volume.commit()
    return {"language": language, "ai": len(ai), "failed": failed, "batch_id": batch_id}


@app.function(volumes={CORPUS: corpus_volume}, timeout=600)
def manifests(run: str, language: str) -> list[dict[str, Any]]:
    """Manifeste du corpus (sans texte) : à commiter."""
    from corpus.manifest import manifest_entries

    base = f"{CORPUS}/{run}/{language}"
    documents = _read(f"{base}/human.jsonl") + _read(f"{base}/ai.jsonl")
    return manifest_entries(documents)


@app.function(
    volumes={CORPUS: corpus_volume, MODELS: models_volume},
    gpu="L4",
    timeout=4 * 3600,
)
def train(run: str, language: str, use_encoder: bool = True, seed: int = 0) -> dict[str, Any]:
    """Couches 1 à 3, puis évaluation sur le jeu de test gelé. Écrit le paquet dans le volume."""
    from detection.metrics import detection_metrics
    from veritas.engine.model import VeritasModel
    from veritas.engine.torch_encoder import TorchEncoder
    from veritas.scoring import score
    from veritas.settings import thresholds_config

    from train.encoder import fine_tune
    from train.layers import build_manifest, fit_combination, fit_layer1, layer1_logits
    from train.samples import label_of, passages

    reference = reference_for(language, run)
    base = f"{CORPUS}/{run}/{language}"
    documents = _read(f"{base}/human.jsonl") + _read(f"{base}/ai.jsonl")
    split = {
        name: [d for d in documents if d["split"] == name]
        for name in ("train", "calibration", "test")
    }
    rng = random.Random(seed)

    def expand(docs: list[dict[str, Any]]) -> tuple[list[list[str]], list[int]]:
        xs, ys = [], []
        for d in docs:
            for p in passages(d, rng):
                xs.append(p)
                ys.append(label_of(d))
        return xs, ys

    train_x, train_y = expand(split["train"])
    calib_x, calib_y = expand(split["calibration"])
    layer1 = fit_layer1(train_x, train_y, language)

    out_dir = f"{MODELS}/{reference}"
    encoder_info: dict[str, Any] | None = None
    encoder: TorchEncoder | None = None
    if use_encoder:
        encoder_info = fine_tune(
            language,
            [(" ".join(p), y) for p, y in zip(train_x, train_y, strict=True)],
            f"{out_dir}/encoder",
            seed=seed,
        )
        encoder = TorchEncoder(f"{out_dir}/encoder")

    l1 = layer1_logits(layer1, calib_x, language)
    l2 = encoder.logits([" ".join(p) for p in calib_x]) if encoder else None
    combine, calibration = fit_combination(l1, l2, calib_y)
    manifest = build_manifest(
        reference, language, layer1, combine, calibration, encoder is not None
    )
    os.makedirs(out_dir, exist_ok=True)
    with open(f"{out_dir}/manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    models_volume.commit()

    model = VeritasModel.from_manifest(manifest, encoder)
    thresholds = thresholds_config().get()
    labels, bands, scores = [], [], []
    started = time.perf_counter()
    for d in split["test"]:
        scored = score(model.detect(d["text"], language), d["text"], language, thresholds)
        labels.append(label_of(d))
        bands.append(scored.output.verdict_band.value)
        scores.append(scored.probability)
    latency = (time.perf_counter() - started) / max(len(split["test"]), 1)
    report = {
        "reference": reference,
        "testset": f"{TESTSET}/{language}" if run == MAIN_RUN else f"{run}/{language}",
        "sizes": {k: len(v) for k, v in split.items()},
        "metrics": detection_metrics(labels, bands, scores),
        "latency_seconds_per_document_gpu": round(latency, 4),
        "encoder": encoder_info,
        "thresholds": {"likely_ai": thresholds.likely_ai, "likely_human": thresholds.likely_human},
    }
    return {"manifest": manifest, "report": report}


@app.local_entrypoint()
def main(
    stage: str = "all",
    run: str = MAIN_RUN,
    languages: str = "fr,en",
    train_size: int = 4400,
    test_size: int = 1000,
    use_encoder: bool = True,
    out: str = "ml/train/out",
) -> None:
    import sys

    sys.path.insert(0, str(REPO / "ml/corpus"))
    from corpus.generate import read_llm_model

    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    model = read_llm_model(REPO)
    for language in languages.split(","):
        if stage in ("corpus", "all"):
            print(build_human.remote(run, language, train_size, test_size))
            print(generate_ai.remote(run, language, model))
            entries = manifests.remote(run, language)
            (out_dir / f"corpus-{language}.json").write_text(
                json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
            )
        if stage in ("train", "all"):
            result = train.remote(run, language, use_encoder)
            reference = reference_for(language, run)
            (out_dir / reference).mkdir(exist_ok=True)
            (out_dir / reference / "manifest.json").write_text(
                json.dumps(result["manifest"], indent=2) + "\n", encoding="utf-8"
            )
            (out_dir / f"report-{TESTSET}-{reference}.json").write_text(
                json.dumps(result["report"], indent=2) + "\n", encoding="utf-8"
            )
            print(json.dumps(result["report"]["metrics"], indent=2))
