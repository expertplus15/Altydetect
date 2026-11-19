"""Jeu de test gelé detection-v4 (ADR-0017) : tirages, consignes, effectifs, portes."""

import ast
from pathlib import Path
from typing import Any

from train.testset_v4 import (
    AI_SIZES,
    CLAUDE_TOPICS,
    FSC_FILES_V4,
    GATES,
    GENERATORS,
    HUMAN_SIZES,
    OVERSAMPLE,
    WEB_POOLS,
    WEB_SHARD,
    WIKIPEDIA_SHARD,
    as_category,
    check_gates,
    check_sizes,
    document,
    manifest,
    plan_open_jobs,
    split_web,
)

TEXT = "Une phrase de prose française qui sert de texte de test pour le jeu. " * 20


def _page(i: int) -> dict[str, Any]:
    return {
        "id": f"h-fr-{i:04d}",
        "sha256": f"{i:064d}",
        "text": f"{TEXT} {i}",
        "words": 200 + i % 50,
        "language": "fr",
        "url": f"https://example.fr/{i}",
        "licence": "ODC-BY-1.0",
        "source": "mc4-fr:test",
    }


def test_sources_are_new() -> None:
    """Fragments et fichiers jamais lus par les corpus 0.1 à 0.5 ni par detection-v1 à v3."""
    from train.corpus_v3 import FSC_FILES
    from train.corpus_v5 import FSC_FILES_V5
    from train.corpus_v5 import WEB_SHARD as WEB_V5

    assert not set(FSC_FILES_V4) & (set(FSC_FILES) | set(FSC_FILES_V5))
    assert "00003-of-02048" in WEB_SHARD and WEB_SHARD != WEB_V5
    assert WIKIPEDIA_SHARD.startswith("20220301.fr/") and "00002" not in WIKIPEDIA_SHARD


def test_legal_slice_does_not_overlap_the_first_one() -> None:
    from train.corpus_v3 import sample_line

    lines = [f'{{"id": {i}}}'.encode() for i in range(2000)]
    first = {line for line in lines if sample_line(line)}
    second = {line for line in lines if sample_line(line, residue=1)}
    assert first and second and not first & second


def test_split_web_is_stable_and_disjoint() -> None:
    pages = [_page(i) for i in range(800)]
    pools = split_web(pages)
    assert pools == split_web(list(reversed(pages)))
    assert {k: len(v) for k, v in pools.items()} == WEB_POOLS
    ids = [p["id"] for pool in pools.values() for p in pool]
    assert len(ids) == len(set(ids))


def test_documents_and_manifest() -> None:
    human = as_category({**_page(1), "date": "2019-04-01"}, "human_web")
    assert human["id"].startswith("v4-fr-human_web-") and human["label"] == "human"
    assert human["derived_from"] == "h-fr-0001" and human["date"] == "2019-04-01"
    ai = document("ai_claude", "ai", TEXT, generator="claude")
    entries = manifest([ai, human])
    assert [e["id"] for e in entries] == sorted([ai["id"], human["id"]])
    assert all("text" not in e for e in entries)


def test_open_jobs_use_distinct_pages_per_generator() -> None:
    topics = [_page(i) for i in range(480)]
    claude = [{**_page(1000 + i), "id": f"a-fr-{i:04d}"} for i in range(240)]
    jobs = plan_open_jobs(topics, claude)
    per = round(OVERSAMPLE * 100)
    assert {k: sum(j[1] == f"ai_{k}" for j in v) for k, v in jobs.items()} == dict.fromkeys(
        GENERATORS, per
    )
    pages = [j[2]["id"] for v in jobs.values() for j in v if j[1] != "ai_reformulated"]
    assert len(pages) == len(set(pages)) == 4 * per
    reformulated = [j for j in jobs["mistral"] if j[1] == "ai_reformulated"]
    assert len(reformulated) == round(OVERSAMPLE * AI_SIZES["ai_reformulated"])
    assert all(j[0] == "fr" and j[3] == j[2]["words"] for v in jobs.values() for j in v)
    assert jobs == plan_open_jobs(list(reversed(topics)), list(reversed(claude)))
    assert CLAUDE_TOPICS == 240


def test_check_sizes_tolerates_missing_legal_only() -> None:
    full = {**HUMAN_SIZES, **AI_SIZES}
    assert check_sizes(full) == []
    assert check_sizes({**full, "human_legal": 40}) == []
    assert check_sizes({**full, "ai_phi": 99}) == ["ai_phi : 99 pour 100"]


def _row(label: str, n: int, likely_ai: float) -> dict[str, Any]:
    return {"label": label, "documents": n, "errors": 0, "likely_ai": likely_ai}


def _categories(**overrides: float) -> dict[str, Any]:
    rates = {
        "human_web": 0.005,
        "human_wikipedia": 0.0,
        "human_academic": 0.01,
        "human_legal": 0.0,
        "human_short": 0.02,
        "ai_claude": 0.97,
        "ai_qwen": 0.9,
        "ai_mistral": 0.9,
        "ai_granite": 0.8,
        "ai_reformulated": 0.7,
        "ai_phi": 0.65,
        "mixed": 0.5,
        **overrides,
    }
    sizes = {**HUMAN_SIZES, **AI_SIZES}
    report = {
        c: _row("human" if c.startswith("human") else "ai", sizes[c], r) for c, r in rates.items()
    }
    report["_overall"] = {"false_positive_rate": None}
    return report


def test_gates_pass() -> None:
    result = check_gates(_categories())
    assert result["passed"] is True
    measured = result["measured"]
    # (2 + 0 + 2 + 0 + 2) / 1 100
    assert measured["false_positive_rate"] == 0.0055
    assert measured["recall_claude"] == 0.97
    assert measured["recall_seen"] == 0.825
    assert measured["recall_unseen"] == 0.65
    assert measured["false_positive_rate_by_category"]["human_short"] == 0.02
    assert result["gates"] == GATES


def test_gates_fail_on_each_rule() -> None:
    assert check_gates(_categories(human_academic=0.04))["checks"]["false_positive_rate"] is False
    assert check_gates(_categories(ai_claude=0.94))["checks"]["recall_claude"] is False
    assert check_gates(_categories(ai_phi=0.5))["checks"]["recall_unseen"] is False
    missing = _categories()
    del missing["ai_phi"]
    assert check_gates(missing)["checks"]["recall_unseen"] is False


def test_pipeline_has_testset_v4_stages() -> None:
    source = (Path(__file__).resolve().parents[1] / "pipeline.py").read_text(encoding="utf-8")
    functions = {n.name for n in ast.walk(ast.parse(source)) if isinstance(n, ast.FunctionDef)}
    assert {"v4_humans", "v4_claude", "v4_assemble", "v4_measure"} <= functions
    assert '"testset-v4", "measure-v4"' in source
    assert 'run != "v6" or langs != ["fr"]' in source
    # Mesure unique : marque écrite dans le volume, seconde mesure refusée.
    assert "déjà mesuré (ADR-0017)" in source
