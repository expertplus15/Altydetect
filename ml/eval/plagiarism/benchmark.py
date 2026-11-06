"""Benchmark d'Indexa (IDX-WEB) sur le jeu de test plagiat gelé.

Usage : uv run --package altydetect-ml-eval python -m plagiarism.benchmark
Mesure le rappel par passage (par catégorie), la précision, les faux positifs sur les textes
originaux, le coût (requêtes et pages par document) et la latence. La recherche web est simulée
par un moteur de phrases exactes sur le corpus du jeu : le résultat mesure Indexa, pas Brave.
"""

import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from indexa.config import ENGINE_WEB
from indexa.contracts import PlagiarismInput, Scope
from indexa.engine import EngineDeps, EngineStats, analyze
from indexa.web.fetch import FixturePageFetcher
from indexa.web.search import FixtureSearchProvider

TESTSET = Path(__file__).resolve().parents[1] / "testset" / "plagiarism-v1"
REPORTS = Path(__file__).resolve().parents[1] / "reports"
# Catégories qui entrent dans la porte de sortie (la paraphrase forte est mesurée à part).
GATE_CATEGORIES = ("verbatim", "light_edit", "reordered", "partial")
# Seuil de rappel de la porte de sortie de la phase 2 (« Rappel ≥ seuil »), fixé à 90 %.
RECALL_THRESHOLD: float | None = 0.9
# Passage attendu retrouvé si une correspondance de la bonne source en couvre la moitié.
MIN_OVERLAP = 0.5


def verify_frozen() -> dict[str, Any]:
    manifest = json.loads((TESTSET / "MANIFEST.json").read_text(encoding="utf-8"))
    for name, digest in manifest["files"].items():
        actual = hashlib.sha256((TESTSET / name).read_bytes()).hexdigest()
        if actual != digest:
            raise SystemExit(
                f"Jeu de test modifié ({name}) : créez une nouvelle version (CLAUDE.md §6)."
            )
    return manifest


def overlap(a_start: int, a_end: int, b_start: int, b_end: int) -> int:
    return max(0, min(a_end, b_end) - max(a_start, b_start))


def run() -> dict[str, Any]:
    manifest = verify_frozen()
    provider = FixtureSearchProvider.from_file(TESTSET / "pages.json")
    deps = EngineDeps(search=provider, fetcher=FixturePageFetcher(provider))
    cases = [
        json.loads(line)
        for line in (TESTSET / "cases.jsonl").read_text(encoding="utf-8").splitlines()
    ]

    per_category: dict[str, dict[str, int]] = {}
    true_matches = total_matches = negative_hits = negatives = 0
    queries = pages = 0
    durations: list[float] = []
    for case in cases:
        stats = EngineStats()
        started = time.perf_counter()
        result = analyze(PlagiarismInput(text=case["text"], scope=Scope.web), deps, stats=stats)
        durations.append(time.perf_counter() - started)
        queries += stats.queries
        pages += stats.pages

        bucket = per_category.setdefault(case["category"], {"expected": 0, "found": 0})
        for expected in case["expected"]:
            bucket["expected"] += 1
            length = expected["end"] - expected["start"]
            if any(
                m.source_url == expected["source_url"]
                and overlap(m.start, m.end, expected["start"], expected["end"])
                >= MIN_OVERLAP * length
                for m in result.matches
            ):
                bucket["found"] += 1
        for m in result.matches:
            total_matches += 1
            if any(
                m.source_url == e["source_url"]
                and overlap(m.start, m.end, e["start"], e["end"]) > 0
                for e in case["expected"]
            ):
                true_matches += 1
        if case["category"] == "negative":
            negatives += 1
            negative_hits += bool(result.matches)

    gate_expected = sum(per_category.get(c, {}).get("expected", 0) for c in GATE_CATEGORIES)
    gate_found = sum(per_category.get(c, {}).get("found", 0) for c in GATE_CATEGORIES)
    recall = gate_found / gate_expected if gate_expected else 0.0
    price = os.environ.get("INDEXA_SEARCH_PRICE_PER_1000_EUR")
    queries_per_doc = queries / len(cases)
    report = {
        "engine": ENGINE_WEB,
        "testset": manifest["version"],
        "cases": len(cases),
        "recall_gate": round(recall, 4),
        "recall_threshold": RECALL_THRESHOLD,
        "gate_passed": None if RECALL_THRESHOLD is None else recall >= RECALL_THRESHOLD,
        "recall_by_category": {
            c: round(v["found"] / v["expected"], 4) if v["expected"] else None
            for c, v in sorted(per_category.items())
        },
        "precision": round(true_matches / total_matches, 4) if total_matches else None,
        "false_positive_rate_negatives": round(negative_hits / negatives, 4) if negatives else None,
        "cost": {
            "search_queries_per_document": round(queries_per_doc, 2),
            "pages_fetched_per_document": round(pages / len(cases), 2),
            "search_price_per_1000_eur": float(price) if price else None,
            "search_cost_per_document_eur": round(queries_per_doc * float(price) / 1000, 5)
            if price
            else None,
        },
        "latency_ms_per_document": round(1000 * sum(durations) / len(durations), 1),
    }
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / f"{manifest['version']}-{ENGINE_WEB}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report


if __name__ == "__main__":
    result = run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    print()
