"""Jeu de vérification verification-en-v1 (ADR-0016) : sources, dépôt, sélection, portes."""

import io
import json
from collections import Counter
from typing import Any

from train.verification import (
    GATES,
    MIN_ASSISTANTS,
    MIN_HUMANS,
    QUOTAS,
    arxiv_document,
    arxiv_page,
    check_gates,
    check_sizes,
    exclude_known,
    html_to_text,
    iter_posts,
    keep_line,
    manifest_entry,
    parse_deposit,
    select,
    select_forum,
    stack_exchange_document,
    upper_bound,
)

SENTENCE = (
    "I have been working on this problem for a while and I think that the answer is not as "
    "simple as it looks, because the rules of the language are often more flexible than we "
    "were taught at school. "
)
LONG = SENTENCE * 6  # environ 220 mots


def _row(**overrides: str) -> dict[str, str]:
    row = {
        "Id": "42",
        "PostTypeId": "1",
        "CreationDate": "2020-05-01T10:00:00.000",
        "Body": f"<p>{LONG}</p><pre><code>print('x')</code></pre><blockquote>quoted</blockquote>",
    }
    row.update(overrides)
    return row


def test_html_to_text_drops_code_quotes_and_links() -> None:
    text = html_to_text(
        "<p>Hello &amp; welcome<br>to <a href='x'>the site</a> https://example.com/x</p>"
        "<pre><code>secret()</code></pre><blockquote><p>someone else</p></blockquote><p>Bye</p>"
    )
    assert text == "Hello & welcome\n\nto the site\n\nBye"


def test_iter_posts_streams_rows() -> None:
    xml = b'<posts><row Id="1" PostTypeId="1" /><row Id="2" PostTypeId="2" /></posts>'
    assert [r["Id"] for r in iter_posts(io.BytesIO(xml))] == ["1", "2"]


def test_stack_exchange_non_native_questions_only() -> None:
    inventory: Counter[str] = Counter()
    question = stack_exchange_document(_row(), "ell", inventory)
    assert question is not None
    assert question["category"] == "human_non_native"
    assert question["url"] == "https://ell.stackexchange.com/q/42"
    assert "print" not in question["text"] and "quoted" not in question["text"]
    assert question["licence"].startswith("CC BY-SA 4.0")
    # Réponses d'ELL écartées (souvent écrites par des natifs) ; gardées sur les forums.
    assert stack_exchange_document(_row(PostTypeId="2"), "ell", inventory) is None
    answer = stack_exchange_document(_row(PostTypeId="2"), "academia", inventory)
    assert answer is not None and answer["category"] == "human_forum"
    assert answer["url"] == "https://academia.stackexchange.com/a/42"


def test_stack_exchange_dates_and_length() -> None:
    inventory: Counter[str] = Counter()
    late = _row(CreationDate="2022-12-01T00:00:00.000")
    edited = _row(LastEditDate="2023-01-05T00:00:00.000")
    short = _row(Body="<p>Too short.</p>")
    for row in (late, edited, short):
        assert stack_exchange_document(row, "workplace", inventory) is None
    assert inventory["se_workplace_after_cutoff"] == 2
    assert inventory["se_workplace_too_short"] == 1
    on_cutoff = _row(CreationDate="2022-11-30T23:59:59.000")
    assert stack_exchange_document(on_cutoff, "workplace", inventory) is not None


OAI = """<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
<ListRecords>
<record><header><identifier>oai:arXiv.org:2106.00001</identifier></header>
<metadata><arXiv xmlns="http://arxiv.org/OAI/arXiv/">
<id>2106.00001</id><created>2021-06-01</created>
<license>http://creativecommons.org/licenses/by/4.0/</license>
<abstract>  {abstract}  </abstract></arXiv></metadata></record>
<record><header status="deleted"><identifier>oai:arXiv.org:2106.00002</identifier></header></record>
<resumptionToken cursor="0" completeListSize="2">token|1001</resumptionToken>
</ListRecords></OAI-PMH>"""


def test_arxiv_page_and_licences() -> None:
    records, token = arxiv_page(OAI.format(abstract=LONG).encode())
    assert token == "token|1001"
    assert len(records) == 1 and records[0]["id"] == "2106.00001"
    inventory: Counter[str] = Counter()
    document = arxiv_document(records[0], inventory)
    assert document is not None
    assert document["category"] == "human_abstract"
    assert document["url"] == "https://arxiv.org/abs/2106.00001"
    assert document["licence"].startswith("CC BY 4.0")
    closed = {**records[0], "license": "http://arxiv.org/licenses/nonexclusive-distrib/1.0/"}
    no_commercial = {**records[0], "license": "http://creativecommons.org/licenses/by-nc-sa/4.0/"}
    updated = {**records[0], "updated": "2023-02-01"}
    for record in (closed, no_commercial, updated):
        assert arxiv_document(record, inventory) is None
    assert inventory["arxiv_licence_excluded"] == 2
    assert inventory["arxiv_after_cutoff"] == 1
    _, last = arxiv_page(OAI.format(abstract=LONG).replace("token|1001", "").encode())
    assert last is None


def _doc(id_: str, sha: str, category: str = "human_forum", **extra: Any) -> dict[str, Any]:
    return {"id": id_, "sha256": sha, "category": category, "text": LONG, **extra}


def test_exclude_known_drops_duplicates_used_and_test_copies() -> None:
    from train.incoming import shingles

    inventory: Counter[str] = Counter()
    documents = [
        _doc("a", "1", url="u1"),
        _doc("b", "1"),
        _doc("c", "2", url="seen"),
        _doc("d", "3"),
        _doc("e", "4"),
    ]
    documents[4]["text"] = "Completely different words about gardening and tomatoes " * 30
    kept = exclude_known(documents, {"seen"}, {"3"}, shingles(LONG), inventory)
    assert [d["id"] for d in kept] == ["e"]
    assert inventory == Counter(
        {"human_forum_duplicate": 1, "human_forum_already_used": 1, "human_forum_test_overlap": 2}
    )


def test_selection_is_stable_and_balanced_across_forums() -> None:
    documents = [
        _doc(f"{site}-{i}", f"{site}{i}", source=f"stackexchange:{site}")
        for site in ("academia", "workplace", "writers")
        for i in range(80 if site != "writers" else 30)
    ]
    first = select_forum(documents)
    assert first == select_forum(list(reversed(documents)))
    assert len(first) == QUOTAS["human_forum"]
    sources = Counter(d["source"] for d in first)
    # Writing n'a que 30 textes : les 20 manquants viennent des autres sites.
    assert sources["stackexchange:writers"] == 30
    assert sum(sources.values()) == 150
    assert select(documents, 5) == select(list(reversed(documents)), 5)


def _line(**record: Any) -> str:
    return json.dumps({"text": LONG, **record})


def test_parse_deposit_validates_each_kind() -> None:
    inventory: Counter[str] = Counter()
    lines = [
        _line(kind="volunteer", consent_id="V-001", year=2019, genre="essay"),
        _line(kind="volunteer", year=2019),
        _line(kind="volunteer", consent_id="V-002", year=2023),
        _line(kind="assistant", source="chatgpt", genre="letter"),
        _line(kind="assistant", source="claude-web"),
        _line(kind="edited", source="gemini", genre="poem"),
        _line(kind="other"),
        "not json",
        "",
    ]
    parsed = parse_deposit(lines, inventory)
    documents = [d for d, _ in parsed]
    assert len(parsed) == 8
    volunteer, assistant, edited = documents[0], documents[3], documents[5]
    assert volunteer is not None and volunteer["category"] == "human_volunteer"
    assert volunteer["label"] == "human" and "consent_id" not in volunteer
    assert assistant is not None and assistant["category"] == "ai_assistant"
    assert assistant["source"] == "chatgpt" and assistant["genre"] == "letter"
    assert edited is not None and edited["label"] == "mixed" and edited["genre"] == "other"
    assert [d is None for d in documents] == [False, True, True, False, True, False, True, True]
    assert inventory["deposit_volunteer_no_consent"] == 1
    assert inventory["deposit_volunteer_bad_year"] == 1
    assert inventory["deposit_assistant_unknown_source"] == 1
    assert inventory["deposit_invalid_json"] == 1
    assert inventory["deposit_unknown_kind"] == 1


def test_deposit_keeps_only_assistant_lines_after_measure() -> None:
    parsed = parse_deposit(
        [
            _line(kind="volunteer", consent_id="V-1", year=2010),
            _line(kind="assistant", source="copilot"),
            _line(kind="edited", source="other"),
            "broken",
        ],
        Counter(),
    )
    assert [keep_line(d) for d, _ in parsed] == [False, True, True, False]


def test_manifest_has_no_text_and_hides_volunteer_details() -> None:
    (volunteer, _), (assistant, _) = parse_deposit(
        [
            _line(kind="volunteer", consent_id="V-1", year=2010),
            _line(kind="assistant", source="copilot"),
        ],
        Counter(),
    )
    assert volunteer is not None and assistant is not None
    entry = manifest_entry(volunteer)
    assert set(entry) == {"id", "sha256", "category", "label", "words"}
    assert "text" not in manifest_entry(assistant)
    assert manifest_entry(assistant)["source"] == "copilot"


def test_check_sizes_stops_before_gpu() -> None:
    full = {**QUOTAS, "human_volunteer": 100, "ai_assistant": MIN_ASSISTANTS}
    assert check_sizes(full) == []
    without_deposit = check_sizes(dict(QUOTAS))
    assert any("textes humains : 500" in p for p in without_deposit)
    assert any("ai_assistant : 0" in p for p in without_deposit)
    assert any("human_abstract" in p for p in check_sizes({**full, "human_abstract": 120}))


def test_upper_bound_matches_adr_values() -> None:
    assert upper_bound(0, 600) == 0.005
    assert upper_bound(1, 600) == 0.0079
    assert upper_bound(2, 600) == 0.0105
    assert upper_bound(0, 0) is None
    assert upper_bound(5, 5) == 1.0


def _records(category: str, label: str, n: int, positives: int, **extra: Any) -> list[dict]:
    return [
        {
            "category": category,
            "label": label,
            "band": "likely_ai" if i < positives else "likely_human",
            **extra,
        }
        for i in range(n)
    ]


def test_gates_pass_and_fail() -> None:
    humans = (
        _records("human_non_native", "human", 150, 2)
        + _records("human_forum", "human", 150, 1)
        + _records("human_abstract", "human", 200, 0)
        + _records("human_volunteer", "human", 100, 1)
    )
    assistants = _records("ai_assistant", "ai", 60, 50, source="chatgpt") + _records(
        "ai_assistant", "ai", 40, 20, source="gemini"
    )
    edited = _records("ai_edited", "mixed", 20, 5)
    result = check_gates(humans + assistants + edited)
    assert result["passed"] is True
    measured = result["measured"]
    assert measured["false_positive_rate"] == 0.0067
    assert measured["recall_assistants"] == 0.7
    assert measured["recall_by_source"] == {"chatgpt": 0.8333, "gemini": 0.5}
    assert measured["categories"]["human_non_native"]["false_positive_rate"] == 0.0133

    # Une catégorie au-delà de 2 % fait échouer, même si le total reste sous 1 %.
    worse = _records("human_non_native", "human", 150, 4) + humans[150:]
    assert check_gates(worse + assistants)["checks"]["category_false_positive_rate"] is False
    # Une petite catégorie (moins de 100 textes) est publiée sans porte propre.
    small = humans[:500] + _records("human_volunteer", "human", 120, 0)
    small += _records("human_volunteer_extra", "human", 40, 2)
    gated = check_gates(small + assistants)
    assert gated["measured"]["categories"]["human_volunteer_extra"]["gated"] is False
    assert gated["checks"]["category_false_positive_rate"] is True
    # Recall insuffisant.
    weak = _records("ai_assistant", "ai", 100, 59, source="copilot")
    assert check_gates(humans + weak)["checks"]["recall_assistants"] is False


def test_gates_not_evaluable_without_enough_texts() -> None:
    result = check_gates(_records("human_forum", "human", 500, 0))
    assert result["evaluable"] == {"false_positive_rate": False, "recall_assistants": False}
    assert result["passed"] is False
    assert GATES["max_false_positive_rate"] == 0.01
    assert MIN_HUMANS == 600


def test_pipeline_has_verification_stages() -> None:
    """Étapes Modal d'ADR-0016 présentes, réservées au run v2 en anglais et au run v6 en
    français (ADR-0018)."""
    import ast
    from pathlib import Path

    source = (Path(__file__).resolve().parents[1] / "pipeline.py").read_text(encoding="utf-8")
    functions = {n.name for n in ast.walk(ast.parse(source)) if isinstance(n, ast.FunctionDef)}
    assert {"verify_collect", "verify_prepare", "verify_score", "verify_finish"} <= functions
    assert '"verify-collect", "verify"' in source
    assert '(run, langs) not in (("v2", ["en"]), ("v6", ["fr"]))' in source
