"""Chaîne d'entraînement de Veritas VRT-DET-FR/EN sur Modal (ADR-0008, ADR-0009, ADR-0011,
ADR-0012).

Étapes, par langue :
1. corpus humain : pages C4 / mC4 nettoyées (fragment 0 : entraînement et calibration,
   fragment 1 : jeu de test gelé) ;
2. corpus IA : un texte généré par Claude par texte humain (API Message Batches) ;
3. entraînement : couche 1 (CPU), couche 2 (GPU L4, à la demande), couche 3 (calibration) ;
4. évaluation sur le jeu de test gelé, puis paquet versionné écrit dans le volume des modèles.

Run « v2 » (Veritas 0.2, ADR-0011) : le corpus v1 est recopié tel quel (aucun nouvel appel à
Claude), puis enrichi de textes de modèles ouverts, de reformulations et de textes mixtes
(train/corpus_v2.py) ; le modèle est aussi mesuré sur le jeu de robustesse detection-v2,
avec les portes de sortie de l'ADR.

Run « v3 » (Veritas FR 0.3, ADR-0012, français seulement) : le corpus 0.2 français est recopié,
puis enrichi de textes humains de registre soutenu (universitaire, juridique) et d'autant de
textes générés dans ces registres (train/corpus_v3.py) ; leur partition test forme le jeu gelé
detection-v3, mesuré avec detection-v1 et detection-v2.

Les textes ne quittent jamais les volumes Modal ; ce script rapporte seulement les manifestes
(empreintes, sources, licences), le paquet du modèle et les métriques, dans --out.

Lancement (GitHub Actions, .github/workflows/veritas-train.yml) :
    modal run ml/train/pipeline.py --stage all --languages fr,en --out ml/train/out
"""

import json
import os
import random
import time
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any

import modal

# Côté conteneur, ce fichier est dans /root : le dépôt n'existe que côté lanceur.
REPO = Path(__file__).resolve().parents[2] if modal.is_local() else Path("/root")
CORPUS = "/corpus"
MODELS = "/models"
HF_CACHE = "/hf"
REFERENCES = {"fr": "VRT-DET-FR-0.1", "en": "VRT-DET-EN-0.1"}
TESTSET = "detection-v1"
ROBUSTNESS = "detection-v2"
FORMAL = "detection-v3"
# « v1 » : corpus et modèles 0.1 ; « v2 » : modèles 0.2 (ADR-0011) ; « v3 » : modèle français 0.3
# (ADR-0012) ; tout autre nom (« pilot »)
# est isolé : corpus à part, références suffixées, jeu de test v1 intact.
MAIN_RUN = "v1"
VERSIONS = {"v1": "0.1", "v2": "0.2", "v3": "0.3"}
# Lots de génération du corpus 0.2 : 100 consignes, 8 GPU L4 au plus en parallèle.
OPEN_CHUNK = 100
MAX_GPUS = 8


def reference_for(language: str, run: str) -> str:
    if run in VERSIONS:
        return f"VRT-DET-{language.upper()}-{VERSIONS[run]}"
    return f"{REFERENCES[language]}-{run}"


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
        "pyarrow==21.0.0",
    )
    .env(
        {
            "VERITAS_CONFIG_DIR": "/root/config",
            "PYTHONPATH": "/root",
            "HF_HOME": HF_CACHE,
            "HF_HUB_DISABLE_TELEMETRY": "1",
            "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
        }
    )
    .add_local_python_source("veritas")
    .add_local_dir(REPO / "ml/corpus/corpus", "/root/corpus")
    .add_local_dir(REPO / "ml/train/train", "/root/train")
    .add_local_dir(REPO / "ml/eval/detection", "/root/detection")
    .add_local_dir(REPO / "services/veritas/config", "/root/config")
)
corpus_volume = modal.Volume.from_name("altydetect-veritas-corpus", create_if_missing=True)
models_volume = modal.Volume.from_name("altydetect-veritas-models", create_if_missing=True)
# Poids des modèles ouverts (partagé avec le test de robustesse).
hf_volume = modal.Volume.from_name("altydetect-hf-cache", create_if_missing=True)
app = modal.App("altydetect-veritas-train", image=image)


def _log(message: str) -> None:
    """Ligne de suivi horodatée, envoyée tout de suite (journal du lancement GitHub)."""
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


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


# Garde-fous de coût (estimation du 10/11/2026) : délais au plus juste, aucun conteneur gardé
# actif. Le lancement GitHub coupe aussi l'étape au-delà de 120 min (pilote) ou 330 min (v1).
@app.function(volumes={CORPUS: corpus_volume}, timeout=45 * 60, cpu=2)
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
            _log(f"{language} : textes humains déjà présents ({len(target)}, fragment {shard})")
            continue
        _log(f"{language} : collecte de {size} textes humains (fragment {shard})")
        with urllib.request.urlopen(source.url(shard), timeout=120) as response:
            collected = collect(iter_records(response), source, shard, size)
        _log(f"{language} : {len(collected)} textes humains retenus (fragment {shard})")
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
            _log(f"{language} : textes générés déjà présents ({len(ai)})")
            return {"language": language, "ai": len(ai), "submitted": 0}
        batch = client.messages.batches.create(
            requests=[batch_request(h, model) for h in todo]  # type: ignore[misc]
        )
        batch_id = batch.id
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump({"batch_id": batch_id, "requests": len(todo)}, f)
        corpus_volume.commit()
        _log(f"{language} : lot {batch_id} soumis ({len(todo)} demandes)")

    # Attente du lot (le plus souvent moins d'une heure) : un conteneur CPU minimal, une ligne
    # de suivi par minute.
    while True:
        batch = client.messages.batches.retrieve(batch_id)
        counts = batch.request_counts
        _log(
            f"{language} : lot {batch.processing_status}, {counts.succeeded} réussies, "
            f"{counts.processing} en cours, {counts.errored} en erreur"
        )
        if batch.processing_status == "ended":
            break
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
    _log(f"{language} : {len(ai)} textes générés, {failed} rejetés")
    os.remove(state_path)
    corpus_volume.commit()
    return {"language": language, "ai": len(ai), "failed": failed, "batch_id": batch_id}


@app.function(volumes={CORPUS: corpus_volume}, timeout=600)
def seed_from_v1(run: str, language: str) -> dict[str, Any]:
    """Corpus 0.2 : recopie des textes humains et des textes de Claude de v1 (même jeu de test
    gelé, aucun nouvel appel à l'API Claude). Rien n'est écrasé."""
    import shutil

    base = f"{CORPUS}/{run}/{language}"
    os.makedirs(base, exist_ok=True)
    for name in ("human.jsonl", "ai.jsonl"):
        if not os.path.exists(f"{base}/{name}"):
            shutil.copyfile(f"{CORPUS}/{MAIN_RUN}/{language}/{name}", f"{base}/{name}")
    corpus_volume.commit()
    return {
        "language": language,
        "human": len(_read(f"{base}/human.jsonl")),
        "ai": len(_read(f"{base}/ai.jsonl")),
    }


@app.function(volumes={HF_CACHE: hf_volume}, timeout=30 * 60, cpu=2, memory=4096)
def prefetch(name: str) -> None:
    """Poids d'un modèle ouvert téléchargés une seule fois (sans GPU) : les lots parallèles ne
    font que lire le cache."""
    from huggingface_hub import snapshot_download

    snapshot_download(name, allow_patterns=["*.json", "model*.safetensors", "tokenizer*"])
    hf_volume.commit()
    _log(f"{name} : poids en cache")


@app.function(gpu="L4", volumes={HF_CACHE: hf_volume}, timeout=90 * 60, max_containers=MAX_GPUS)
def open_generate(
    chunk: str, name: str, prompts: list[str], max_tokens: list[int]
) -> tuple[str, list[str]]:
    """Un lot de consignes pour un modèle ouvert (code partagé avec le test de robustesse)."""
    from detection.robustness import generate_texts

    return chunk, generate_texts(chunk, name, prompts, max_tokens)


def _generate_lots(
    partial: Path,
    names: list[str],
    arguments: Callable[[str], tuple[str, str, list[str], list[int]]],
    label: str,
) -> None:
    """Génère les lots manquants (8 GPU L4 au plus) ; chaque lot est sauvegardé dans le volume
    dès sa fin : un run relancé reprend sans régénérer. Les lots en échec sont signalés à la
    fin, une fois les autres sauvegardés. Appelé depuis un conteneur (corpus 0.2 et FR 0.3)."""
    todo = [name for name in names if not (partial / f"{name}.json").exists()]
    _log(f"{label} : {len(names) - len(todo)}/{len(names)} lots déjà générés")
    failures: list[str] = []
    saved = 0
    for result in open_generate.starmap(
        [arguments(name) for name in todo], order_outputs=False, return_exceptions=True
    ):
        if isinstance(result, BaseException):
            failures.append(f"{type(result).__name__}: {result}")
            continue
        name, texts = result
        (partial / f"{name}.json").write_text(
            json.dumps(texts, ensure_ascii=False), encoding="utf-8"
        )
        corpus_volume.commit()
        saved += 1
        _log(f"{name} : lot sauvegardé ({saved}/{len(todo)})")
    if failures:
        raise RuntimeError(
            f"{label} : {len(failures)} lots en échec (les autres sont sauvegardés) : "
            + " | ".join(failures[:3])
        )


@app.function(volumes={CORPUS: corpus_volume}, timeout=300 * 60, cpu=2, memory=8192)
def build_open(run: str, language: str) -> dict[str, Any]:
    """Textes des modèles ouverts, reformulations et textes mixtes (corpus 0.2). Chaque lot
    généré est sauvegardé dans le volume dès sa fin : un run relancé reprend sans régénérer."""

    from detection.robustness import chunks

    from train.corpus_v2 import (
        OPEN_GENERATORS,
        budget,
        generated_document,
        mixed_documents,
        plan_jobs,
        prompt,
    )

    base = f"{CORPUS}/{run}/{language}"
    humans = _read(f"{base}/human.jsonl")
    claude = _read(f"{base}/ai.jsonl")
    if os.path.exists(f"{base}/ai_open.jsonl") and os.path.exists(f"{base}/mixed.jsonl"):
        _log(f"{language} : corpus 0.2 déjà construit")
    else:
        jobs = plan_jobs(language, humans, claude)
        partial = Path(f"{base}/partial")
        partial.mkdir(parents=True, exist_ok=True)
        plan = {
            f"{language}-{name}": (key, idx)
            for key in jobs
            for name, idx in chunks(key, jobs[key], OPEN_CHUNK)
        }

        def arguments(name: str) -> tuple[str, str, list[str], list[int]]:
            key, idx = plan[name]
            selected = [jobs[key][i] for i in idx]
            return (
                name,
                OPEN_GENERATORS[key],
                [prompt(job) for job in selected],
                [budget(job[3]) for job in selected],
            )

        _generate_lots(partial, list(plan), arguments, language)

        known = {d["sha256"] for d in humans + claude}
        generated: list[dict[str, Any]] = []
        for name, (key, idx) in plan.items():
            texts = json.loads((partial / f"{name}.json").read_text(encoding="utf-8"))
            for i, raw in zip(idx, texts, strict=True):
                document = generated_document(jobs[key][i], key, raw)
                if document is None or document["sha256"] in known:
                    continue
                known.add(document["sha256"])
                generated.append(document)
        _write(f"{base}/ai_open.jsonl", sorted(generated, key=lambda d: d["id"]))
        _write(f"{base}/mixed.jsonl", mixed_documents(language, humans, claude))
        corpus_volume.commit()
    generated = _read(f"{base}/ai_open.jsonl")
    counts = Counter(f"{d['category']}:{d['generator']}" for d in generated)
    summary = {
        "language": language,
        "generated": dict(sorted(counts.items())),
        "mixed": len(_read(f"{base}/mixed.jsonl")),
    }
    _log(f"{language} : corpus 0.2 {summary}")
    return summary


@app.function(volumes={CORPUS: corpus_volume}, timeout=600)
def seed_from_v2(run: str, language: str) -> dict[str, Any]:
    """FR 0.3 : recopie du corpus 0.2 (textes humains, de Claude, de modèles ouverts, mixtes ;
    même jeu de test gelé detection-v1). Rien n'est écrasé."""
    import shutil

    base = f"{CORPUS}/{run}/{language}"
    os.makedirs(base, exist_ok=True)
    counts = {}
    for name in ("human", "ai", "ai_open", "mixed"):
        if not os.path.exists(f"{base}/{name}.jsonl"):
            shutil.copyfile(f"{CORPUS}/v2/{language}/{name}.jsonl", f"{base}/{name}.jsonl")
        counts[name] = len(_read(f"{base}/{name}.jsonl"))
    corpus_volume.commit()
    return {"language": language, **counts}


def _academic_candidates(inventory: Counter[str]) -> list[dict[str, Any]]:
    """Pages universitaires retenues : français, licence ouverte, publiées avant la date
    limite, une page par document (la première qui passe le nettoyage, hors page de titre)."""
    import tempfile
    import urllib.request

    import pyarrow.parquet as pq

    from train.corpus_v3 import (
        CUTOFF,
        FSC_BASE,
        FSC_COLUMNS,
        FSC_FILES,
        academic_licence,
        clean_academic,
        human_document,
        in_period,
    )

    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for name in FSC_FILES:
        with tempfile.NamedTemporaryFile(suffix=".parquet") as tmp:
            urllib.request.urlretrieve(f"{FSC_BASE}/{name}", tmp.name)
            parquet = pq.ParquetFile(tmp.name)
            for batch in parquet.iter_batches(batch_size=2000, columns=FSC_COLUMNS):
                for row in batch.to_pylist():
                    inventory["academic_pages"] += 1
                    if row["language"] != "fr" or row["id"] in seen or int(row["page"] or 0) < 2:
                        continue
                    licence = academic_licence(row["license"])
                    if licence is None:
                        continue
                    inventory["academic_open_licence"] += 1
                    if not in_period(row["publication_date"], end=CUTOFF):
                        continue
                    inventory["academic_in_period"] += 1
                    text = clean_academic(str(row["text"] or ""))
                    if text is None:
                        continue
                    seen.add(row["id"])
                    source = str(row["source"] or "").strip() or "inconnue"
                    out.append(
                        human_document(
                            "academic",
                            text,
                            f"french-science-commons:{source}",
                            str(row["doi"] or row["id"]),
                            f"{licence} ({source}, via PleIAs/French-Science-Commons)",
                            str(row["publication_date"]),
                        )
                    )
        _log(f"fr : {name} lu, {len(out)} pages universitaires retenues")
    inventory["academic_cleaned"] = len(out)
    return out


def _legal_candidates(inventory: Counter[str]) -> list[dict[str, Any]]:
    """Passages de motifs d'arrêts de la Cour de cassation, de 2005 à la date limite, lus au
    fil du fichier (une ligne sur JURIS_SAMPLE, tirage stable)."""
    import gzip
    import urllib.request

    from train.corpus_v3 import (
        CUTOFF,
        JURIS_FROM,
        JURIS_LICENCE,
        JURIS_URL,
        clean_legal,
        human_document,
        in_period,
        sample_line,
    )

    out: list[dict[str, Any]] = []
    with urllib.request.urlopen(JURIS_URL, timeout=300) as response:
        with gzip.open(response) as lines:
            for line in lines:
                inventory["legal_decisions"] += 1
                if not sample_line(line):
                    continue
                row = json.loads(line)
                if row.get("type") != "Arrêt":
                    continue
                if not in_period(row.get("decision_date"), JURIS_FROM, CUTOFF):
                    continue
                inventory["legal_in_period"] += 1
                text = clean_legal(str(row.get("text") or ""))
                if text is None:
                    continue
                out.append(
                    human_document(
                        "legal",
                        text,
                        f"judilibre:{row.get('chamber') or 'cour de cassation'}",
                        f"https://www.courdecassation.fr/decision/{row['id']}",
                        JURIS_LICENCE,
                        str(row["decision_date"]),
                    )
                )
    inventory["legal_cleaned"] = len(out)
    _log(f"fr : {len(out)} passages d'arrêts retenus")
    return out


@app.function(volumes={CORPUS: corpus_volume}, timeout=120 * 60, cpu=2, memory=8192)
def formal_humans(run: str) -> dict[str, Any]:
    """Textes humains de registre soutenu (FR 0.3), sans GPU. Inventaire des sources rapporté ;
    si un registre n'atteint pas son effectif, le run s'arrête avant toute génération. Une
    fois écrits, ces textes ne sont plus jamais recollectés (la partition test est gelée)."""

    from train.corpus_v3 import SIZES, split_humans

    path = f"{CORPUS}/{run}/fr/human_formal.jsonl"
    inventory: Counter[str] = Counter()
    if not os.path.exists(path):
        candidates = {
            "academic": _academic_candidates(inventory),
            "legal": _legal_candidates(inventory),
        }
        short = {k: len(v) for k, v in candidates.items() if len(v) < SIZES[k]}
        if short:
            raise RuntimeError(f"fr : textes humains insuffisants {short}, inventaire {inventory}")
        documents = [d for k in candidates for d in split_humans(k, candidates[k])]
        _write(path, documents)
        corpus_volume.commit()
    documents = _read(path)
    summary = {
        "inventory": dict(inventory),
        "selected": dict(Counter(f"{d['category']}:{d['split']}" for d in documents)),
        "years": dict(sorted(Counter(d["date"][:4] for d in documents).items())),
        "licences": dict(Counter(d["licence"].split(" (")[0] for d in documents).most_common(8)),
    }
    _log(f"fr : textes de registre soutenu {summary}")
    return summary


@app.function(volumes={CORPUS: corpus_volume}, timeout=200 * 60, cpu=2, memory=8192)
def build_formal(run: str) -> dict[str, Any]:
    """Un texte généré par texte humain de registre soutenu (même sujet, même genre), puis le
    jeu gelé detection-v3/fr (partition test), écrit une seule fois."""

    from detection.robustness import chunks

    from train.corpus_v2 import OPEN_GENERATORS, budget
    from train.corpus_v3 import generated_document, plan_jobs, prompt

    base = f"{CORPUS}/{run}/fr"
    humans = _read(f"{base}/human_formal.jsonl")
    if not os.path.exists(f"{base}/ai_formal.jsonl"):
        jobs = plan_jobs(humans)
        partial = Path(f"{base}/partial_formal")
        partial.mkdir(parents=True, exist_ok=True)
        plan = {
            f"fr-formal-{name}": (key, idx)
            for key in jobs
            for name, idx in chunks(key, jobs[key], OPEN_CHUNK)
        }

        def arguments(name: str) -> tuple[str, str, list[str], list[int]]:
            key, idx = plan[name]
            selected = [jobs[key][i] for i in idx]
            return (
                name,
                OPEN_GENERATORS[key],
                [prompt(job) for job in selected],
                [budget(job[3]) for job in selected],
            )

        _generate_lots(partial, list(plan), arguments, "fr (registre soutenu)")
        known = {
            d["sha256"]
            for name in ("human", "ai", "ai_open")
            for d in _read(f"{base}/{name}.jsonl")
        }
        known |= {d["sha256"] for d in humans}
        generated: list[dict[str, Any]] = []
        for name, (key, idx) in plan.items():
            texts = json.loads((partial / f"{name}.json").read_text(encoding="utf-8"))
            for i, raw in zip(idx, texts, strict=True):
                document = generated_document(jobs[key][i], key, raw)
                if document is None or document["sha256"] in known:
                    continue
                known.add(document["sha256"])
                generated.append(document)
        _write(f"{base}/ai_formal.jsonl", sorted(generated, key=lambda d: d["id"]))
        corpus_volume.commit()
    generated = _read(f"{base}/ai_formal.jsonl")
    testset = f"{CORPUS}/{FORMAL}/fr.jsonl"
    if not os.path.exists(testset):
        _write(testset, [d for d in humans + generated if d["split"] == "test"])
        corpus_volume.commit()
    summary = {
        "generated": dict(
            sorted(Counter(f"{d['category']}:{d['generator']}" for d in generated).items())
        ),
        "testset": dict(Counter(d["category"] for d in _read(testset))),
    }
    _log(f"fr : corpus FR 0.3 {summary}")
    return summary


@app.function(volumes={CORPUS: corpus_volume}, timeout=600)
def manifests(run: str, language: str) -> list[dict[str, Any]]:
    """Manifeste du corpus (sans texte) : à commiter."""
    from corpus.manifest import manifest_entries

    base = f"{CORPUS}/{run}/{language}"
    documents = _read(f"{base}/human.jsonl") + _read(f"{base}/ai.jsonl")
    # Corpus 0.2 (absents en v1 et pour le pilote) et FR 0.3 (registre soutenu, partition test
    # comprise : c'est le manifeste du jeu detection-v3).
    for name in ("ai_open", "mixed", "human_formal", "ai_formal"):
        documents += _read(f"{base}/{name}.jsonl")
    return manifest_entries(documents)


@app.function(
    volumes={CORPUS: corpus_volume, MODELS: models_volume},
    gpu="L4",
    # v1 réaliste : 50 à 75 min par langue ; v2 (corpus ≈ 1,5 fois plus grand) : 80 à 120 min.
    timeout=210 * 60,
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
    from train.samples import label_of, labelled_passages

    reference = reference_for(language, run)
    # Veritas 0.2 et FR 0.3 : lissage des étiquettes, classes équilibrées, combinaison plus
    # régularisée.
    v2 = run in ("v2", "v3")
    base = f"{CORPUS}/{run}/{language}"
    documents = _read(f"{base}/human.jsonl") + _read(f"{base}/ai.jsonl")
    documents += _read(f"{base}/ai_open.jsonl") + _read(f"{base}/mixed.jsonl")
    # FR 0.3 : registre soutenu, sans sa partition test (jeu detection-v3, mesuré à part : la
    # partition « test » de ce corpus reste celle de detection-v1).
    for name in ("human_formal", "ai_formal"):
        documents += [d for d in _read(f"{base}/{name}.jsonl") if d["split"] != "test"]
    split = {
        name: [d for d in documents if d["split"] == name]
        for name in ("train", "calibration", "test")
    }
    rng = random.Random(seed)

    def expand(docs: list[dict[str, Any]]) -> tuple[list[list[str]], list[int]]:
        xs, ys = [], []
        for d in docs:
            for p, y in labelled_passages(d, rng):
                xs.append(p)
                ys.append(y)
        return xs, ys

    train_x, train_y = expand(split["train"])
    calib_x, calib_y = expand(split["calibration"])
    _log(f"{reference} : {len(train_x)} passages d'entraînement, {len(calib_x)} de calibration")
    layer1 = fit_layer1(train_x, train_y, language)
    _log(f"{reference} : couche 1 entraînée")

    out_dir = f"{MODELS}/{reference}"
    encoder_info: dict[str, Any] | None = None
    encoder: TorchEncoder | None = None
    if use_encoder:
        encoder_info = fine_tune(
            language,
            [(" ".join(p), y) for p, y in zip(train_x, train_y, strict=True)],
            f"{out_dir}/encoder",
            seed=seed,
            label_smoothing=0.1 if v2 else 0.0,
            balanced=v2,
        )
        encoder = TorchEncoder(f"{out_dir}/encoder")
        _log(f"{reference} : couche 2 affinée ({encoder_info['steps']} pas)")

    l1 = layer1_logits(layer1, calib_x, language)
    l2 = encoder.logits([" ".join(p) for p in calib_x]) if encoder else None
    combine, calibration = fit_combination(l1, l2, calib_y, c=1.0 if v2 else 10.0, balanced=v2)
    manifest = build_manifest(
        reference, language, layer1, combine, calibration, encoder is not None
    )
    os.makedirs(out_dir, exist_ok=True)
    with open(f"{out_dir}/manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    models_volume.commit()
    _log(f"{reference} : couche 3 calibrée, paquet écrit ; évaluation sur {len(split['test'])}")

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
        "testset": f"{TESTSET}/{language}" if run in VERSIONS else f"{run}/{language}",
        "sizes": {k: len(v) for k, v in split.items()},
        "metrics": detection_metrics(labels, bands, scores),
        "latency_seconds_per_document_gpu": round(latency, 4),
        "encoder": encoder_info,
        "thresholds": {"likely_ai": thresholds.likely_ai, "likely_human": thresholds.likely_human},
    }
    if not v2:
        return {"manifest": manifest, "report": report}

    # Robustesse : jeu gelé detection-v2 (aucun de ses textes ni de ses sources n'est dans le
    # corpus), mêmes seuils, puis portes de sortie de l'ADR-0011 ; FR 0.3 : detection-v3 en plus
    # (ADR-0012).
    from detection.robustness import category_report

    def score_set(testset: str) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        for d in _read(f"{CORPUS}/{testset}/{language}.jsonl"):
            record = {"id": d["id"], "category": d["category"], "label": d["label"]}
            scored = score(model.detect(d["text"], language), d["text"], language, thresholds)
            record["probability"] = round(scored.probability, 4)
            record["band"] = scored.output.verdict_band.value
            records.append(record)
        return records

    records = score_set(ROBUSTNESS)
    categories = category_report(records)
    robustness = {
        "language": language,
        "testset": f"{ROBUSTNESS}/{language}",
        "references": reference,
        "thresholds": report["thresholds"],
        "categories": categories,
        "records": records,
    }
    out: dict[str, Any] = {"manifest": manifest, "report": report, "robustness": robustness}
    if run == "v3":
        from train.corpus_v3 import check_gates as check_gates_v3

        formal_records = score_set(FORMAL)
        formal_categories = category_report(formal_records)
        report["gates"] = check_gates_v3(report["metrics"], categories, formal_categories)
        out["formal"] = {**robustness, "testset": f"{FORMAL}/{language}"}
        out["formal"].update(categories=formal_categories, records=formal_records)
    else:
        from train.corpus_v2 import check_gates

        report["gates"] = check_gates(report["metrics"], categories)
    return out


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
    # v2 : train.corpus_v2 (ml/train) lit detection.robustness (ml/eval).
    sys.path.insert(0, str(REPO / "ml/eval"))
    sys.path.insert(0, str(REPO / "ml/train"))
    from corpus.generate import read_llm_model

    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    model = read_llm_model(REPO)
    langs = languages.split(",")
    # Corpus des langues en parallèle (CPU, lots Claude simultanés) ; entraînement une langue
    # après l'autre : jamais plus d'un GPU à la fois (garde-fou de coût). v2 : génération par
    # lots sur 8 GPU L4 au plus, puis les deux langues entraînées en parallèle (ADR-0011).
    if run == "v3" and langs != ["fr"]:
        raise SystemExit("run v3 (ADR-0012) : français seulement, languages doit valoir « fr »")
    if stage in ("corpus", "all"):
        _log(f"corpus : {', '.join(langs)}")
        if run == "v3":
            from train.corpus_v2 import BY_LANGUAGE, OPEN_GENERATORS

            _log(f"corpus 0.2 recopié : {seed_from_v2.remote(run, 'fr')}")
            # Textes humains d'abord, sans GPU : s'ils manquent, rien n'est généré.
            _log(f"registre soutenu : {formal_humans.remote(run)}")
            for key in BY_LANGUAGE["fr"]:
                prefetch.remote(OPEN_GENERATORS[key])
            _log(f"corpus FR 0.3 : {build_formal.remote(run)}")
        elif run == "v2":
            from train.corpus_v2 import BY_LANGUAGE, OPEN_GENERATORS

            for result in seed_from_v1.starmap([(run, lang) for lang in langs]):
                _log(f"corpus v1 recopié : {result}")
            for key in sorted({k for lang in langs for k in BY_LANGUAGE[lang]}):
                prefetch.remote(OPEN_GENERATORS[key])
            for result in build_open.starmap([(run, lang) for lang in langs]):
                _log(f"corpus 0.2 : {result}")
        else:
            for result in build_human.starmap(
                [(run, lang, train_size, test_size) for lang in langs]
            ):
                _log(f"textes humains : {result}")
            for result in generate_ai.starmap([(run, lang, model) for lang in langs]):
                _log(f"textes générés : {result}")
        corpus_manifests = manifests.starmap([(run, lang) for lang in langs])
        for lang, entries in zip(langs, corpus_manifests, strict=True):
            (out_dir / f"corpus-{lang}.json").write_text(
                json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
            )
    if stage in ("train", "all"):
        if run == "v2":
            _log(f"entraînement en parallèle : {', '.join(langs)}")
            results = list(train.starmap([(run, lang, use_encoder) for lang in langs]))
        else:
            results = []
            for language in langs:
                _log(f"entraînement : {language}")
                results.append(train.remote(run, language, use_encoder))
        for language, result in zip(langs, results, strict=True):
            reference = reference_for(language, run)
            (out_dir / reference).mkdir(exist_ok=True)
            (out_dir / reference / "manifest.json").write_text(
                json.dumps(result["manifest"], indent=2) + "\n", encoding="utf-8"
            )
            (out_dir / f"report-{TESTSET}-{reference}.json").write_text(
                json.dumps(result["report"], indent=2) + "\n", encoding="utf-8"
            )
            _log(f"{reference} : " + json.dumps(result["report"]["metrics"]))
            if "robustness" in result:
                (out_dir / f"robustness-{ROBUSTNESS}-{reference}.json").write_text(
                    json.dumps(result["robustness"], indent=1) + "\n", encoding="utf-8"
                )
                categories = {
                    k: v.get("likely_ai")
                    for k, v in result["robustness"]["categories"].items()
                    if k != "_overall"
                }
                _log(f"{reference} robustesse (part « Probablement IA ») : {categories}")
            if "formal" in result:
                (out_dir / f"robustness-{FORMAL}-{reference}.json").write_text(
                    json.dumps(result["formal"], indent=1) + "\n", encoding="utf-8"
                )
                formal = {
                    k: v.get("likely_ai")
                    for k, v in result["formal"]["categories"].items()
                    if k != "_overall"
                }
                _log(f"{reference} registre soutenu (part « Probablement IA ») : {formal}")
            if "gates" in result["report"]:
                _log(f"{reference} portes : " + json.dumps(result["report"]["gates"]))
