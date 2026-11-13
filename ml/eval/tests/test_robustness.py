"""Test de robustesse : briques sans réseau ni GPU (découpe, mélange, nettoyage, rapport)."""

from veritas.text import count_words

from detection.robustness import (
    SIZES,
    category_report,
    chunks,
    clean_generation,
    derived_documents,
    mix,
    pick,
    split_on_oom,
    truncate,
    wiki_excerpt,
)


def lettres(n: int) -> str:
    """Entier écrit en lettres (a, b, …, ba…) : des mots sans chiffres, comme dans un vrai texte."""
    out = ""
    while True:
        out = "abcdefghijklmnopqrstuvwxyz"[n % 26] + out
        n //= 26
        if n == 0:
            return out


def phrase(i: int, words: int = 12) -> str:
    return " ".join(f"mot{lettres(i)}x{lettres(j)}" for j in range(words - 1)) + " fin."


def texte(n_phrases: int, start: int = 0) -> str:
    return " ".join(phrase(i) for i in range(start, start + n_phrases))


def test_truncate_keeps_whole_sentences_between_150_and_200_words() -> None:
    short = truncate(texte(40))
    assert short is not None and 150 <= count_words(short) <= 200
    assert short.endswith("fin.")
    assert truncate(texte(5)) is None  # trop court


def test_mix_puts_human_start_then_ai_end() -> None:
    result = mix(texte(40), texte(40, start=100))
    assert result is not None
    text, boundary = result
    assert text[:boundary].strip().startswith(f"mot{lettres(0)}x")
    assert f"mot{lettres(100)}x" not in text[:boundary]
    assert f"mot{lettres(139)}x" in text[boundary:]
    assert count_words(text[:boundary]) >= 150 and count_words(text[boundary:]) >= 150


def test_wiki_excerpt_keeps_prose_and_drops_headings() -> None:
    article = "Titre de section\n" + "\n".join(phrase(i, 30) for i in range(40))
    excerpt = wiki_excerpt(article)
    assert excerpt is not None and "Titre" not in excerpt
    assert 180 <= count_words(excerpt) <= 900
    assert wiki_excerpt("Trop court.\n" + phrase(1, 30)) is None


def test_clean_generation_removes_markdown_titles() -> None:
    raw = "## Un titre\n\n**Introduction**\n\n" + texte(20)
    cleaned = clean_generation(raw)
    assert cleaned is not None and "titre" not in cleaned and "*" not in cleaned
    assert clean_generation("**Trop court.**") is None


def test_pick_is_deterministic_whatever_the_input_order() -> None:
    items = [{"id": f"d{i}"} for i in range(50)]
    assert pick(items, 5, "graine") == pick(list(reversed(items)), 5, "graine")


def test_derived_documents_use_only_the_v1_test_split() -> None:
    v1 = []
    for i in range(150):
        v1.append({"id": f"h-fr-{i:04}", "label": "human", "split": "test", "text": texte(40, i)})
        v1.append(
            {
                "id": f"a-fr-{i:04}",
                "label": "ai",
                "split": "test",
                "text": texte(40, 1000 + i),
                "paired_with": f"h-fr-{i:04}",
            }
        )
    v1.append({"id": "h-fr-train", "label": "human", "split": "train", "text": texte(40, 5000)})
    docs = derived_documents("fr", v1)
    counts = {
        c: sum(d["category"] == c for d in docs) for c in ("human_short", "ai_short", "mixed")
    }
    assert counts == {c: SIZES[c] for c in counts}
    assert all("h-fr-train" not in str(d.get("derived_from")) for d in docs)
    mixed = next(d for d in docs if d["category"] == "mixed")
    assert mixed["label"] == "mixed" and mixed["ai_starts_at"] > 0


def test_category_report_counts_bands_and_overall_rates() -> None:
    records = [
        {
            "category": "human_wikipedia",
            "label": "human",
            "band": "likely_human",
            "probability": 0.1,
        },
        {"category": "human_wikipedia", "label": "human", "band": "likely_ai", "probability": 0.75},
        {"category": "ai_qwen", "label": "ai", "band": "likely_ai", "probability": 0.95},
        {"category": "ai_qwen", "label": "ai", "band": "undetermined", "probability": 0.5},
        {"category": "ai_qwen", "label": "ai", "error": "ModelUnavailableError"},
        {"category": "mixed", "label": "mixed", "band": "undetermined", "probability": 0.55},
    ]
    report = category_report(records)
    assert report["human_wikipedia"]["likely_ai"] == 0.5
    assert report["human_wikipedia"]["beta_ai_ge_0_8"] == 0.0  # 0,75 < seuil prudent
    assert report["ai_qwen"]["errors"] == 1 and report["ai_qwen"]["likely_ai"] == 0.5
    assert report["_overall"] == {"false_positive_rate": 0.5, "recall": 0.5, "humans": 2, "ais": 2}


def test_chunks_are_stable_sorted_by_budget_and_cover_every_prompt() -> None:
    jobs = [
        ("fr" if i % 2 else "en", "ai_mistral", {"id": f"h-{i:03}"}, 900 - i * 7)
        for i in range(120)
    ]
    plan = chunks("mistral", jobs, size=50)
    assert [name for name, _ in plan] == ["mistral-00", "mistral-01", "mistral-02"]
    assert [len(idx) for _, idx in plan] == [50, 50, 20]
    flat = [i for _, idx in plan for i in idx]
    assert sorted(flat) == list(range(120))  # chaque consigne une seule fois
    budgets = [jobs[i][3] for i in flat]
    assert budgets == sorted(budgets)  # lots homogènes en longueur
    # Même découpage quel que soit l'ordre d'entrée : un run relancé retrouve ses lots.
    shuffled = list(reversed(jobs))
    again = [[shuffled[i][2]["id"] for i in idx] for _, idx in chunks("mistral", shuffled, 50)]
    assert again == [[jobs[i][2]["id"] for i in idx] for _, idx in plan]


class FakeOOM(Exception):
    pass


def test_split_on_oom_halves_batch_until_it_fits() -> None:
    calls: list[list[int]] = []

    def run(batch: list[int]) -> list[str]:
        calls.append(batch)
        if len(batch) > 4:
            raise FakeOOM
        return [f"t{i}" for i in batch]

    out = split_on_oom(list(range(16)), run, lambda e: isinstance(e, FakeOOM))
    assert out == [f"t{i}" for i in range(16)]  # ordre conservé
    assert [len(c) for c in calls] == [16, 8, 4, 4, 8, 4, 4]


def test_split_on_oom_reraises_other_errors_and_single_prompt_oom() -> None:
    import pytest

    def boom(batch: list[int]) -> list[str]:
        raise ValueError("autre")

    with pytest.raises(ValueError):
        split_on_oom([1, 2], boom, lambda e: isinstance(e, FakeOOM))

    def always_oom(batch: list[int]) -> list[str]:
        raise FakeOOM

    with pytest.raises(FakeOOM):
        split_on_oom([1, 2, 3], always_oom, lambda e: isinstance(e, FakeOOM))
