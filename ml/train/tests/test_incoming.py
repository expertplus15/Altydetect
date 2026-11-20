"""Inspection d'un corpus déposé : forme, langues, doublons, recoupements, aucun texte."""

import json

from corpus.clean import fingerprint

from train.incoming import inspect, language_of, parse_lines, pick_text, shingles

FR = (
    "Les marchés financiers jouent un rôle central dans le financement de l'économie, car ils "
    "permettent aux entreprises de lever des capitaux et aux épargnants de placer leurs fonds. "
)
EN = "The central bank sets the interest rate that is used by the commercial banks in the economy. "


def test_pick_text_prefers_known_fields_then_longest_string() -> None:
    assert pick_text({"texte": "a", "source": "b"}) == ("texte", "a")
    assert pick_text({"titre": "court", "corps_du_doc": "beaucoup plus long"}) == (
        "corps_du_doc",
        "beaucoup plus long",
    )
    assert pick_text("ligne brute") == ("<ligne>", "ligne brute")
    assert pick_text(42) == ("<autre>", None)
    assert pick_text({"n": 1}) == ("<aucun>", None)


def test_language_guess() -> None:
    assert language_of(FR * 3) == "fr"
    assert language_of(EN * 3) == "en"
    assert language_of("trop court") == "trop_court"


def test_report_counts_without_any_text() -> None:
    secret = "Phrase témoin qui ne doit jamais apparaître dans le rapport."
    test_text = FR * 12
    lines = [
        json.dumps({"text": FR * 10 + secret, "source": "HAL", "licence": "CC BY", "date": "2019"}),
        json.dumps({"text": FR * 10 + secret, "source": "HAL", "licence": "CC BY", "date": "2019"}),
        json.dumps({"text": EN * 20, "source": "perso", "licence": "auteur", "date": "2024-03-01"}),
        json.dumps({"text": test_text, "source": "x"}),
        "pas du json " * 5,
        "",
        json.dumps({"text": ""}),
    ]
    known = {"test:detection-v2": {fingerprint(test_text)}, "corpus:v4": set()}
    report = inspect(parse_lines(lines), known, shingles(test_text))
    assert report["lines"] == 6 and report["json_lines"] == 5 and report["empty_texts"] == 1
    assert report["texts"] == 5
    assert report["duplicates_in_file"] == 1
    assert report["exact_overlap"] == {"test:detection-v2": 1}
    # Le texte de test et les deux copies qui le recoupent largement.
    assert report["partial_copy_of_testsets"] == 3
    assert report["languages"]["fr"] == 3 and report["languages"]["en"] == 1
    assert report["years"] == {"2019": 2, "2024": 1}
    assert report["metadata"]["licence"] == {"CC BY": 2, "auteur": 1}
    assert report["text_field"]["text"] == 5 and report["text_field"]["<ligne>"] == 1
    dumped = json.dumps(report, ensure_ascii=False)
    assert "témoin" not in dumped and "marchés" not in dumped and "central bank" not in dumped
