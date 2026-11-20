"""Jeu de vérification verification-fr-v1 (ADR-0018) : forum, résumés HAL, dépôt, sélection."""

import json
from collections import Counter
from typing import Any

from train.verification import (
    EN,
    FR,
    PROTOCOLS,
    check_sizes,
    hal_document,
    hal_licence,
    hal_page,
    hal_query,
    parse_deposit,
    select_public,
    stack_exchange_document,
)

PHRASE = (
    "Je travaille sur cette question depuis plusieurs semaines et je pense que la réponse "
    "n'est pas aussi simple qu'elle le paraît, parce que les règles de la langue sont souvent "
    "plus souples que ce que nous avons appris à l'école. "
)
LONG = PHRASE * 6  # environ 230 mots
ENGLISH = (
    "I have been working on this problem for a while and I think that the answer is not as "
    "simple as it looks, because the rules are often more flexible than we were taught. "
) * 8


def _row(**overrides: str) -> dict[str, str]:
    row = {
        "Id": "7",
        "PostTypeId": "2",
        "CreationDate": "2019-03-01T10:00:00.000",
        "Body": f"<p>{LONG}</p><blockquote>citation</blockquote>",
    }
    row.update(overrides)
    return row


def test_protocols() -> None:
    assert PROTOCOLS == {"en": EN, "fr": FR}
    assert (FR.version, FR.language, FR.reference, FR.run) == (
        "verification-fr-v1",
        "fr",
        "VRT-DET-FR-0.6",
        "v6",
    )
    assert FR.deposit_dir == "incoming/verification-fr-v1"
    assert dict(FR.quotas) == {"human_forum": 150, "human_abstract": 350}
    assert FR.public_total == 500 and "lechat" in FR.assistants
    assert EN.deposit_dir == "incoming/verification-en-v1"


def test_french_forum_keeps_questions_and_answers_in_french() -> None:
    inventory: Counter[str] = Counter()
    answer = stack_exchange_document(_row(), "french", inventory, FR)
    assert answer is not None
    assert answer["category"] == "human_forum" and answer["language"] == "fr"
    assert answer["url"] == "https://french.stackexchange.com/a/7"
    assert "citation" not in answer["text"]
    question = stack_exchange_document(_row(PostTypeId="1"), "french", inventory, FR)
    assert question is not None and question["url"].endswith("/q/7")
    # Messages en anglais (fréquents sur ce site) écartés.
    english = _row(Body=f"<p>{ENGLISH}</p>")
    assert stack_exchange_document(english, "french", inventory, FR) is None
    assert inventory["se_french_not_french"] == 1
    late = _row(LastEditDate="2023-01-01T00:00:00.000")
    assert stack_exchange_document(late, "french", inventory, FR) is None
    assert inventory["se_french_after_cutoff"] == 1


def test_hal_query_and_page() -> None:
    url = hal_query()
    assert url.startswith("https://api.archives-ouvertes.fr/search/?")
    assert "language_s%3Afr" in url and "cursorMark=%2A" in url
    assert "licence_s" in url and "fr_abstract_s" in url
    assert "licence_s%3A" not in hal_query(licence_filter=False)
    body = json.dumps(
        {"response": {"numFound": 2, "docs": [{"halId_s": "hal-1"}]}, "nextCursorMark": "AoE"}
    ).encode()
    docs, cursor, found = hal_page(body)
    assert docs == [{"halId_s": "hal-1"}] and cursor == "AoE" and found == 2


def test_hal_licences() -> None:
    assert hal_licence("http://creativecommons.org/licenses/by/4.0/") == "CC BY 4.0"
    assert hal_licence("https://creativecommons.org/licenses/by-sa/3.0/") == "CC BY-SA 3.0"
    assert hal_licence("http://creativecommons.org/publicdomain/zero/1.0/") == "CC0 1.0"
    for closed in (
        "http://creativecommons.org/licenses/by-nc/4.0/",
        "http://creativecommons.org/licenses/by-nd/4.0/",
        "http://creativecommons.org/licenses/by-nc-sa/4.0/",
        "http://hal.archives-ouvertes.fr/licences/copyright/",
        "",
        None,
    ):
        assert hal_licence(closed) is None, closed


def _hal(**overrides: Any) -> dict[str, Any]:
    record = {
        "halId_s": "hal-01234567",
        "docType_s": "ART",
        "fr_abstract_s": [f"  {LONG}  "],
        "licence_s": "http://creativecommons.org/licenses/by/4.0/",
        "producedDate_s": "2018-06",
        "submittedDate_s": "2019-01-10 12:00:00",
    }
    record.update(overrides)
    return record


def test_hal_document() -> None:
    inventory: Counter[str] = Counter()
    document = hal_document(_hal(), inventory)
    assert document is not None
    assert document["category"] == "human_abstract" and document["label"] == "human"
    assert document["url"] == "https://hal.science/hal-01234567"
    assert document["licence"] == "CC BY 4.0 (licence du dépôt)"
    assert document["text"] == LONG.strip()
    rejected = [
        _hal(licence_s="http://creativecommons.org/licenses/by-nc/4.0/"),
        _hal(submittedDate_s="2023-02-01 09:00:00"),
        _hal(fr_abstract_s=[]),
        _hal(fr_abstract_s=["Résumé trop court."]),
        _hal(fr_abstract_s=[ENGLISH]),
    ]
    assert all(hal_document(r, inventory) is None for r in rejected)
    assert inventory["hal_licence_excluded"] == 1
    assert inventory["hal_after_cutoff"] == 1
    assert inventory["hal_no_abstract"] == 1
    assert inventory["hal_too_short"] == 1
    assert inventory["hal_not_french"] == 1


def _doc(id_: str, category: str) -> dict[str, Any]:
    return {"id": id_, "category": category}


def test_select_public_completes_a_small_forum() -> None:
    forum = [_doc(f"f{i}", "human_forum") for i in range(90)]
    abstracts = [_doc(f"h{i}", "human_abstract") for i in range(600)]
    chosen = select_public(forum + abstracts)
    assert chosen == select_public(list(reversed(forum + abstracts)))
    counts = Counter(d["category"] for d in chosen)
    # 90 messages de forum seulement : les résumés complètent jusqu'à 500.
    assert counts == {"human_forum": 90, "human_abstract": 410}
    full = select_public([_doc(f"f{i}", "human_forum") for i in range(400)] + abstracts)
    assert Counter(d["category"] for d in full) == {"human_forum": 150, "human_abstract": 350}


def test_check_sizes_counts_the_public_total() -> None:
    ok = {"human_forum": 90, "human_abstract": 410, "human_volunteer": 100, "ai_assistant": 100}
    assert check_sizes(ok, FR) == []
    short = check_sizes({**ok, "human_abstract": 300}, FR)
    assert any("textes publics : 390 pour 500" in p for p in short)
    assert any("textes humains : 490 pour 600" in p for p in short)
    assert any("ai_assistant : 0" in p for p in check_sizes({**ok, "ai_assistant": 0}, FR))


def test_french_deposit_accepts_le_chat_and_rejects_english() -> None:
    inventory: Counter[str] = Counter()
    lines = [
        json.dumps({"kind": "assistant", "source": "lechat", "text": LONG}),
        json.dumps({"kind": "volunteer", "consent_id": "V-1", "year": 2015, "text": LONG}),
        json.dumps({"kind": "assistant", "source": "chatgpt", "text": ENGLISH}),
    ]
    documents = [d for d, _ in parse_deposit(lines, inventory, FR)]
    assert documents[0] is not None and documents[0]["source"] == "lechat"
    assert documents[0]["language"] == "fr"
    assert documents[1] is not None and documents[1]["category"] == "human_volunteer"
    assert documents[2] is None and inventory["deposit_assistant_not_french"] == 1
    # Le Chat n'est pas une source du protocole anglais.
    assert parse_deposit([lines[0]], Counter(), EN)[0][0] is None
