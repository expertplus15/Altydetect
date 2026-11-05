"""Construit le jeu de test plagiat de façon déterministe (graine fixe), puis le fige.

Usage : uv run --package altydetect-ml-eval python -m plagiarism.build_testset
Le jeu produit (ml/eval/testset/plagiarism-v1/) ne doit plus être modifié : toute évolution
crée une nouvelle version, documentée dans docs/models/CHANGELOG.md (CLAUDE.md §6).
"""

import hashlib
import json
import random
import re
from pathlib import Path

from plagiarism.sources import FILLER_EN, FILLER_FR, LIGHT_EDITS, PARAPHRASES, SOURCES

VERSION = "plagiarism-v1"
OUT = Path(__file__).resolve().parents[1] / "testset" / VERSION
SENTENCE = re.compile(r"[^.!?]+[.!?]")


def sentences(text: str) -> list[str]:
    return [s.strip() for s in SENTENCE.findall(text)]


def is_english(url: str) -> bool:
    return not any(c in SOURCES[url][1] for c in "éèàù")


def assemble(parts: list[str], copied: list[str]) -> tuple[str, list[dict[str, int]]]:
    """Texte final et positions des passages copiés."""
    text, spans = "", []
    for part in parts:
        if text:
            text += " "
        if part in copied:
            spans.append({"start": len(text), "end": len(text) + len(part)})
        text += part
    return text, spans


def light_edit(passage: str) -> str:
    for before, after in LIGHT_EDITS.items():
        passage = passage.replace(before, after)
    return passage.replace(", ce qui", " ; cela").replace(", with", " with")


def build() -> list[dict[str, object]]:
    rng = random.Random(20261105)
    cases: list[dict[str, object]] = []
    for n, (url, (_, body)) in enumerate(SOURCES.items()):
        filler = FILLER_EN if is_english(url) else FILLER_FR
        parts = sentences(body)

        def case(
            category: str,
            copied: list[str],
            before: int = 2,
            after: int = 2,
            *,
            url: str = url,
            n: int = n,
            filler: list[str] = filler,
        ) -> None:
            pad = rng.sample(filler, before + after)
            text, spans = assemble(pad[:before] + copied + pad[before:], copied)
            cases.append(
                {
                    "id": f"{category}-{n:02d}",
                    "category": category,
                    "language": "en" if is_english(url) else "fr",
                    "text": text,
                    "expected": [{"source_url": url, **span} for span in spans]
                    if category != "negative"
                    else [],
                }
            )

        case("verbatim", parts[1:3])
        case("light_edit", [light_edit(" ".join(parts[1:3]))])
        case("reordered", [parts[2], parts[1]])
        case("partial", [max(parts, key=len)])
        if url in PARAPHRASES:
            case("paraphrase", [PARAPHRASES[url]])
        if n % 2 == 0:
            case("negative", [], before=3, after=2)
    return cases


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    pages = {
        url: {"title": title, "html": f"<article><h1>{title}</h1><p>{body}</p></article>"}
        for url, (title, body) in SOURCES.items()
    }
    (OUT / "pages.json").write_text(
        json.dumps(pages, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    cases = build()
    (OUT / "cases.jsonl").write_text(
        "".join(json.dumps(c, ensure_ascii=False) + "\n" for c in cases), encoding="utf-8"
    )
    counts: dict[str, int] = {}
    for c in cases:
        counts[str(c["category"])] = counts.get(str(c["category"]), 0) + 1
    manifest = {
        "version": VERSION,
        "created": "2026-11-05",
        "licence": "CC0 1.0 — textes rédigés pour AltyDetect, aucune donnée externe",
        "generator": "ml/eval/plagiarism/build_testset.py (graine 20261105)",
        "cases": len(cases),
        "categories": counts,
        "files": {name: sha256(OUT / name) for name in ("pages.json", "cases.jsonl")},
    }
    (OUT / "MANIFEST.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"{len(cases)} cas écrits dans {OUT}")


if __name__ == "__main__":
    main()
