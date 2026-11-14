"""Jeux de test gelés `detection-v1`, `detection-v2` et `detection-v3`, manifestes des corpus de
Veritas.

`detection-v1` (ADR-0009) :

Construit à partir des sorties du run v1 (manifestes sans texte : identifiant, empreinte,
source, URL, licence, partition) :
- `ml/eval/testset/detection-v1/{langue}.jsonl` : la partition « test », gelée ;
- `ml/corpus/manifests/veritas-0.1/{langue}.jsonl` : entraînement et calibration ;
- `ml/eval/testset/detection-v1/MANIFEST.json` : effectifs et empreintes des fichiers gelés.

Les textes restent dans le volume Modal `altydetect-veritas-corpus` ; ils ne sont jamais
commités.

    uv run --no-sync python -m detection.testset <dossier du run> --created AAAA-MM-JJ

`detection-v2` (test de robustesse, `detection/robustness.py`) : manifestes sans texte des
huit catégories, gelés dans `ml/eval/testset/detection-v2/` ; jamais utilisés à
l'entraînement, ni directement ni par leurs sources.

    uv run --no-sync python -m detection.testset <dossier du run> --created AAAA-MM-JJ --v2

`detection-v3` (Veritas FR 0.3, ADR-0012) : partition test du corpus de registre soutenu
(200 textes humains universitaires, 200 juridiques et leurs textes générés appariés), gelée
dans `ml/eval/testset/detection-v3/` ; le reste du corpus (entraînement et calibration) va
dans `ml/corpus/manifests/veritas-0.3/`.

    uv run --no-sync python -m detection.testset <dossier du run> --created AAAA-MM-JJ --v3
"""

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[3]
VERSION = "detection-v1"
TESTSET_DIR = REPO / "ml/eval/testset" / VERSION
CORPUS_DIR = REPO / "ml/corpus/manifests/veritas-0.1"
LANGUAGES = ("fr", "en")
LICENCE = (
    "Textes humains : ODC-BY-1.0 (allenai/c4) et conditions de Common Crawl ; "
    "textes générés : Claude (Anthropic) pour AltyDetect"
)


def _jsonl(entries: list[dict[str, Any]]) -> str:
    return "".join(json.dumps(e, ensure_ascii=False, sort_keys=True) + "\n" for e in entries)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def freeze(run_dir: Path, created: str, run_id: str) -> dict[str, Any]:
    """Écrit le jeu de test gelé et les manifestes du corpus. Refuse d'écraser un jeu gelé."""
    if (TESTSET_DIR / "MANIFEST.json").exists():
        raise RuntimeError(f"{VERSION} est gelé : créer une nouvelle version du jeu de test")
    TESTSET_DIR.mkdir(parents=True, exist_ok=True)
    CORPUS_DIR.mkdir(parents=True, exist_ok=True)
    counts: dict[str, dict[str, int]] = {}
    files: dict[str, str] = {}
    for language in LANGUAGES:
        entries = json.loads((run_dir / f"corpus-{language}.json").read_text(encoding="utf-8"))
        entries.sort(key=lambda e: e["id"])
        test = [e for e in entries if e["split"] == "test"]
        rest = [e for e in entries if e["split"] != "test"]
        (TESTSET_DIR / f"{language}.jsonl").write_text(_jsonl(test), encoding="utf-8")
        (CORPUS_DIR / f"{language}.jsonl").write_text(_jsonl(rest), encoding="utf-8")
        files[f"{language}.jsonl"] = _sha256(TESTSET_DIR / f"{language}.jsonl")
        counts[language] = dict(Counter(e["label"] for e in test))
    manifest = {
        "version": VERSION,
        "created": created,
        "run": run_id,
        "licence": LICENCE,
        "generator": "ml/train/pipeline.py (fragment 1 de C4 / mC4, textes appariés)",
        "documents": counts,
        "files": files,
    }
    (TESTSET_DIR / "MANIFEST.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def verify_frozen() -> dict[str, Any]:
    """Vérifie les empreintes du jeu gelé et l'absence de tout recouvrement avec le corpus
    d'entraînement et de calibration."""
    manifest: dict[str, Any] = json.loads(
        (TESTSET_DIR / "MANIFEST.json").read_text(encoding="utf-8")
    )
    for name, digest in manifest["files"].items():
        if _sha256(TESTSET_DIR / name) != digest:
            raise AssertionError(f"{VERSION}/{name} modifié : le jeu de test est gelé")
    for language in LANGUAGES:
        test = _read_jsonl(TESTSET_DIR / f"{language}.jsonl")
        corpus = _read_jsonl(CORPUS_DIR / f"{language}.jsonl")
        if any(e["split"] != "test" for e in test):
            raise AssertionError(f"{language} : entrée hors partition test dans le jeu gelé")
        if any(e["split"] == "test" for e in corpus):
            raise AssertionError(f"{language} : entrée de test dans le corpus d'entraînement")
        for key in ("id", "sha256"):
            shared = {e[key] for e in test} & {e[key] for e in corpus}
            if shared:
                raise AssertionError(f"{language} : {len(shared)} {key} communs test/corpus")
        if dict(Counter(e["label"] for e in test)) != manifest["documents"][language]:
            raise AssertionError(f"{language} : effectifs différents du manifeste")
    return manifest


V2 = "detection-v2"
V2_DIR = REPO / "ml/eval/testset" / V2
V2_LICENCE = (
    "Wikipédia : CC BY-SA 3.0 (legacy-datasets/wikipedia 20220301) ; textes courts et mixtes "
    "dérivés de detection-v1 ; textes générés : Qwen2.5-7B-Instruct et "
    "Mistral-7B-Instruct-v0.3 (Apache-2.0), Phi-3.5-mini-instruct (MIT)"
)


def freeze_v2(run_dir: Path, created: str, run_id: str) -> dict[str, Any]:
    """Gèle les manifestes de detection-v2 produits par le test de robustesse."""
    if (V2_DIR / "MANIFEST.json").exists():
        raise RuntimeError(f"{V2} est gelé : créer une nouvelle version du jeu de test")
    V2_DIR.mkdir(parents=True, exist_ok=True)
    counts: dict[str, dict[str, int]] = {}
    files: dict[str, str] = {}
    for language in LANGUAGES:
        entries = _read_jsonl(run_dir / f"{V2}-{language}.jsonl")
        if any("text" in e for e in entries):
            raise ValueError(f"{language} : un manifeste ne doit contenir aucun texte")
        entries.sort(key=lambda e: e["id"])
        (V2_DIR / f"{language}.jsonl").write_text(_jsonl(entries), encoding="utf-8")
        files[f"{language}.jsonl"] = _sha256(V2_DIR / f"{language}.jsonl")
        counts[language] = dict(sorted(Counter(e["category"] for e in entries).items()))
    manifest = {
        "version": V2,
        "created": created,
        "run": run_id,
        "licence": V2_LICENCE,
        "generator": "ml/eval/detection/robustness.py",
        "documents": counts,
        "files": files,
    }
    (V2_DIR / "MANIFEST.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def verify_frozen_v2() -> dict[str, Any]:
    """Empreintes de detection-v2, absence de texte, et aucun recouvrement avec le corpus
    d'entraînement de Veritas 0.1 : ni document commun, ni source tirée de ce corpus."""
    manifest: dict[str, Any] = json.loads((V2_DIR / "MANIFEST.json").read_text(encoding="utf-8"))
    for name, digest in manifest["files"].items():
        if _sha256(V2_DIR / name) != digest:
            raise AssertionError(f"{V2}/{name} modifié : le jeu de test est gelé")
    for language in LANGUAGES:
        entries = _read_jsonl(V2_DIR / f"{language}.jsonl")
        corpus = _read_jsonl(CORPUS_DIR / f"{language}.jsonl")
        test_ids = {e["id"] for e in _read_jsonl(TESTSET_DIR / f"{language}.jsonl")}
        if any("text" in e for e in entries):
            raise AssertionError(f"{language} : texte présent dans un manifeste")
        shared = {e["sha256"] for e in entries} & {e["sha256"] for e in corpus}
        if shared:
            raise AssertionError(f"{language} : {len(shared)} documents communs avec le corpus")
        for e in entries:
            sources = e.get("derived_from")
            for source in sources if isinstance(sources, list) else [sources] if sources else []:
                if source not in test_ids:
                    raise AssertionError(f"{e['id']} : source hors de detection-v1 (test)")
        counts = dict(sorted(Counter(e["category"] for e in entries).items()))
        if counts != manifest["documents"][language]:
            raise AssertionError(f"{language} : effectifs différents du manifeste")
    return manifest


V3 = "detection-v3"
V3_DIR = REPO / "ml/eval/testset" / V3
V3_CORPUS_DIR = REPO / "ml/corpus/manifests/veritas-0.3"
V3_CATEGORIES = ("human_academic", "human_legal", "ai_academic", "ai_legal")
V3_LICENCE = (
    "Textes humains : French Science Commons (CC BY, CC BY-SA, CC0, Licence ouverte, par "
    "document) et décisions de la Cour de cassation (Judilibre, Licence ouverte 2.0) ; textes "
    "générés : Qwen2.5-7B-Instruct, Mistral-7B-Instruct-v0.3, Granite-3.3-8B-Instruct "
    "(Apache-2.0)"
)


def freeze_v3(run_dir: Path, created: str, run_id: str) -> dict[str, Any]:
    """Gèle detection-v3/fr et écrit les manifestes du corpus FR 0.3 (entraînement et
    calibration ; la partition test de detection-v1 reste dans detection-v1)."""
    if (V3_DIR / "MANIFEST.json").exists():
        raise RuntimeError(f"{V3} est gelé : créer une nouvelle version du jeu de test")
    entries = json.loads((run_dir / "corpus-fr.json").read_text(encoding="utf-8"))
    if any("text" in e for e in entries):
        raise ValueError("fr : un manifeste ne doit contenir aucun texte")
    test = sorted(
        (e for e in entries if e["split"] == "test" and e.get("category") in V3_CATEGORIES),
        key=lambda e: e["id"],
    )
    corpus = sorted((e for e in entries if e["split"] != "test"), key=lambda e: e["id"])
    V3_DIR.mkdir(parents=True, exist_ok=True)
    V3_CORPUS_DIR.mkdir(parents=True, exist_ok=True)
    (V3_DIR / "fr.jsonl").write_text(_jsonl(test), encoding="utf-8")
    (V3_CORPUS_DIR / "fr.jsonl").write_text(_jsonl(corpus), encoding="utf-8")
    manifest = {
        "version": V3,
        "created": created,
        "run": run_id,
        "licence": V3_LICENCE,
        "generator": "ml/train/pipeline.py (run v3, ml/train/train/corpus_v3.py)",
        "documents": {"fr": dict(sorted(Counter(e["category"] for e in test).items()))},
        "files": {"fr.jsonl": _sha256(V3_DIR / "fr.jsonl")},
    }
    (V3_DIR / "MANIFEST.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def verify_frozen_v3() -> dict[str, Any]:
    """Empreinte de detection-v3, absence de texte, aucun document commun avec les corpus
    d'entraînement 0.1, 0.2 et 0.3 ni avec detection-v1 et detection-v2, et chaque texte
    généré apparié à un texte humain du jeu."""
    manifest: dict[str, Any] = json.loads((V3_DIR / "MANIFEST.json").read_text(encoding="utf-8"))
    if _sha256(V3_DIR / "fr.jsonl") != manifest["files"]["fr.jsonl"]:
        raise AssertionError(f"{V3}/fr.jsonl modifié : le jeu de test est gelé")
    entries = _read_jsonl(V3_DIR / "fr.jsonl")
    if any("text" in e for e in entries):
        raise AssertionError("fr : texte présent dans un manifeste")
    others: set[str] = set()
    for path in (
        CORPUS_DIR / "fr.jsonl",
        REPO / "ml/corpus/manifests/veritas-0.2/fr.jsonl",
        V3_CORPUS_DIR / "fr.jsonl",
        TESTSET_DIR / "fr.jsonl",
        V2_DIR / "fr.jsonl",
    ):
        others |= {e["sha256"] for e in _read_jsonl(path)}
    shared = {e["sha256"] for e in entries} & others
    if shared:
        raise AssertionError(f"fr : {len(shared)} documents communs avec un autre corpus ou jeu")
    humans = {e["id"] for e in entries if e["label"] == "human"}
    for e in entries:
        if e["label"] == "ai" and e.get("paired_with") not in humans:
            raise AssertionError(f"{e['id']} : texte humain apparié absent de {V3}")
    counts = dict(sorted(Counter(e["category"] for e in entries).items()))
    if counts != manifest["documents"]["fr"]:
        raise AssertionError("fr : effectifs différents du manifeste")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--created", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--v2", action="store_true", help="geler detection-v2")
    parser.add_argument("--v3", action="store_true", help="geler detection-v3 (FR 0.3)")
    args = parser.parse_args()
    if args.v3:
        print(json.dumps(freeze_v3(args.run_dir, args.created, args.run_id), indent=2))
        verify_frozen_v3()
        return
    if args.v2:
        print(json.dumps(freeze_v2(args.run_dir, args.created, args.run_id), indent=2))
        verify_frozen_v2()
        return
    print(json.dumps(freeze(args.run_dir, args.created, args.run_id), indent=2))
    verify_frozen()


if __name__ == "__main__":
    main()
