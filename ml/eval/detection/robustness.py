"""Test de robustesse de Veritas 0.1 : jeu de test gelé `detection-v2` (aucun entraînement).

Veritas 0.1 n'a vu que des pages web de 2019 et des textes écrits par Claude. Ce jeu mesure ce
qu'il n'a jamais vu, par catégorie et par langue (fr, en) :

- `human_wikipedia` : articles Wikipédia de mars 2022, antérieurs aux assistants grand public
  (legacy-datasets/wikipedia 20220301, CC BY-SA 3.0) ;
- `human_short` : textes humains de detection-v1 coupés à 150-200 mots ;
- `ai_qwen`, `ai_mistral`, `ai_phi` : textes écrits par trois modèles ouverts, sur les sujets
  des textes humains de detection-v1 (mêmes consignes que le corpus Claude) ;
- `ai_reformulated` : textes de Claude de detection-v1 reformulés par Mistral ;
- `ai_short` : textes générés de detection-v1 coupés à 150-200 mots ;
- `mixed` : début d'un texte humain suivi de la fin du texte généré sur le même sujet.

Les modèles ouverts tournent sur des GPU L4 Modal, par lots de consignes indépendants (au plus
CHUNK consignes, MAX_GPUS lots en parallèle). Chaque lot terminé est sauvegardé dans le volume :
un run interrompu reprend sans régénérer ce qui est déjà fait. Les textes restent dans le volume
Modal ; seuls les manifestes (sans texte) et les métriques sont rapportés.

Lancement : workflow « Entraînement Veritas », étape `robustness`.
"""

import json
import random
import re
import time
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import Any

import modal

LANGUAGES = ("fr", "en")
VERSION = "detection-v2"
CORPUS = "/corpus"
HF_CACHE = "/hf"
V1_RUN = "v1"
REPO = Path(__file__).resolve().parents[3] if modal.is_local() else Path("/root")

# Modèles ouverts, sans accès restreint sur Hugging Face (vérifié le 12/11/2026).
GENERATORS = {
    "qwen": "Qwen/Qwen2.5-7B-Instruct",  # Apache 2.0
    "mistral": "mistralai/Mistral-7B-Instruct-v0.3",  # Apache 2.0
    "phi": "microsoft/Phi-3.5-mini-instruct",  # MIT
}
GENERATOR_LICENCES = {"qwen": "Apache-2.0", "mistral": "Apache-2.0", "phi": "MIT"}
REFORMULATOR = "mistral"
# Articles d'avant ChatGPT (novembre 2022). Fragments choisis parmi les plus légers.
WIKIPEDIA = "https://huggingface.co/datasets/legacy-datasets/wikipedia/resolve/main/data"
WIKIPEDIA_SHARDS = {
    "fr": "20220301.fr/train-00002-of-00015.parquet",
    "en": "20220301.en/train-00002-of-00041.parquet",
}
WIKIPEDIA_LICENCE = "CC BY-SA 3.0 (Wikipédia, legacy-datasets/wikipedia 20220301)"

# Effectifs par langue.
SIZES = {
    "human_wikipedia": 300,
    "human_short": 100,
    "ai_per_generator": 100,
    "ai_reformulated": 100,
    "ai_short": 100,
    "mixed": 100,
}
SHORT_MIN, SHORT_MAX = 150, 200
# Lots de génération : 50 consignes (≈ 25 min sur un L4 au pire), 8 GPU au plus en parallèle.
CHUNK = 50
MAX_GPUS = 8
MIN_WORDS, MAX_WORDS = 180, 900

REFORMULATE = {
    "fr": (
        "Reformule le texte suivant avec tes propres mots, en gardant le sens, le registre et à "
        "peu près la même longueur. Réponds uniquement par le texte reformulé, en paragraphes, "
        "sans titre ni commentaire.\n\n« {text} »"
    ),
    "en": (
        "Rewrite the following text in your own words, keeping its meaning, register and roughly "
        "the same length. Reply with the rewritten text only, in paragraphs, with no title or "
        'commentary.\n\n"{text}"'
    ),
}

_SENTENCE_END = re.compile(r"(?<=[.!?…])[\"»”]?\s+")


def _count(text: str) -> int:
    from veritas.text import count_words

    return count_words(text)


def sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_END.split(text) if s.strip()]


def truncate(text: str, low: int = SHORT_MIN, high: int = SHORT_MAX) -> str | None:
    """Premières phrases entières totalisant entre `low` et `high` mots, ou None."""
    kept: list[str] = []
    for sentence in sentences(text):
        candidate = " ".join([*kept, sentence])
        if _count(candidate) > high:
            break
        kept.append(sentence)
        if _count(candidate) >= low:
            return candidate
    return None


def mix(human: str, ai: str, each: int = 150) -> tuple[str, int] | None:
    """Environ `each` mots du début du texte humain, puis autant de la fin du texte généré.
    Renvoie le texte et la position (en caractères) où commence la partie générée."""
    head = truncate(human, each, each + 60)
    ai_sentences = sentences(ai)
    tail: list[str] = []
    for sentence in reversed(ai_sentences):
        tail.insert(0, sentence)
        if _count(" ".join(tail)) >= each:
            break
    if head is None or _count(" ".join(tail)) < each:
        return None
    return f"{head}\n\n{' '.join(tail)}", len(head) + 2


def wiki_excerpt(article: str) -> str | None:
    """Paragraphes de prose du début d'un article (180 à 900 mots), ou None."""
    paragraphs: list[str] = []
    for line in article.splitlines():
        line = " ".join(line.split())
        if _count(line) < 12 or line[-1:] not in '.!?…»"”':
            continue  # titres de section, listes, légendes
        if _count("\n\n".join([*paragraphs, line])) > MAX_WORDS:
            break
        paragraphs.append(line)
    text = "\n\n".join(paragraphs)
    if _count(text) < MIN_WORDS:
        return None
    letters = sum(ch.isalpha() for ch in text)
    digits = sum(ch.isdigit() for ch in text)
    if letters < 0.7 * len(text) or digits > 0.05 * len(text):
        return None
    return text


def clean_generation(raw: str) -> str | None:
    """Texte généré sans titres ni mise en forme Markdown ; None s'il fait moins de 150 mots."""
    lines = []
    for line in raw.splitlines():
        line = re.sub(r"[*_#`]+", "", line).strip().strip('«»"“”').strip()
        if not line:
            continue
        if _count(line) < 6 and line[-1:] not in ".!?…":
            continue  # titre
        lines.append(line)
    text = "\n\n".join(lines)
    return text if _count(text) >= 150 else None


def pick(items: Sequence[dict[str, Any]], n: int, seed: str) -> list[dict[str, Any]]:
    """Tirage déterministe, indépendant de l'ordre d'entrée."""
    ordered = sorted(items, key=lambda d: d["id"])
    return random.Random(seed).sample(ordered, min(n, len(ordered)))


def document(category: str, label: str, language: str, text: str, **fields: Any) -> dict[str, Any]:
    import hashlib

    digest = hashlib.sha256(" ".join(text.lower().split()).encode()).hexdigest()
    return {
        "id": f"v2-{language}-{category}-{digest[:16]}",
        "sha256": digest,
        "category": category,
        "label": label,
        "language": language,
        "words": _count(text),
        "text": text,
        **fields,
    }


def derived_documents(language: str, v1: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Catégories tirées du jeu detection-v1 (partition test) : courts et mixtes."""
    test = [d for d in v1 if d["split"] == "test"]
    humans = [d for d in test if d["label"] == "human"]
    ais = {d.get("paired_with"): d for d in test if d["label"] == "ai"}
    out: list[dict[str, Any]] = []
    for category, label, pool in (
        ("human_short", "human", humans),
        ("ai_short", "ai", list(ais.values())),
    ):
        chosen = 0
        for d in pick(pool, len(pool), f"{VERSION}-{language}-{category}"):
            short = truncate(d["text"])
            if short is None:
                continue
            out.append(document(category, label, language, short, derived_from=d["id"]))
            chosen += 1
            if chosen == SIZES[category]:
                break
    chosen = 0
    for h in pick(humans, len(humans), f"{VERSION}-{language}-mixed"):
        ai = ais.get(h["id"])
        if ai is None:
            continue
        mixed = mix(h["text"], ai["text"])
        if mixed is None:
            continue
        text, boundary = mixed
        out.append(
            document(
                "mixed",
                "mixed",
                language,
                text,
                derived_from=[h["id"], ai["id"]],
                ai_starts_at=boundary,
            )
        )
        chosen += 1
        if chosen == SIZES["mixed"]:
            break
    return out


def chunks(
    key: str, jobs: Sequence[tuple[str, str, dict[str, Any], int]], size: int = CHUNK
) -> list[tuple[str, list[int]]]:
    """Découpe les consignes d'un générateur en lots nommés, triés par budget de mots (des
    lots homogènes : une génération longue ne retient pas des courtes). Le découpage ne
    dépend que des consignes : un run relancé retrouve les mêmes lots et leurs sauvegardes."""
    order = sorted(range(len(jobs)), key=lambda i: (jobs[i][3], jobs[i][2]["id"], jobs[i][1]))
    return [
        (f"{key}-{n:02d}", order[start : start + size])
        for n, start in enumerate(range(0, len(order), size))
    ]


def split_on_oom(
    batch: list[int],
    run: Callable[[list[int]], list[str]],
    is_oom: Callable[[BaseException], bool],
) -> list[str]:
    """Exécute `run` sur un paquet de consignes ; si la mémoire GPU manque (consignes et
    générations longues : reformulations de Mistral), le coupe en deux et recommence."""
    try:
        return run(batch)
    except Exception as error:
        if not is_oom(error) or len(batch) == 1:
            raise
    half = len(batch) // 2
    return split_on_oom(batch[:half], run, is_oom) + split_on_oom(batch[half:], run, is_oom)


def category_report(records: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Par catégorie : part de chaque bande (seuils de production) et parts au-delà des seuils
    prudents d'une bêta (≥ 0,80 IA, ≤ 0,20 humain)."""
    records = list(records)
    by: dict[str, list[dict[str, Any]]] = {}
    for r in records:
        by.setdefault(r["category"], []).append(r)
    report: dict[str, Any] = {}
    for category, rows in sorted(by.items()):
        bands = Counter(r["band"] for r in rows if "band" in r)
        scored = [r for r in rows if "probability" in r]
        n = len(scored)
        report[category] = {
            "label": rows[0]["label"],
            "documents": len(rows),
            "errors": len(rows) - n,
            "likely_ai": round(bands["likely_ai"] / n, 4) if n else None,
            "undetermined": round(bands["undetermined"] / n, 4) if n else None,
            "likely_human": round(bands["likely_human"] / n, 4) if n else None,
            "beta_ai_ge_0_8": round(sum(r["probability"] >= 0.8 for r in scored) / n, 4)
            if n
            else None,
            "mean_probability": round(sum(r["probability"] for r in scored) / n, 4) if n else None,
        }
    humans = [r for r in records if r["label"] == "human" and "band" in r]
    ais = [r for r in records if r["label"] == "ai" and "band" in r]
    report["_overall"] = {
        "false_positive_rate": round(sum(r["band"] == "likely_ai" for r in humans) / len(humans), 4)
        if humans
        else None,
        "recall": round(sum(r["band"] == "likely_ai" for r in ais) / len(ais), 4) if ais else None,
        "humans": len(humans),
        "ais": len(ais),
    }
    return report


# --- Modal ---

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "torch==2.8.0",
        "transformers==4.57.1",
        "sentencepiece==0.2.1",
        "protobuf==6.33.0",
        "pyarrow==21.0.0",
        "pydantic==2.14.3",
        "pyyaml==6.0.3",
        "httpx2==2.16.0",
    )
    .env(
        {
            "VERITAS_CONFIG_DIR": "/root/config",
            "PYTHONPATH": "/root",
            "HF_HOME": HF_CACHE,
            "HF_HUB_DISABLE_TELEMETRY": "1",
            # Moins de fragmentation de la mémoire GPU sur les longues générations.
            "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
        }
    )
    .add_local_python_source("veritas")
    .add_local_dir(REPO / "ml/corpus/corpus", "/root/corpus")
    .add_local_dir(REPO / "ml/eval/detection", "/root/detection")
    .add_local_dir(REPO / "services/veritas/config", "/root/config")
    .add_local_dir(REPO / "services/veritas/models", "/root/models")
)
corpus_volume = modal.Volume.from_name("altydetect-veritas-corpus")
hf_volume = modal.Volume.from_name("altydetect-hf-cache", create_if_missing=True)
app = modal.App("altydetect-robustness", image=image)


def _log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def _read(path: str) -> list[dict[str, Any]]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


@app.function(volumes={HF_CACHE: hf_volume}, timeout=30 * 60, cpu=2, memory=4096)
def prefetch(model_key: str) -> None:
    """Télécharge les poids une seule fois (sans GPU) : les lots parallèles ne font que lire
    le cache, aucune écriture concurrente dans le volume."""
    from huggingface_hub import snapshot_download

    # Poids découpés seulement (Mistral publie aussi un consolidated.safetensors en double).
    snapshot_download(
        GENERATORS[model_key], allow_patterns=["*.json", "model*.safetensors", "tokenizer*"]
    )
    hf_volume.commit()
    _log(f"{model_key} : poids en cache")


def generate_texts(chunk: str, name: str, prompts: list[str], max_tokens: list[int]) -> list[str]:
    """Une réponse par consigne, par paquets de 16 triés par longueur, sur le GPU du conteneur.
    Partagé avec l'entraînement (ml/train/pipeline.py, corpus de Veritas 0.2)."""
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    _log(f"{chunk} : chargement de {name}, {len(prompts)} consignes")
    tokenizer = AutoTokenizer.from_pretrained(name, padding_side="left")
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(name, torch_dtype=torch.bfloat16).to("cuda")
    torch.manual_seed(0)
    order = sorted(range(len(prompts)), key=lambda i: max_tokens[i])
    outputs: list[str] = [""] * len(prompts)

    def run(batch: list[int]) -> list[str]:
        chats = [
            tokenizer.apply_chat_template(
                [{"role": "user", "content": prompts[i]}],
                tokenize=False,
                add_generation_prompt=True,
            )
            for i in batch
        ]
        encoded = tokenizer(chats, return_tensors="pt", padding=True, add_special_tokens=False)
        encoded = encoded.to("cuda")
        with torch.no_grad():
            generated = model.generate(
                **encoded,
                max_new_tokens=max(max_tokens[i] for i in batch),
                do_sample=True,
                temperature=0.8,
                top_p=0.95,
                pad_token_id=tokenizer.pad_token_id,
            )
        texts: list[str] = tokenizer.batch_decode(
            generated[:, encoded["input_ids"].shape[1] :], skip_special_tokens=True
        )
        return texts

    def is_oom(error: BaseException) -> bool:
        if not isinstance(error, torch.OutOfMemoryError):
            return False
        torch.cuda.empty_cache()
        _log(f"{chunk} : mémoire GPU insuffisante, paquet coupé en deux")
        return True

    for start in range(0, len(order), 16):
        batch = order[start : start + 16]
        texts = split_on_oom(batch, run, is_oom)
        for i, text in zip(batch, texts, strict=True):
            outputs[i] = text
        _log(f"{chunk} : {min(start + 16, len(order))}/{len(order)}")
    return outputs


@app.function(gpu="L4", volumes={HF_CACHE: hf_volume}, timeout=60 * 60, max_containers=MAX_GPUS)
def generate(
    chunk: str, model_key: str, prompts: list[str], max_tokens: list[int]
) -> tuple[str, list[str]]:
    """Génère une réponse par consigne d'un lot."""
    return chunk, generate_texts(chunk, GENERATORS[model_key], prompts, max_tokens)


@app.function(volumes={CORPUS: corpus_volume}, timeout=45 * 60, cpu=2, memory=8192)
def wikipedia(language: str, n: int) -> list[dict[str, Any]]:
    """Extraits d'articles Wikipédia tirés au hasard (graine fixe) dans un fragment."""
    import urllib.request

    import pyarrow.parquet as pq

    path = f"/tmp/wiki-{language}.parquet"
    _log(f"{language} : téléchargement de {WIKIPEDIA_SHARDS[language]}")
    urllib.request.urlretrieve(f"{WIKIPEDIA}/{WIKIPEDIA_SHARDS[language]}", path)
    table = pq.read_table(path, columns=["url", "title", "text"])
    rows = list(range(table.num_rows))
    random.Random(f"{VERSION}-{language}-wikipedia").shuffle(rows)
    urls, texts = table.column("url"), table.column("text")
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        excerpt = wiki_excerpt(texts[row].as_py())
        if excerpt is None:
            continue
        doc = document(
            "human_wikipedia",
            "human",
            language,
            excerpt,
            url=urls[row].as_py(),
            licence=WIKIPEDIA_LICENCE,
            source=f"wikipedia:{WIKIPEDIA_SHARDS[language]}",
        )
        if doc["sha256"] in seen:
            continue
        seen.add(doc["sha256"])
        out.append(doc)
        if len(out) == n:
            break
    _log(f"{language} : {len(out)} extraits Wikipédia")
    return out


@app.function(volumes={CORPUS: corpus_volume}, timeout=150 * 60)
def build(languages: list[str]) -> dict[str, list[dict[str, Any]]]:
    """Construit le jeu gelé (une seule fois) ; renvoie les manifestes sans texte."""
    from corpus.generate import prompt_for

    base = f"{CORPUS}/{VERSION}"
    if all(Path(f"{base}/{lang}.jsonl").exists() for lang in languages):
        _log(f"{VERSION} existe déjà : jeu gelé, rien n'est régénéré")
    else:
        v1 = {
            lang: _read(f"{CORPUS}/{V1_RUN}/{lang}/human.jsonl")
            + _read(f"{CORPUS}/{V1_RUN}/{lang}/ai.jsonl")
            for lang in languages
        }
        docs: dict[str, list[dict[str, Any]]] = {lang: [] for lang in languages}
        for lang in languages:
            docs[lang] += wikipedia.remote(lang, SIZES["human_wikipedia"])
            docs[lang] += derived_documents(lang, v1[lang])

        # Consignes de chaque générateur, toutes langues confondues.
        jobs: dict[str, list[tuple[str, str, dict[str, Any], int]]] = {}  # langue, catégorie…
        for key in GENERATORS:
            jobs[key] = []
            for lang in languages:
                test = [d for d in v1[lang] if d["split"] == "test"]
                humans = [d for d in test if d["label"] == "human"]
                for h in pick(humans, SIZES["ai_per_generator"], f"{VERSION}-{lang}-{key}"):
                    jobs[key].append((lang, f"ai_{key}", h, int(h["words"])))
                if key == REFORMULATOR:
                    ais = [d for d in test if d["label"] == "ai"]
                    for a in pick(ais, SIZES["ai_reformulated"], f"{VERSION}-{lang}-reform"):
                        jobs[key].append((lang, "ai_reformulated", a, int(a["words"])))

        # Lots déjà générés par un run précédent : relus, jamais régénérés.
        partial = Path(f"{base}/partial")
        partial.mkdir(parents=True, exist_ok=True)
        plan = {name: (key, idx) for key in GENERATORS for name, idx in chunks(key, jobs[key])}
        todo = [name for name in plan if not (partial / f"{name}.json").exists()]
        _log(f"génération : {len(plan) - len(todo)}/{len(plan)} lots déjà faits")
        for key in sorted({plan[name][0] for name in todo}):
            prefetch.remote(key)

        def arguments(name: str) -> tuple[str, str, list[str], list[int]]:
            key, idx = plan[name]
            prompts, budget = [], []
            for i in idx:
                lang, category, src, words = jobs[key][i]
                prompts.append(
                    REFORMULATE[lang].format(text=src["text"])
                    if category == "ai_reformulated"
                    else prompt_for(src)
                )
                budget.append(min(2000, int(words * 2.2) + 100))
            return name, key, prompts, budget

        failures: list[str] = []
        saved = 0
        for result in generate.starmap(
            [arguments(name) for name in todo], order_outputs=False, return_exceptions=True
        ):
            if isinstance(result, BaseException):
                failures.append(f"{type(result).__name__}: {result}")
                continue
            name, texts = result
            (partial / f"{name}.json").write_text(
                json.dumps(texts, ensure_ascii=False), encoding="utf-8"
            )
            corpus_volume.commit()  # sauvegarde immédiate : un run relancé reprend ici
            saved += 1
            _log(f"{name} : lot sauvegardé ({saved}/{len(todo)})")
        if failures:
            raise RuntimeError(
                f"{len(failures)} lots en échec (les autres sont sauvegardés) : "
                + " | ".join(failures[:3])
            )

        for key in GENERATORS:
            kept = 0
            for name, idx in chunks(key, jobs[key]):
                texts = json.loads((partial / f"{name}.json").read_text(encoding="utf-8"))
                for i, raw in zip(idx, texts, strict=True):
                    lang, category, src, _ = jobs[key][i]
                    text = clean_generation(raw)
                    if text is None:
                        continue
                    docs[lang].append(
                        document(
                            category,
                            "ai",
                            lang,
                            text,
                            generator=GENERATORS[key],
                            source=f"generated:{GENERATORS[key]}",
                            licence=f"Généré par {GENERATORS[key]} ({GENERATOR_LICENCES[key]})",
                            derived_from=src["id"],
                        )
                    )
                    kept += 1
            _log(f"{key} : {kept}/{len(jobs[key])} textes gardés")

        Path(base).mkdir(parents=True, exist_ok=True)
        for lang in languages:
            with open(f"{base}/{lang}.jsonl", "w", encoding="utf-8") as f:
                for d in sorted(docs[lang], key=lambda d: d["id"]):
                    f.write(json.dumps(d, ensure_ascii=False) + "\n")
        corpus_volume.commit()
    return {
        lang: [{k: v for k, v in d.items() if k != "text"} for d in _read(f"{base}/{lang}.jsonl")]
        for lang in languages
    }


@app.function(volumes={CORPUS: corpus_volume}, timeout=60 * 60)
def evaluate(language: str) -> dict[str, Any]:
    """Veritas 0.1 (couche 2 : application Modal déployée) sur le jeu gelé, par catégorie."""
    from veritas.engine.model import VeritasModels
    from veritas.scoring import score
    from veritas.settings import thresholds_config

    docs = _read(f"{CORPUS}/{VERSION}/{language}.jsonl")
    models = VeritasModels.load("/root/models")
    thresholds = thresholds_config().get()
    records: list[dict[str, Any]] = []
    for i, d in enumerate(docs, start=1):
        record = {"id": d["id"], "category": d["category"], "label": d["label"]}
        try:
            scored = score(models.detect(d["text"], language), d["text"], language, thresholds)
            record["probability"] = round(scored.probability, 4)
            record["band"] = scored.output.verdict_band.value
        except Exception as error:
            record["error"] = type(error).__name__
        records.append(record)
        if i % 200 == 0:
            _log(f"{language} : {i}/{len(docs)} textes notés par Veritas")
    return {
        "language": language,
        "testset": f"{VERSION}/{language}",
        "references": models.reference(language),
        "thresholds": {"likely_ai": thresholds.likely_ai, "likely_human": thresholds.likely_human},
        "categories": category_report(records),
        "records": records,
    }


@app.local_entrypoint()
def main(languages: str = "fr,en", out: str = "ml/train/out") -> None:
    langs = [lang for lang in languages.split(",") if lang in LANGUAGES]
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifests = build.remote(langs)
    for lang in langs:
        (out_dir / f"{VERSION}-{lang}.jsonl").write_text(
            "".join(
                json.dumps(m, ensure_ascii=False, sort_keys=True) + "\n" for m in manifests[lang]
            ),
            encoding="utf-8",
        )
        report = evaluate.remote(lang)
        (out_dir / f"robustness-{VERSION}-{lang}.json").write_text(
            json.dumps(report, indent=1) + "\n", encoding="utf-8"
        )
        print(json.dumps({k: v for k, v in report.items() if k != "records"}, indent=1), flush=True)
