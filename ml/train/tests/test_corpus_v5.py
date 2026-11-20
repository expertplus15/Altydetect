"""Corpus de Veritas FR 0.5 (ADR-0014) : corpus déposé, passages, sélection des textes
difficiles, arrêt avant génération, consignes des nouveaux registres."""

import json
from collections import Counter

from corpus.clean import MAX_WORDS, MIN_WORDS, count_words

from train.corpus_v3 import PROMPTS, plan_jobs, prompt
from train.corpus_v5 import (
    HARD_MIN,
    HARD_SHARE,
    MAX_PASSAGES_PER_DOCUMENT,
    SIZES_V5,
    cap_candidates,
    check_sources,
    passages,
    resource_documents,
    select_v5,
    web_document,
)
from train.incoming import parse_lines

PHRASE = (
    "La politique monétaire influence le coût du crédit, la valeur de la monnaie et, à terme, "
    "le niveau général des prix dans l'économie de la zone euro et de ses partenaires. "
)


def paragraphes(n: int, words: int = 60) -> str:
    unit = PHRASE * (words // count_words(PHRASE) + 1)
    return "\n\n".join(f"Partie {i}. " + " ".join(unit.split()[:words]) for i in range(n))


def test_passages_group_paragraphs_and_split_long_ones() -> None:
    out = passages(paragraphes(12))
    assert 1 <= len(out) <= MAX_PASSAGES_PER_DOCUMENT
    assert all(MIN_WORDS <= count_words(p) <= MAX_WORDS for p in out)
    # Un seul bloc de 3 000 mots, sans saut de ligne : découpé en phrases.
    long = " ".join([PHRASE] * 100)
    assert passages(long) and all(count_words(p) <= MAX_WORDS for p in passages(long))
    # Tableau de chiffres : écarté.
    assert passages("\n\n".join(["2019 12,5 % 2020 13,1 % 2021 14,2 %"] * 40)) == []


def test_resource_documents_keep_dated_french_texts_only() -> None:
    lines = [
        json.dumps({"text": paragraphes(8), "date": "2018-05-01", "source": "cours", "id": "a"}),
        json.dumps({"text": paragraphes(8) + " Fin.", "date": "2024-01-10", "id": "b"}),
        json.dumps({"text": paragraphes(8) + " Autre.", "id": "c"}),
        json.dumps(
            {
                "text": "The central bank sets the rate and the banks follow it. " * 40,
                "annee": 2015,
                "id": "d",
            }
        ),
        json.dumps({"text": paragraphes(8, words=55), "annee": 2011, "licence": "CC BY"}),
    ]
    inventory: Counter[str] = Counter()
    documents = resource_documents(parse_lines(lines), inventory)
    assert inventory["resource_after_cutoff"] == 1
    assert inventory["resource_undated"] == 1
    assert inventory["resource_not_french"] == 1
    assert inventory["resource_kept_records"] == 2
    assert documents and all(d["category"] == "human_resource" for d in documents)
    assert {d["date"][:4] for d in documents} == {"2018", "2011"}
    licences = {d["licence"] for d in documents}
    assert "CC BY" in licences and any("déclaration du déposant" in x for x in licences)
    assert any(d["source"].endswith(":cours") for d in documents)


def scored(register: str, n: int, hard: int) -> list[dict]:
    docs = [
        web_document(
            {
                "text": f"{PHRASE} Page {i:05d}. " + "mot " * 200,
                "source": "mc4-fr:2",
                "url": f"u{i}",
                "licence": "ODC-BY",
            }
        )
        for i in range(n)
    ]
    for i, d in enumerate(docs):
        d["register"] = register
        d["category"] = f"human_{register}"
        d["prior_probability"] = 0.9 if i < hard else 0.1
    return docs


def test_select_v5_takes_hard_texts_first_within_their_share() -> None:
    docs = scored("web", 3000, hard=2000)
    chosen = select_v5("web", docs)
    assert len(chosen) == SIZES_V5["web"]
    assert sum(d["prior_probability"] >= HARD_MIN for d in chosen) == int(
        SIZES_V5["web"] * HARD_SHARE
    )
    assert {d["split"] for d in chosen} <= {"train", "calibration"}
    assert select_v5("web", list(reversed(docs))) == chosen
    # Peu de textes difficiles : tous pris, le reste en ordinaires.
    few = select_v5("web", scored("web", 3000, hard=50))
    assert sum(d["prior_probability"] >= HARD_MIN for d in few) == 50
    assert len(few) == SIZES_V5["web"]


def test_cap_and_stop_rules() -> None:
    docs = scored("web", 6000, hard=0)
    assert len(cap_candidates("web", docs + docs[:10])) == 5000
    assert check_sources({"academic": 2000, "web": 900, "resource": 300}, 0.0) == []
    problems = check_sources({"academic": 1000, "web": 900, "resource": 20}, 0.10)
    assert len(problems) == 3 and "corpus déposé" in problems[-1]


def test_prompts_for_new_registers() -> None:
    humans = [{**d, "split": "train"} for d in scored("web", 30, hard=0)]
    jobs = plan_jobs(humans)
    job = next(j for js in jobs.values() for j in js)
    assert job[1] == "ai_web"
    assert "page web" in prompt(job)
    assert {"web", "resource"} <= set(PROMPTS)


def test_year_read_from_source_name_when_no_date_field() -> None:
    lines = [
        json.dumps(
            {"text": paragraphes(8), "source": "Gestion-financiere_5ed_2010.pdf", "page": 3}
        ),
        json.dumps({"text": paragraphes(8, words=55), "source": "Banque_2024.pdf", "page": 1}),
        json.dumps({"text": paragraphes(8, words=50), "source": "cours-sans-annee.pdf"}),
    ]
    inventory: Counter[str] = Counter()
    documents = resource_documents(parse_lines(lines), inventory)
    assert inventory["resource_kept_records"] == 1
    assert inventory["resource_after_cutoff"] == 1 and inventory["resource_undated"] == 1
    assert {d["date"] for d in documents} == {"2010"}
