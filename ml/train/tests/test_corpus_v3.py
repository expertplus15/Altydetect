"""Corpus de Veritas FR 0.3 (ADR-0012) : filtres des sources, nettoyage, partitions, consignes,
documents générés et portes de sortie."""

from collections import Counter

from corpus.clean import count_words

from train.corpus_v2 import BY_LANGUAGE, HELD_OUT, OPEN_GENERATORS
from train.corpus_v3 import (
    PROMPTS,
    SIZES,
    TEST_SIZE,
    academic_licence,
    check_gates,
    clean_academic,
    clean_legal,
    generated_document,
    human_document,
    in_period,
    match_typography,
    plan_jobs,
    prompt,
    sample_line,
    split_humans,
)

PROSE = (
    "La notion de patrimoine immatériel s'est imposée progressivement dans les politiques "
    "culturelles des collectivités territoriales, qui y voient un levier de développement local "
    "autant qu'un outil de reconnaissance des pratiques ordinaires des habitants (Martin, 2014)."
)


def paragraphe(i: int) -> str:
    numero = "un deux trois quatre cinq six sept huit".split()[i % 8]
    return (
        f"{PROSE} Le cas numéro {numero} le montre, sans épuiser la diversité des terrains étudiés."
    )


def page_universitaire() -> str:
    return "\n\n".join(
        [
            "## 2. Cadre théorique",
            paragraphe(0),
            paragraphe(1),
            paragraphe(2),
            "| Année | Effectif |\n| --- | --- |\n| 2010 | 12 |",
            paragraphe(3),
            paragraphe(4),
            paragraphe(5),
            paragraphe(6),
            "Ma chandelle est morte,\nJe n'ai plus de feu ;\nOuvre-moi ta porte,\nPour l'amour.",
        ]
    )


def test_licences_and_dates() -> None:
    assert academic_licence("CC-by/4.0") == "CC BY 4.0"
    assert academic_licence("Etalab-2.0") == "Licence ouverte 2.0"
    assert academic_licence("cc-by-nc-nd") is None
    assert academic_licence(None) is None
    assert in_period("2021-05-03") and in_period("2019")
    assert not in_period("2022-07-01") and not in_period("2024")
    assert not in_period("") and not in_period(None) and not in_period("inconnue")
    assert in_period("2010-01-01", start="2005-01-01") and not in_period("2004-12-31", "2005-01-01")


def test_clean_academic_keeps_contiguous_prose_only() -> None:
    text = clean_academic(page_universitaire())
    assert text is not None
    assert "Cadre théorique" not in text and "|" not in text and "chandelle" not in text
    # Les quatre paragraphes après le tableau forment la plus longue suite.
    assert text.count("\n\n") == 3 and "Le cas numéro quatre" in text
    assert 180 <= count_words(text) <= 900


def test_clean_academic_rejects_layout_hyphens_formulas_and_short_pages() -> None:
    coupe = PROSE.replace("progressivement", "progressi-vement")
    page = "\n\n".join([coupe] * 6)
    assert clean_academic(page) is None
    formules = "\n\n".join([PROSE + " Soit $x^2$ la variance."] * 6)
    assert clean_academic(formules) is None
    assert clean_academic(PROSE) is None  # moins de 180 mots
    composes = PROSE.replace("progressivement", "peut-être, au-delà des sous-ensembles,")
    assert clean_academic("\n\n".join([composes] * 6)) is not None


def test_clean_legal_keeps_reasoning_without_parties_or_headers() -> None:
    motif = (
        "Attendu qu'en statuant ainsi, alors que l'employeur était tenu d'une obligation de "
        "sécurité dont il devait assurer l'effectivité dans l'entreprise, la cour d'appel a "
        "violé les textes susvisés ;"
    )
    lines = [
        "LA COUR DE CASSATION, CHAMBRE SOCIALE, a rendu l'arrêt suivant :",
        "Statuant sur le pourvoi formé par M. Frédéric Y..., domicilié à Nancy, contre l'arrêt ;",
        "Avocat général : M. Cuny ;",
        *[f"{i}. {motif}" for i in range(1, 8)],
        "\" aux motifs que la procédure a débuté dans le cadre d'une enquête préliminaire ;",
        "PAR CES MOTIFS : CASSE ET ANNULE, dans toutes ses dispositions, l'arrêt rendu le 27 mai ;",
    ]
    text = clean_legal("\n".join(lines))
    assert text is not None
    assert "Y..." not in text and "LA COUR" not in text and "Avocat" not in text
    assert not text.startswith("1.") and text.count("Attendu") == 7
    anonymise = "\n".join([motif.replace("l'employeur", "M. [K] [N]")] * 20)
    assert clean_legal(anonymise) is None


def candidats(register: str, n: int) -> list[dict]:
    return [
        human_document(
            register,
            f"{PROSE} Document {i:05d} " + "mot " * 200,
            "test",
            f"u{i}",
            "CC BY",
            "2020-01-01",
        )
        for i in range(n)
    ]


def test_split_humans_sizes_and_frozen_test() -> None:
    docs = candidats("academic", SIZES["academic"] + 300)
    chosen = split_humans("academic", docs)
    assert len(chosen) == SIZES["academic"]
    splits = Counter(d["split"] for d in chosen)
    assert splits["test"] == TEST_SIZE and splits["calibration"] > 0 and splits["train"] > 0
    # Tirage stable, indépendant de l'ordre d'entrée.
    assert split_humans("academic", list(reversed(docs))) == chosen
    assert all(d["category"] == "human_academic" and d["id"].startswith("h-fr-") for d in chosen)


def test_plan_prompts_and_generated_documents() -> None:
    humans = split_humans("legal", candidats("legal", SIZES["legal"]))
    jobs = plan_jobs(humans)
    assert set(jobs) == set(BY_LANGUAGE["fr"])
    assert not {OPEN_GENERATORS[k] for k in jobs} & set(HELD_OUT.values())
    assert sum(len(v) for v in jobs.values()) == len(humans)
    assert min(len(v) for v in jobs.values()) > len(humans) / 5
    key, job = next((k, j) for k in jobs for j in jobs[k] if j[2]["split"] == "test")
    text = prompt(job)
    assert "Cour de cassation" in text and "jamais par un nom" in text
    assert PROMPTS["academic"] != PROMPTS["legal"]
    raw = "## Titre\n\n" + " ".join(["Le juge apprécie souverainement les éléments."] * 40)
    document = generated_document(job, key, raw)
    assert document is not None
    assert document["split"] == "test" and document["paired_with"] == job[2]["id"]
    assert document["category"] == "ai_legal" and document["label"] == "ai"
    assert document["id"].startswith("f-fr-") and "Titre" not in document["text"]
    assert generated_document(job, key, "Trop court.") is None


def test_sample_line_is_stable() -> None:
    lines = [f'{{"id": "{i}"}}'.encode() for i in range(10_000)]
    kept = [line for line in lines if sample_line(line)]
    assert kept == [line for line in lines if sample_line(line)]
    assert 250 < len(kept) < 550


def rapport(**categories: tuple[str, float, int]) -> dict:
    report = {
        name: {"label": label, "documents": n, "errors": 0, "likely_ai": rate}
        for name, (label, rate, n) in categories.items()
    }
    humans = [(r, n) for label, r, n in categories.values() if label == "human"]
    total = sum(n for _, n in humans)
    report["_overall"] = {
        "false_positive_rate": sum(r * n for r, n in humans) / total if total else None,
        "humans": total,
    }
    return report


def test_gates_count_detection_v3() -> None:
    v1 = {"false_positive_rate": 0.0, "documents": {"human": 1000}, "recall": 1.0}
    v2 = rapport(
        human_wikipedia=("human", 0.0, 300),
        human_short=("human", 0.0, 100),
        ai_qwen=("ai", 1.0, 90),
        ai_mistral=("ai", 1.0, 100),
        ai_reformulated=("ai", 1.0, 100),
        ai_phi=("ai", 0.9, 100),
    )
    good = rapport(
        human_academic=("human", 0.0, 200),
        human_legal=("human", 0.005, 200),
        ai_academic=("ai", 0.95, 200),
        ai_legal=("ai", 0.95, 200),
    )
    result = check_gates(v1, v2, good)
    assert result["passed"]
    assert result["measured"]["false_positive_rate_wikipedia"] == 0.0
    # 10 % de faux positifs sur les textes juridiques : 20 sur 1 800 humains, > 1 %.
    bad = rapport(
        human_academic=("human", 0.0, 200),
        human_legal=("human", 0.1, 200),
        ai_academic=("ai", 0.95, 200),
        ai_legal=("ai", 0.95, 200),
    )
    result = check_gates(v1, v2, bad)
    assert not result["passed"] and not result["checks"]["false_positive_rate"]
    assert result["measured"]["false_positive_rate"] == round(20 / 1800, 4)


def test_generated_text_takes_typography_of_its_human_text() -> None:
    generated = "L'arrêt est cassé ; « la cour » l'a dit."
    assert (
        match_typography(generated, "l’arrêt d’appel") == "L’arrêt est cassé ; « la cour » l’a dit."
    )
    assert match_typography("l’arrêt", "l'arrêt") == "l'arrêt"
    insecable = match_typography(generated, "Il dit\u202f: « non\u202f».")
    assert "\u202f;" in insecable and "«\u202fla cour\u202f»" in insecable
    assert match_typography("a\u00a0; b", "sans espace insécable") == "a ; b"


def test_cleaners_remove_source_artefacts() -> None:
    note = "\n\n".join([PROSE.replace("(Martin, 2014).", '(Martin, 2014)<fnref n="1" />.')] * 6)
    text = clean_academic(note)
    assert text is not None and "<" not in text
    motif = (
        "Attendu que l'ordonnance prévue par l'article 706¿96 du code de procédure pénale doit "
        "être motivée au regard des éléments précis et circonstanciés résultant de la procédure ;"
    )
    legal = clean_legal("\n".join([motif] * 8))
    assert legal is not None and "706-96" in legal and "¿" not in legal
