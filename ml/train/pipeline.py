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
# (ADR-0012) ; « v4 » : modèle français 0.4 (ADR-0012, suite) ; « v5 » : modèle français 0.5
# (ADR-0014) ; « v6 » : modèle français 0.6, corpus 0.5 et encodeur large (ADR-0015) ; tout
# autre nom (« pilot »)
# est isolé : corpus à part, références suffixées, jeu de test v1 intact.
MAIN_RUN = "v1"
VERSIONS = {"v1": "0.1", "v2": "0.2", "v3": "0.3", "v4": "0.4", "v5": "0.5", "v6": "0.6"}
# Runs à réglages 0.2 (lissage, classes équilibrées, robustesse et portes).
V2_RUNS = ("v2", "v3", "v4", "v5", "v6")
# Runs français à registre soutenu (detection-v3 et ses portes).
FORMAL_RUNS = ("v3", "v4", "v5", "v6")
# Corpus 0.5 complet (FR 0.5, recopié tel quel pour FR 0.6).
CORPUS_V5_FILES = [
    "human",
    "ai",
    "ai_open",
    "mixed",
    "human_formal",
    "ai_formal",
    "human_formal_extra",
    "ai_formal_extra",
    "human_v5",
    "ai_v5",
]
# Lots de génération du corpus 0.2 : 100 consignes, 8 GPU L4 au plus en parallèle.
OPEN_CHUNK = 100
MAX_GPUS = 8


def reference_for(language: str, run: str) -> str:
    if run in VERSIONS:
        return f"VRT-DET-{language.upper()}-{VERSIONS[run]}"
    return f"{REFERENCES[language]}-{run}"


_base_image = (
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
)


def _with_sources(base: modal.Image) -> modal.Image:
    """Code du dépôt, ajouté en dernier (Modal n'accepte plus d'étape de construction après)."""
    return (
        base.add_local_python_source("veritas")
        .add_local_dir(REPO / "ml/corpus/corpus", "/root/corpus")
        .add_local_dir(REPO / "ml/train/train", "/root/train")
        .add_local_dir(REPO / "ml/eval/detection", "/root/detection")
        .add_local_dir(REPO / "services/veritas/config", "/root/config")
    )


image = _with_sources(_base_image)
# Jeu de vérification (ADR-0016) : 7-Zip pour lire les vidages Stack Exchange.
verify_image = _with_sources(_base_image.apt_install("p7zip-full"))
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
def seed_from(run: str, language: str, source: str, names: list[str]) -> dict[str, Any]:
    """Recopie de fichiers d'un corpus précédent (FR 0.3 : corpus 0.2 ; FR 0.4 : corpus 0.3),
    même jeu de test gelé detection-v1. Rien n'est écrasé."""
    import shutil

    base = f"{CORPUS}/{run}/{language}"
    os.makedirs(base, exist_ok=True)
    counts = {}
    for name in names:
        if not os.path.exists(f"{base}/{name}.jsonl"):
            shutil.copyfile(f"{CORPUS}/{source}/{language}/{name}.jsonl", f"{base}/{name}.jsonl")
        counts[name] = len(_read(f"{base}/{name}.jsonl"))
    corpus_volume.commit()
    return {"language": language, **counts}


def _academic_candidates(
    inventory: Counter[str], files: tuple[str, ...] | None = None
) -> list[dict[str, Any]]:
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
    for name in files or FSC_FILES:
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


@app.function(volumes={CORPUS: corpus_volume}, timeout=120 * 60, cpu=2, memory=8192)
def formal_extra(run: str) -> dict[str, Any]:
    """FR 0.4 : textes humains de registre soutenu supplémentaires, sans GPU, hors de tout
    document du corpus 0.3 et de detection-v3. Arrêt avant toute génération si le registre
    universitaire n'atteint pas son effectif."""
    from train.corpus_v3 import EXTRA_SIZES, is_priority, select_extra

    base = f"{CORPUS}/{run}/fr"
    path = f"{base}/human_formal_extra.jsonl"
    inventory: Counter[str] = Counter()
    if not os.path.exists(path):
        used = {
            value
            for d in _read(f"{base}/human_formal.jsonl") + _read(f"{CORPUS}/{FORMAL}/fr.jsonl")
            for value in (d.get("url"), d["sha256"])
            if value
        }
        academic = select_extra("academic", _academic_candidates(inventory), used)
        legal = select_extra("legal", _legal_candidates(inventory), used)
        if len(academic) < EXTRA_SIZES["academic"]:
            raise RuntimeError(f"fr : pages universitaires insuffisantes ({len(academic)})")
        _write(path, academic + legal)
        corpus_volume.commit()
    documents = _read(path)
    summary = {
        "inventory": dict(inventory),
        "selected": dict(Counter(f"{d['category']}:{d['split']}" for d in documents)),
        "academic_priority": sum(is_priority(d) for d in documents if d["register"] == "academic"),
    }
    _log(f"fr : textes de registre soutenu supplémentaires {summary}")
    return summary


@app.function(volumes={CORPUS: corpus_volume}, timeout=200 * 60, cpu=2, memory=8192)
def build_formal(run: str, extra: bool = False) -> dict[str, Any]:
    """Un texte généré par texte humain de registre soutenu (même sujet, même genre), puis le
    jeu gelé detection-v3/fr (partition test), écrit une seule fois. `extra` (FR 0.4) : textes
    humains supplémentaires, fichiers et lots à part."""

    from detection.robustness import chunks

    from train.corpus_v2 import OPEN_GENERATORS, budget
    from train.corpus_v3 import generated_document, plan_jobs, prompt

    base = f"{CORPUS}/{run}/fr"
    suffix = "_extra" if extra else ""
    humans = _read(f"{base}/human_formal{suffix}.jsonl")
    target = f"{base}/ai_formal{suffix}.jsonl"
    if not os.path.exists(target):
        jobs = plan_jobs(humans)
        partial = Path(f"{base}/partial_formal{suffix}")
        partial.mkdir(parents=True, exist_ok=True)
        plan = {
            f"fr-formal{suffix.replace('_', '-')}-{name}": (key, idx)
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
            for name in ("human", "ai", "ai_open", "human_formal", "ai_formal")
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
        _write(target, sorted(generated, key=lambda d: d["id"]))
        corpus_volume.commit()
    generated = _read(target)
    testset = f"{CORPUS}/{FORMAL}/fr.jsonl"
    if not extra and not os.path.exists(testset):
        _write(testset, [d for d in humans + generated if d["split"] == "test"])
        corpus_volume.commit()
    summary = {
        "generated": dict(
            sorted(Counter(f"{d['category']}:{d['generator']}" for d in generated).items())
        ),
        "testset": dict(Counter(d["category"] for d in _read(testset))),
    }
    _log(f"fr : corpus FR {VERSIONS[run]} {summary}")
    return summary


def _test_reference(base: str, language: str = "fr") -> tuple[set[str], set[str], set[int]]:
    """Empreintes et adresses déjà utilisées (corpus du run et jeux de test), empreintes des
    jeux de test et leurs suites de 8 mots (copies partielles)."""
    from corpus.clean import fingerprint

    from train.incoming import shingles

    used: set[str] = set()
    tests: set[str] = set()
    test_shingles: set[int] = set()
    files = [*Path(base).glob("*.jsonl"), *Path(CORPUS).glob(f"detection-*/{language}.jsonl")]
    for file in files:
        is_testset = file.parent.name.startswith("detection-")
        for d in _read(str(file)):
            text = d.get("text")
            if not isinstance(text, str):
                continue
            digest = fingerprint(text)
            used.add(digest)
            if d.get("url"):
                used.add(str(d["url"]))
            if is_testset or d.get("split") == "test":
                tests.add(digest)
                test_shingles |= shingles(text)
    return used, tests, test_shingles


@app.function(volumes={CORPUS: corpus_volume}, timeout=150 * 60, cpu=2, memory=16384)
def v5_candidates(run: str) -> dict[str, Any]:
    """FR 0.5 : candidats humains des trois sources, sans GPU, hors de tout document déjà
    utilisé et de toute copie d'un jeu de test. Arrêt avant notation et génération si une
    source est insuffisante ou si le corpus déposé recoupe trop les jeux de test."""
    import gzip
    import urllib.request

    from corpus.human import collect, iter_records
    from corpus.sources import SOURCES

    from train.corpus_v5 import (
        FSC_FILES_V5,
        INCOMING_FILE,
        MAX_CANDIDATES,
        WEB_SHARD,
        cap_candidates,
        check_sources,
        resource_documents,
        web_document,
    )
    from train.incoming import PARTIAL_COPY, SHINGLE_STRIDE, parse_lines, shingles

    base = f"{CORPUS}/{run}/fr"
    path = f"{base}/candidates_v5.jsonl"
    inventory: Counter[str] = Counter()
    if not os.path.exists(path):
        used, tests, test_shingles = _test_reference(base)
        _log(f"fr : référence {len(used)} empreintes et adresses, {len(tests)} textes de test")
        incoming = Path(INCOMING) / INCOMING_FILE
        if not incoming.is_file():
            raise RuntimeError(f"corpus déposé absent du volume : incoming/{INCOMING_FILE}")
        with gzip.open(incoming, "rb") as f:
            resource = resource_documents(parse_lines(f), inventory)
        _log(f"fr : corpus déposé, {len(resource)} passages ({dict(inventory)})")
        academic = _academic_candidates(inventory, FSC_FILES_V5)
        source = SOURCES["fr"]
        with urllib.request.urlopen(source.url(WEB_SHARD), timeout=300) as response:
            pages = collect(iter_records(response), source, WEB_SHARD, 2 * MAX_CANDIDATES["web"])
        web = [web_document(page) for page in pages]
        _log(f"fr : {len(web)} pages web mC4 (fragment 2)")

        def fresh(register: str, documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
            kept = []
            for d in documents:
                if d["sha256"] in used or (d.get("url") and d["url"] in used):
                    inventory[f"{register}_already_used"] += 1
                    continue
                sample = shingles(d["text"], SHINGLE_STRIDE)
                if d["sha256"] in tests or (
                    sample and len(sample & test_shingles) / len(sample) >= PARTIAL_COPY
                ):
                    inventory[f"{register}_test_overlap"] += 1
                    continue
                kept.append(d)
            return cap_candidates(register, kept)

        candidates = {
            "academic": fresh("academic", academic),
            "web": fresh("web", web),
            "resource": fresh("resource", resource),
        }
        overlap = inventory["resource_test_overlap"] / max(len(resource), 1)
        counts = {k: len(v) for k, v in candidates.items()}
        problems = check_sources(counts, overlap)
        if problems:
            raise RuntimeError(f"fr 0.5 : arrêt avant notation : {problems} ; {dict(inventory)}")
        _write(path, [d for k in candidates for d in candidates[k]])
        corpus_volume.commit()
    documents = _read(path)
    summary = {
        "inventory": dict(inventory),
        "candidates": dict(Counter(d["register"] for d in documents)),
    }
    _log(f"fr : candidats FR 0.5 {summary}")
    return summary


def _load_model(reference: str) -> Any:
    """Paquet Veritas du volume des modèles, couche 2 comprise."""
    from veritas.engine.model import VeritasModel
    from veritas.engine.torch_encoder import TorchEncoder

    model_dir = f"{MODELS}/{reference}"
    with open(f"{model_dir}/manifest.json", encoding="utf-8") as f:
        manifest = json.load(f)
    encoder = TorchEncoder(f"{model_dir}/encoder") if manifest.get("layer2") else None
    return VeritasModel.from_manifest(manifest, encoder)


@app.function(volumes={CORPUS: corpus_volume, MODELS: models_volume}, gpu="L4", timeout=90 * 60)
def v5_score(run: str) -> dict[str, Any]:
    """FR 0.5 : probabilité donnée par FR 0.4 à chaque candidat (un seul L4, sans entraîner)."""
    base = f"{CORPUS}/{run}/fr"
    path = f"{base}/candidates_v5_scored.jsonl"
    if not os.path.exists(path):
        _log("fr : notation des candidats par VRT-DET-FR-0.4")
        model = _load_model("VRT-DET-FR-0.4")
        documents = _read(f"{base}/candidates_v5.jsonl")
        for i, d in enumerate(documents, 1):
            d["prior_probability"] = round(float(model.detect(d["text"], "fr").probability), 4)
            if i % 2000 == 0:
                _log(f"fr : {i}/{len(documents)} candidats notés")
        _write(path, documents)
        corpus_volume.commit()
    from train.corpus_v5 import HARD_MIN

    documents = _read(path)
    summary = {
        register: {
            "candidates": sum(d["register"] == register for d in documents),
            "hard": sum(
                d["register"] == register and d["prior_probability"] >= HARD_MIN for d in documents
            ),
        }
        for register in sorted({d["register"] for d in documents})
    }
    _log(f"fr : candidats notés {summary}")
    return summary


@app.function(volumes={CORPUS: corpus_volume}, timeout=600, cpu=2, memory=8192)
def v5_select(run: str) -> dict[str, Any]:
    """FR 0.5 : textes humains retenus (difficiles d'abord), sans GPU."""
    from train.corpus_v5 import HARD_MIN, SIZES_V5, select_v5

    base = f"{CORPUS}/{run}/fr"
    path = f"{base}/human_v5.jsonl"
    if not os.path.exists(path):
        scored = _read(f"{base}/candidates_v5_scored.jsonl")
        chosen = [
            d
            for register in SIZES_V5
            for d in select_v5(register, [d for d in scored if d["register"] == register])
        ]
        _write(path, chosen)
        corpus_volume.commit()
    documents = _read(path)
    summary = {
        "selected": dict(Counter(f"{d['category']}:{d['split']}" for d in documents)),
        "hard": dict(
            Counter(d["register"] for d in documents if d["prior_probability"] >= HARD_MIN)
        ),
    }
    _log(f"fr : textes humains FR 0.5 {summary}")
    return summary


@app.function(volumes={CORPUS: corpus_volume}, timeout=200 * 60, cpu=2, memory=8192)
def build_paired(run: str) -> dict[str, Any]:
    """FR 0.5 : un texte généré par texte humain retenu (même sujet, même genre), lots de 100
    consignes sur 8 L4 au plus, chaque lot sauvegardé (reprise sans régénérer)."""
    from detection.robustness import chunks

    from train.corpus_v2 import OPEN_GENERATORS, budget
    from train.corpus_v3 import generated_document, plan_jobs, prompt

    base = f"{CORPUS}/{run}/fr"
    humans = _read(f"{base}/human_v5.jsonl")
    target = f"{base}/ai_v5.jsonl"
    if not os.path.exists(target):
        jobs = plan_jobs(humans)
        partial = Path(f"{base}/partial_v5")
        partial.mkdir(parents=True, exist_ok=True)
        plan = {
            f"fr-v5-{name}": (key, idx)
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

        _generate_lots(partial, list(plan), arguments, "fr (FR 0.5)")
        known = {d["sha256"] for file in Path(base).glob("*.jsonl") for d in _read(str(file))}
        generated: list[dict[str, Any]] = []
        for name, (key, idx) in plan.items():
            texts = json.loads((partial / f"{name}.json").read_text(encoding="utf-8"))
            for i, raw in zip(idx, texts, strict=True):
                document = generated_document(jobs[key][i], key, raw)
                if document is None or document["sha256"] in known:
                    continue
                known.add(document["sha256"])
                generated.append(document)
        _write(target, sorted(generated, key=lambda d: d["id"]))
        corpus_volume.commit()
    generated = _read(target)
    summary = {
        "generated": dict(
            sorted(Counter(f"{d['category']}:{d['generator']}" for d in generated).items())
        )
    }
    _log(f"fr : corpus FR 0.5 {summary}")
    return summary


@app.function(volumes={CORPUS: corpus_volume}, timeout=600)
def manifests(run: str, language: str) -> list[dict[str, Any]]:
    """Manifeste du corpus (sans texte) : à commiter."""
    from corpus.manifest import manifest_entries

    base = f"{CORPUS}/{run}/{language}"
    documents = _read(f"{base}/human.jsonl") + _read(f"{base}/ai.jsonl")
    # Corpus 0.2 (absents en v1 et pour le pilote) et FR 0.3 (registre soutenu, partition test
    # comprise : c'est le manifeste du jeu detection-v3).
    names = (
        "ai_open",
        "mixed",
        "human_formal",
        "ai_formal",
        "human_formal_extra",
        "ai_formal_extra",
        "human_v5",
        "ai_v5",
    )
    for name in names:
        documents += _read(f"{base}/{name}.jsonl")
    return manifest_entries(documents)


@app.function(
    volumes={CORPUS: corpus_volume, MODELS: models_volume},
    gpu="L4",
    # v1 réaliste : 50 à 75 min par langue ; v2 (corpus ≈ 1,5 fois plus grand) : 80 à 120 min ;
    # FR 0.6 (encodeur large, ≈ 3 fois plus de calcul) : 1 h 40 à 2 h, mesure comprise.
    timeout=300 * 60,
)
def train(run: str, language: str, use_encoder: bool = True, seed: int = 0) -> dict[str, Any]:
    """Couches 1 à 3, puis évaluation sur le jeu de test gelé. Écrit le paquet dans le volume."""
    from veritas.engine.model import VeritasModel
    from veritas.engine.torch_encoder import TorchEncoder
    from veritas.settings import thresholds_config

    from train.encoder import encoder_settings, fine_tune
    from train.layers import build_manifest, fit_combination, fit_layer1, layer1_logits
    from train.samples import labelled_passages

    reference = reference_for(language, run)
    # Repère du démarrage du conteneur GPU : sépare l'attente d'un GPU et le démarrage de la
    # préparation des passages (ADR-0012, 31 min non expliquées en 0.2).
    _log(f"{reference} : conteneur GPU démarré")
    # Veritas 0.2 et FR 0.3 : lissage des étiquettes, classes équilibrées, combinaison plus
    # régularisée.
    v2 = run in V2_RUNS
    documents = _corpus_documents(run, language)
    split = {
        name: [d for d in documents if d["split"] == name]
        for name in ("train", "calibration", "test")
    }
    _log(f"{reference} : {len(documents)} documents lus")
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
            settings=encoder_settings(run, language),
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
    out = _evaluate(run, language, model, split["test"], thresholds_config().get())
    out["report"]["sizes"] = {k: len(v) for k, v in split.items()}
    out["report"]["encoder"] = encoder_info
    return {"manifest": manifest, **out}


def _corpus_documents(run: str, language: str) -> list[dict[str, Any]]:
    """Documents d'entraînement, de calibration et de test (detection-v1) d'un corpus."""
    base = f"{CORPUS}/{run}/{language}"
    documents = _read(f"{base}/human.jsonl") + _read(f"{base}/ai.jsonl")
    documents += _read(f"{base}/ai_open.jsonl") + _read(f"{base}/mixed.jsonl")
    # FR 0.3 : registre soutenu, sans sa partition test (jeu detection-v3, mesuré à part : la
    # partition « test » de ce corpus reste celle de detection-v1).
    # FR 0.4 : textes supplémentaires (jamais en partition test).
    # FR 0.5 : textes humains difficiles et textes générés appariés (jamais en partition test).
    names = ("human_formal", "ai_formal", "human_formal_extra", "ai_formal_extra")
    for name in (*names, "human_v5", "ai_v5"):
        documents += [d for d in _read(f"{base}/{name}.jsonl") if d["split"] != "test"]
    return documents


def _evaluate(
    run: str, language: str, model: Any, test: list[dict[str, Any]], thresholds: Any
) -> dict[str, Any]:
    """Jeu de test gelé detection-v1, puis (v2 et suivants) robustesse et portes de sortie."""
    from detection.metrics import detection_metrics
    from veritas.scoring import score

    from train.samples import label_of

    reference = model.reference
    labels, bands, scores = [], [], []
    started = time.perf_counter()
    for d in test:
        scored = score(model.detect(d["text"], language), d["text"], language, thresholds)
        labels.append(label_of(d))
        bands.append(scored.output.verdict_band.value)
        scores.append(scored.probability)
    latency = (time.perf_counter() - started) / max(len(test), 1)
    # Seuils réellement appliqués à ce modèle (ADR-0013 : seuil propre possible).
    applied = thresholds.for_model(reference)
    report: dict[str, Any] = {
        "reference": reference,
        "testset": f"{TESTSET}/{language}" if run in VERSIONS else f"{run}/{language}",
        "metrics": detection_metrics(labels, bands, scores),
        "latency_seconds_per_document_gpu": round(latency, 4),
        "thresholds": {"likely_ai": applied.likely_ai, "likely_human": applied.likely_human},
    }
    if run not in V2_RUNS:
        return {"report": report}

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
    out: dict[str, Any] = {"report": report, "robustness": robustness}
    if run in FORMAL_RUNS:
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


@app.function(
    volumes={CORPUS: corpus_volume, MODELS: models_volume},
    gpu="L4",
    # ≈ 6 000 documents notés, sans entraînement : 15 à 20 min (ADR-0013).
    timeout=60 * 60,
)
def threshold(run: str, language: str) -> dict[str, Any]:
    """Seuil « Probablement IA » propre au modèle déjà entraîné (ADR-0013) : choisi sur la
    partition de calibration, puis mesuré une seule fois sur les jeux de test gelés."""
    from dataclasses import replace

    from veritas.engine.model import VeritasModel
    from veritas.engine.torch_encoder import TorchEncoder
    from veritas.scoring import score
    from veritas.settings import thresholds_config

    from train.threshold import choose_threshold

    reference = reference_for(language, run)
    _log(f"{reference} : conteneur GPU démarré (seuil)")
    model_dir = f"{MODELS}/{reference}"
    with open(f"{model_dir}/manifest.json", encoding="utf-8") as f:
        manifest = json.load(f)
    encoder = TorchEncoder(f"{model_dir}/encoder") if manifest.get("layer2") else None
    model = VeritasModel.from_manifest(manifest, encoder)
    base = thresholds_config().get()
    documents = _corpus_documents(run, language)
    calibration = [d for d in documents if d["split"] == "calibration"]
    _log(f"{reference} : {len(calibration)} documents de calibration")
    records = []
    for d in calibration:
        scored = score(model.detect(d["text"], language), d["text"], language, base)
        records.append(
            {
                "id": d["id"],
                "category": d.get("category"),
                "label": d["label"],
                "probability": round(scored.probability, 4),
            }
        )
    choice = {"reference": reference, **choose_threshold(records), "records": records}
    _log(f"{reference} : seuil choisi sur la calibration : {choice['chosen']}")
    if choice["chosen"] is None:
        # Aucun seuil de la grille ne convient : rien ne change (ADR-0013), pas de mesure.
        return {"threshold": choice}
    thresholds = replace(base, model_likely_ai={reference: choice["chosen"]})
    test = [d for d in documents if d["split"] == "test"]
    return {"threshold": choice, **_evaluate(run, language, model, test, thresholds)}


INCOMING = f"{CORPUS}/incoming"


@app.function(volumes={CORPUS: corpus_volume}, timeout=60 * 60, cpu=2, memory=8192)
def inspect_incoming(name: str) -> dict[str, Any]:
    """Inspection d'un corpus déposé dans `/corpus/incoming/` (sans GPU, sans texte dans le
    rapport) : forme, longueurs, langues, doublons, recoupements avec le volume."""
    import gzip
    import pathlib

    from corpus.clean import fingerprint

    from train.incoming import inspect, parse_lines, shingles

    path = pathlib.Path(INCOMING) / name
    if not path.is_file():
        raise RuntimeError(f"fichier absent du volume : incoming/{name}")
    _log(f"{name} : {path.stat().st_size / 1e6:.1f} Mo")
    # Empreintes des documents déjà présents, par corpus ; partition test et jeux detection-*
    # comptés à part (jeux de test gelés).
    known: dict[str, set[str]] = {}
    test_shingles: set[int] = set()
    root = pathlib.Path(CORPUS)
    files = [*root.glob("*/*.jsonl"), *root.glob("*/*/*.jsonl")]
    for file in sorted(files):
        top = file.relative_to(root).parts[0]
        if top == "incoming":
            continue
        for d in _read(str(file)):
            text = d.get("text")
            if not isinstance(text, str):
                continue
            is_test = top.startswith("detection-") or d.get("split") == "test"
            name_ = f"test:{top}" if is_test else f"corpus:{top}"
            known.setdefault(name_, set()).add(fingerprint(text))
            if is_test:
                test_shingles |= shingles(text)
    _log(f"référence : {sum(len(v) for v in known.values())} empreintes, {len(known)} ensembles")
    opener = gzip.open if name.endswith(".gz") else open
    with opener(path, "rb") as f:
        report = inspect(parse_lines(f), known, test_shingles)
    report["file"] = {"name": name, "bytes": path.stat().st_size}
    report["reference_sets"] = {k: len(v) for k, v in sorted(known.items())}
    return report


# --- Jeu de vérification verification-en-v1 (ADR-0016) ---

VERIFICATION = "verification-en-v1"
VERIFICATION_DIR = f"{CORPUS}/{VERIFICATION}"
# Identification générique auprès d'archive.org et d'arXiv (aucune donnée personnelle).
USER_AGENT = "AltyDetect-verification/1.0"


def _fetch(url: str, attempts: int = 6) -> bytes:
    """Requête HTTP avec reprise : arXiv répond 503 avec Retry-After quand il faut ralentir."""
    import urllib.error
    import urllib.request

    for attempt in range(attempts):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                body: bytes = response.read()
                return body
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503) or attempt == attempts - 1:
                raise
            wait = int(error.headers.get("Retry-After") or 10)
        except (urllib.error.URLError, TimeoutError):
            if attempt == attempts - 1:
                raise
            wait = 10 * (attempt + 1)
        _log(f"nouvel essai dans {min(wait, 120)} s : {url[:80]}")
        time.sleep(min(wait, 120))
    raise RuntimeError("inaccessible")


def _stack_exchange(site: str, inventory: Counter[str]) -> list[dict[str, Any]]:
    """Messages retenus d'un site, lus en flux dans Posts.xml du vidage (rien n'est gardé
    sur le disque du conteneur après la lecture)."""
    import shutil
    import subprocess
    import urllib.request

    from train.verification import STACK_EXCHANGE_DUMP, iter_posts, stack_exchange_document

    archive = f"/tmp/{site}.7z"
    request = urllib.request.Request(
        STACK_EXCHANGE_DUMP.format(site=site), headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(request, timeout=600) as response, open(archive, "wb") as f:
        shutil.copyfileobj(response, f, length=1 << 20)
    _log(f"Stack Exchange {site} : {os.path.getsize(archive) / 1e6:.0f} Mo téléchargés")
    process = subprocess.Popen(
        ["7z", "e", "-so", archive, "Posts.xml"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    )
    assert process.stdout is not None
    documents = []
    for row in iter_posts(process.stdout):
        document = stack_exchange_document(row, site, inventory)
        if document is not None:
            documents.append(document)
    if process.wait() != 0:
        raise RuntimeError(f"Stack Exchange {site} : archive illisible")
    os.remove(archive)
    _log(f"Stack Exchange {site} : {len(documents)} messages utilisables")
    return documents


def _arxiv(inventory: Counter[str], needed: int) -> list[dict[str, Any]]:
    """Résumés arXiv sous licence ouverte, par l'interface OAI-PMH (une page toutes les 3 s)."""
    import urllib.parse

    from train.verification import ARXIV_OAI, ARXIV_WINDOW, arxiv_document, arxiv_page

    start, end = ARXIV_WINDOW
    url: str | None = f"{ARXIV_OAI}?verb=ListRecords&metadataPrefix=arXiv&from={start}&until={end}"
    documents: list[dict[str, Any]] = []
    pages = 0
    while url and pages < 40 and len(documents) < needed:
        records, token = arxiv_page(_fetch(url))
        pages += 1
        documents += [d for r in records if (d := arxiv_document(r, inventory)) is not None]
        inventory["arxiv_records"] += len(records)
        url = (
            f"{ARXIV_OAI}?verb=ListRecords&resumptionToken={urllib.parse.quote(token)}"
            if token
            else None
        )
        time.sleep(3)
    _log(f"arXiv : {len(documents)} résumés utilisables ({pages} pages)")
    return documents


@app.function(
    image=verify_image, volumes={CORPUS: corpus_volume}, timeout=90 * 60, cpu=2, memory=8192
)
def verify_collect() -> dict[str, Any]:
    """Textes humains publics du jeu de vérification (CPU seul) : Stack Exchange et arXiv,
    hors de tout texte du corpus d'EN 0.2 et des jeux de test anglais."""
    from train.verification import (
        FORUM_SITES,
        NON_NATIVE_SITE,
        QUOTAS,
        exclude_known,
        manifest_entry,
        select,
        select_forum,
    )

    path = f"{VERIFICATION_DIR}/public.jsonl"
    inventory: Counter[str] = Counter()
    if not os.path.exists(path):
        used, tests, test_shingles = _test_reference(f"{CORPUS}/v2/en", "en")
        _log(f"en : référence {len(used)} empreintes et adresses, {len(tests)} textes de test")
        candidates: list[dict[str, Any]] = []
        for site in (NON_NATIVE_SITE, *FORUM_SITES):
            candidates += _stack_exchange(site, inventory)
        candidates += _arxiv(inventory, needed=4 * QUOTAS["human_abstract"])
        fresh = exclude_known(candidates, used, tests, test_shingles, inventory)

        def of(category: str) -> list[dict[str, Any]]:
            return [d for d in fresh if d["category"] == category]

        public = (
            select(of("human_non_native"), QUOTAS["human_non_native"])
            + select_forum(of("human_forum"))
            + select(of("human_abstract"), QUOTAS["human_abstract"])
        )
        counts = Counter(d["category"] for d in public)
        short = {c: counts[c] for c, quota in QUOTAS.items() if counts[c] < quota}
        if short:
            raise RuntimeError(
                f"{VERIFICATION} : sources insuffisantes {short} ; {dict(inventory)}"
            )
        _write(path, public)
        corpus_volume.commit()
    public = _read(path)
    summary = {
        "inventory": dict(inventory),
        "counts": dict(Counter(d["category"] for d in public)),
        "manifest": [manifest_entry(d) for d in public],
    }
    _log(f"{VERIFICATION} : textes publics {summary['counts']} {summary['inventory']}")
    return summary


def _deposit_files() -> list[Path]:
    return sorted(Path(INCOMING, VERIFICATION).glob("*.jsonl"))


@app.function(volumes={CORPUS: corpus_volume}, timeout=30 * 60, cpu=2, memory=8192)
def verify_prepare() -> dict[str, Any]:
    """Textes publics et dépôt de l'équipe réunis (CPU seul). Arrêt avant toute dépense GPU
    s'il manque des textes ou si la mesure a déjà eu lieu (une seule mesure, ADR-0016)."""
    from train.verification import check_sizes, exclude_known, parse_deposit

    if os.path.exists(f"{VERIFICATION_DIR}/measured.json"):
        raise RuntimeError(f"{VERIFICATION} : déjà mesuré, aucune nouvelle mesure (ADR-0016)")
    public = _read(f"{VERIFICATION_DIR}/public.jsonl")
    if not public:
        raise RuntimeError(f"{VERIFICATION} : lancer d'abord l'étape verify-collect")
    inventory: Counter[str] = Counter()
    files = _deposit_files()
    deposit = [
        d
        for file in files
        for d, _ in parse_deposit(file.read_bytes().splitlines(), inventory)
        if d is not None
    ]
    used, tests, test_shingles = _test_reference(f"{CORPUS}/v2/en", "en")
    used |= {d["sha256"] for d in public}
    deposit = exclude_known(deposit, used, tests, test_shingles, inventory)
    documents = public + deposit
    counts = dict(Counter(d["category"] for d in documents))
    problems = check_sizes(counts)
    summary = {"files": len(files), "counts": counts, "inventory": dict(inventory)}
    _log(f"{VERIFICATION} : {summary}")
    if problems:
        raise RuntimeError(f"{VERIFICATION} : arrêt avant notation : {problems}")
    _write(f"{VERIFICATION_DIR}/scoring.jsonl", documents)
    corpus_volume.commit()
    return summary


@app.function(volumes={CORPUS: corpus_volume, MODELS: models_volume}, gpu="L4", timeout=45 * 60)
def verify_score() -> list[dict[str, Any]]:
    """Notation unique par VRT-DET-EN-0.2, à son seuil propre (thresholds.yaml). Rien d'autre
    que l'identifiant, la catégorie, la probabilité et la bande ne sort du conteneur."""
    from veritas.scoring import score
    from veritas.settings import thresholds_config

    from train.verification import LANGUAGE, REFERENCE

    _log(f"{REFERENCE} : conteneur GPU démarré ({VERIFICATION})")
    corpus_volume.reload()
    model = _load_model(REFERENCE)
    thresholds = thresholds_config().get()
    records = []
    for d in _read(f"{VERIFICATION_DIR}/scoring.jsonl"):
        scored = score(model.detect(d["text"], LANGUAGE), d["text"], LANGUAGE, thresholds)
        record = {"id": d["id"], "category": d["category"], "label": d["label"]}
        if d["category"] != "human_volunteer":
            record["source"] = d.get("source")
        record["probability"] = round(scored.probability, 4)
        record["band"] = scored.output.verdict_band.value
        records.append(record)
    _log(f"{REFERENCE} : {len(records)} textes notés")
    return records


@app.function(volumes={CORPUS: corpus_volume}, timeout=10 * 60)
def verify_finish(report: dict[str, Any]) -> dict[str, Any]:
    """Après la mesure : jeu gelé sans les volontaires, textes des volontaires effacés du
    dépôt (et lignes refusées), marque « mesuré » qui interdit une seconde mesure."""
    from train.verification import keep_line, manifest_entry, parse_deposit

    documents = _read(f"{VERIFICATION_DIR}/scoring.jsonl")
    manifest = [manifest_entry(d) for d in documents]
    _write(
        f"{VERIFICATION_DIR}/en.jsonl",
        [d for d in documents if d["category"] != "human_volunteer"],
    )
    os.remove(f"{VERIFICATION_DIR}/scoring.jsonl")
    erased = 0
    for file in _deposit_files():
        lines = file.read_bytes().splitlines()
        parsed = parse_deposit(lines, Counter())
        kept = [raw for d, raw in parsed if keep_line(d)]
        erased += len(parsed) - len(kept)
        file.write_bytes(b"".join(bytes(raw) + b"\n" for raw in kept))
    with open(f"{VERIFICATION_DIR}/measured.json", "w", encoding="utf-8") as f:
        json.dump({"measured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **report}, f)
    corpus_volume.commit()
    _log(f"{VERIFICATION} : jeu gelé écrit, {erased} lignes effacées du dépôt")
    return {"manifest": manifest, "erased_lines": erased}


@app.local_entrypoint()
def main(
    stage: str = "all",
    run: str = MAIN_RUN,
    languages: str = "fr,en",
    train_size: int = 4400,
    test_size: int = 1000,
    use_encoder: bool = True,
    out: str = "ml/train/out",
    incoming: str = "",
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
    if run in FORMAL_RUNS and langs != ["fr"]:
        raise SystemExit(f"run {run} (ADR-0012) : français seulement, languages doit valoir « fr »")
    if stage in ("corpus", "all"):
        _log(f"corpus : {', '.join(langs)}")
        if run == "v6":
            # FR 0.6 (ADR-0015) : corpus 0.5 recopié tel quel, sans génération ni API.
            _log(f"corpus 0.5 recopié : {seed_from.remote(run, 'fr', 'v5', CORPUS_V5_FILES)}")
        elif run == "v5":
            from train.corpus_v2 import BY_LANGUAGE, OPEN_GENERATORS

            names = CORPUS_V5_FILES[:-2]
            _log(f"corpus 0.4 recopié : {seed_from.remote(run, 'fr', 'v4', names)}")
            # Candidats sans GPU, puis notation par FR 0.4 et sélection : s'il manque des
            # textes, ou si le corpus déposé recoupe les jeux de test, rien n'est généré.
            _log(f"candidats : {v5_candidates.remote(run)}")
            _log(f"notation : {v5_score.remote(run)}")
            _log(f"sélection : {v5_select.remote(run)}")
            for key in BY_LANGUAGE["fr"]:
                prefetch.remote(OPEN_GENERATORS[key])
            _log(f"corpus FR 0.5 : {build_paired.remote(run)}")
        elif run == "v4":
            from train.corpus_v2 import BY_LANGUAGE, OPEN_GENERATORS

            names = ["human", "ai", "ai_open", "mixed", "human_formal", "ai_formal"]
            _log(f"corpus 0.3 recopié : {seed_from.remote(run, 'fr', 'v3', names)}")
            # Textes humains d'abord, sans GPU : s'ils manquent, rien n'est généré.
            _log(f"registre soutenu, supplément : {formal_extra.remote(run)}")
            for key in BY_LANGUAGE["fr"]:
                prefetch.remote(OPEN_GENERATORS[key])
            _log(f"corpus FR 0.4 : {build_formal.remote(run, True)}")
        elif run == "v3":
            from train.corpus_v2 import BY_LANGUAGE, OPEN_GENERATORS

            names = ["human", "ai", "ai_open", "mixed"]
            _log(f"corpus 0.2 recopié : {seed_from.remote(run, 'fr', 'v2', names)}")
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
            _write_results(out_dir, reference_for(language, run), result)
        # FR 0.5 et 0.6 : seuil propre choisi sur la calibration dans le même run (ADR-0013,
        # ADR-0014, ADR-0015).
        if run in ("v5", "v6"):
            _run_threshold(out_dir, run, langs, suffix="-seuil")
        # FR 0.6 : critère d'ouverture d'ADR-0015 appliqué aussi à EN 0.2 (déjà entraîné).
        if run == "v6":
            _run_threshold(out_dir, "v2", ["en"], suffix="-seuil")
    if stage in ("verify-collect", "verify"):
        # Vérification de VRT-DET-EN-0.2 sur des textes réels (ADR-0016) : anglais, modèle du
        # run v2, sans entraînement.
        if run != "v2" or langs != ["en"]:
            raise SystemExit(f"stage {stage} (ADR-0016) : run v2 et languages « en » seulement")
        _verify(stage, out_dir)
        return
    if stage == "inspect":
        # Corpus déposé à la main dans le volume (CPU seul, quelques centimes).
        import re

        if not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", incoming):
            raise SystemExit("stage inspect : --incoming doit nommer un fichier de incoming/")
        report = inspect_incoming.remote(incoming)
        stem = incoming.split(".")[0]
        (out_dir / f"inspect-{stem}.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
        )
        summary = {k: report[k] for k in ("texts", "languages", "length_buckets", "exact_overlap")}
        summary["partial_copy_of_testsets"] = report["partial_copy_of_testsets"]
        _log(f"inspection : {json.dumps(summary, ensure_ascii=False)}")
        return
    if stage == "threshold":
        # Seuil propre au modèle déjà entraîné (ADR-0013) : aucun entraînement, un seul L4.
        if run not in ("v2", "v4", "v5", "v6"):
            raise SystemExit("stage threshold (ADR-0013) : run v2, v4, v5 ou v6 seulement")
        _run_threshold(out_dir, run, langs)


def _verify(stage: str, out_dir: Path) -> None:
    """verify-collect : textes publics (CPU). verify : dépôt vérifié (CPU), notation unique
    (un L4), portes d'ADR-0016, puis effacement des textes des volontaires."""
    from detection.robustness import category_report

    from train.verification import REFERENCE, check_gates

    def write(name: str, value: Any) -> None:
        (out_dir / name).write_text(
            json.dumps(value, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
        )

    if stage == "verify-collect":
        summary = verify_collect.remote()
        write(f"manifest-{VERIFICATION}-public.json", summary)
        return
    prepared = verify_prepare.remote()
    records = verify_score.remote()
    gates = check_gates(records)
    report = {
        "reference": REFERENCE,
        "testset": VERIFICATION,
        "prepared": prepared,
        "gates": gates,
        "categories": category_report(records),
        "records": records,
    }
    write(f"verification-{VERIFICATION}-{REFERENCE}.json", report)
    finished = verify_finish.remote({"passed": gates["passed"], "checks": gates["checks"]})
    write(f"manifest-{VERIFICATION}.json", finished)
    _log(f"{REFERENCE} {VERIFICATION} portes : " + json.dumps(gates, ensure_ascii=False))


def _run_threshold(out_dir: Path, run: str, langs: list[str], suffix: str = "") -> None:
    """Seuil choisi sur la calibration, puis mesure unique sur les jeux de test (ADR-0013)."""
    for language in langs:
        reference = reference_for(language, run)
        result = threshold.remote(run, language)
        (out_dir / f"threshold-{reference}.json").write_text(
            json.dumps(result.pop("threshold"), indent=1) + "\n", encoding="utf-8"
        )
        if result:
            _write_results(out_dir, reference, result, suffix)


def _write_results(out_dir: Path, reference: str, result: dict[str, Any], suffix: str = "") -> None:
    """Paquet (s'il a changé), rapports et portes d'un modèle, sans aucun texte. `suffix` :
    rapports au seuil propre, à côté de ceux du seuil général."""
    if "manifest" in result:
        (out_dir / reference).mkdir(exist_ok=True)
        (out_dir / reference / "manifest.json").write_text(
            json.dumps(result["manifest"], indent=2) + "\n", encoding="utf-8"
        )
    (out_dir / f"report-{TESTSET}-{reference}{suffix}.json").write_text(
        json.dumps(result["report"], indent=2) + "\n", encoding="utf-8"
    )
    _log(f"{reference} : " + json.dumps(result["report"]["metrics"]))
    if "robustness" in result:
        (out_dir / f"robustness-{ROBUSTNESS}-{reference}{suffix}.json").write_text(
            json.dumps(result["robustness"], indent=1) + "\n", encoding="utf-8"
        )
        categories = {
            k: v.get("likely_ai")
            for k, v in result["robustness"]["categories"].items()
            if k != "_overall"
        }
        _log(f"{reference} robustesse (part « Probablement IA ») : {categories}")
    if "formal" in result:
        (out_dir / f"robustness-{FORMAL}-{reference}{suffix}.json").write_text(
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
