"""Corpus de Veritas 0.2 : consignes, documents dérivés, passages des textes mixtes, portes."""

import random
from collections import Counter

from detection.robustness import chunks

from train.corpus_v2 import (
    BY_LANGUAGE,
    GATES,
    HELD_OUT,
    OPEN_GENERATORS,
    SIZES,
    assign_generator,
    check_gates,
    generated_document,
    mixed_documents,
    plan_jobs,
    prompt,
)
from train.samples import labelled_passages


def lettres(n: int) -> str:
    out = ""
    while True:
        out = "abcdefghijklmnopqrstuvwxyz"[n % 26] + out
        n //= 26
        if n == 0:
            return out


def phrase(i: int, words: int = 12) -> str:
    return " ".join(f"mot{lettres(i)}x{lettres(j)}" for j in range(words - 1)) + " fin."


def texte(n: int, start: int = 0) -> str:
    return " ".join(phrase(i) for i in range(start, start + n))


def corpus(n: int, language: str = "fr") -> tuple[list[dict], list[dict]]:
    humans, claude = [], []
    for i in range(n):
        split = "test" if i % 5 == 0 else ("calibration" if i % 7 == 0 else "train")
        hid = f"h-{language}-{i:016x}"
        humans.append(
            {
                "id": hid,
                "label": "human",
                "language": language,
                "split": split,
                "text": texte(40, i),
                "words": 480,
                "licence": "ODC-BY-1.0",
            }
        )
        claude.append(
            {
                "id": f"a-{language}-{i:016x}",
                "label": "ai",
                "language": language,
                "split": split,
                "text": texte(40, 10_000 + i),
                "words": 480,
                "paired_with": hid,
                "licence": "Claude",
            }
        )
    return humans, claude


def test_held_out_generator_is_never_used() -> None:
    used = {OPEN_GENERATORS[k] for keys in BY_LANGUAGE.values() for k in keys}
    assert not used & set(HELD_OUT.values())
    assert "olmo" not in BY_LANGUAGE["fr"]  # modèle anglais seulement


def test_plan_jobs_excludes_test_split_and_spreads_generators() -> None:
    humans, claude = corpus(5000)
    jobs = plan_jobs("fr", humans, claude)
    flat = [job for js in jobs.values() for job in js]
    assert all(job[2]["split"] != "test" for job in flat)
    counts = Counter(job[1] for job in flat)
    assert counts == {"ai_open": SIZES["open"], "ai_reformulated": SIZES["reformulated"]}
    per_generator = {key: len(js) for key, js in jobs.items()}
    assert set(per_generator) == set(BY_LANGUAGE["fr"])
    assert min(per_generator.values()) > 0.8 * (len(flat) / 3)
    # Stable d'un run à l'autre (reprise des lots sauvegardés).
    again = plan_jobs("fr", list(reversed(humans)), list(reversed(claude)))
    assert [[j[2]["id"] for j in js] for js in again.values()] == [
        [j[2]["id"] for j in js] for js in jobs.values()
    ]
    assert assign_generator("x", "en") in BY_LANGUAGE["en"]


def test_reformulation_prompt_contains_source_text() -> None:
    humans, claude = corpus(50)
    job = ("fr", "ai_reformulated", claude[1], 480)
    assert claude[1]["text"] in prompt(job)
    assert "Reformule" in prompt(job)
    assert humans[1]["text"] not in prompt(("fr", "ai_open", humans[1], 480))  # sujet seul


def test_generated_document_follows_split_of_its_human_text() -> None:
    humans, claude = corpus(50)
    raw = "## Titre\n\n" + texte(20, 500)
    doc = generated_document(("fr", "ai_reformulated", claude[7], 480), "mistral", raw)
    assert doc is not None
    assert doc["paired_with"] == humans[7]["id"] and doc["split"] == "calibration"
    assert doc["generator"] == OPEN_GENERATORS["mistral"] and "Titre" not in doc["text"]
    assert generated_document(("fr", "ai_open", humans[1], 480), "qwen", "Trop court.") is None


def test_mixed_documents_and_their_labelled_windows() -> None:
    humans, claude = corpus(60)
    mixed = mixed_documents("fr", humans, claude)
    assert mixed and all(d["split"] != "test" and d["label"] == "mixed" for d in mixed)
    doc = mixed[0]
    pairs = labelled_passages(doc, random.Random(0), windows=3)
    assert pairs and {y for _, y in pairs} <= {0, 1}
    for window, y in pairs:
        joined = " ".join(window)
        if y == 0:
            assert doc["text"].index(window[0]) < doc["ai_starts_at"]
        else:
            assert doc["text"].index(joined) >= doc["ai_starts_at"]
    human_pairs = labelled_passages(humans[1], random.Random(0))
    assert human_pairs[0] == (human_pairs[0][0], 0) and len(human_pairs[0][0]) == 40


def test_generation_chunks_cover_every_job() -> None:
    humans, claude = corpus(5000, "en")
    jobs = plan_jobs("en", humans, claude)
    for key, js in jobs.items():
        idx = [i for _, chunk in chunks(key, js, 100) for i in chunk]
        assert sorted(idx) == list(range(len(js)))


def category(likely_ai: float, documents: int = 100, label: str = "ai") -> dict:
    return {"label": label, "documents": documents, "errors": 0, "likely_ai": likely_ai}


def test_gates_pass_and_fail() -> None:
    v1 = {"documents": {"human": 1000, "ai": 1000}, "false_positive_rate": 0.004, "recall": 0.99}
    v2 = {
        "ai_qwen": category(0.9),
        "ai_mistral": category(0.8),
        "ai_reformulated": category(0.85),
        "ai_phi": category(0.7),
        "_overall": {"false_positive_rate": 0.0, "humans": 400},
    }
    result = check_gates(v1, v2)
    assert result["passed"] and result["measured"]["recall_seen"] == 0.85
    assert result["measured"]["false_positive_rate"] == round(4 / 1400, 4)
    v2["ai_phi"] = category(GATES["min_recall_unseen"] - 0.1)
    failed = check_gates(v1, v2)
    assert not failed["passed"] and failed["checks"] == {
        "false_positive_rate": True,
        "recall_claude": True,
        "recall_seen": True,
        "recall_unseen": False,
    }
