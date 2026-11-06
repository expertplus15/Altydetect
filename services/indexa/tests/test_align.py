"""Découpage, empreintes et alignement des passages."""

from itertools import pairwise

from indexa.align import align, coverage
from indexa.fingerprint import K, shingle_hash, shingles, winnow
from indexa.text import normalize_word, tokenize

SOURCE = (
    "L'évaluation formative transforme la relation des élèves à l'erreur. Dans les classes "
    "observées, les enseignants donnent un retour régulier et précis, ce qui permet à chacun "
    "de corriger ses méthodes avant l'examen final. Les résultats montrent un gain moyen "
    "de trente-deux pour cent sur l'année scolaire."
)


def test_normalisation_sans_accents_ni_majuscules() -> None:
    assert normalize_word("Élève") == "eleve"
    assert normalize_word("Œuvre") == "oeuvre"
    tokens = tokenize("L'élève — trente-deux, l’erreur.")
    assert [t.norm for t in tokens] == ["l'eleve", "trente", "deux", "l'erreur"]
    assert tokens[0].start == 0 and tokens[0].end == 7


def test_empreintes_stables_et_winnowing() -> None:
    tokens = tokenize(SOURCE)
    hashes = shingles(tokens)
    assert len(hashes) == len(tokens) - K + 1
    assert hashes[0] == shingle_hash([t.norm for t in tokens[:K]])
    selected = winnow(hashes)
    assert 0 < len(selected) < len(hashes)
    # Au moins une empreinte retenue dans chaque fenêtre de 4.
    positions = [p for _, p in selected]
    assert all(b - a <= 4 for a, b in pairwise(positions))


def test_copie_exacte() -> None:
    text = "Introduction. " + SOURCE
    spans = align(tokenize(text), tokenize(SOURCE))
    assert len(spans) == 1
    assert spans[0].score == 1.0
    assert coverage(spans, len(tokenize(text))) > 0.95


def test_passage_retouche_reste_un_seul_passage() -> None:
    edited = SOURCE.replace("régulier et précis", "fréquent et détaillé").replace(
        "avant l'examen final", "avant le dernier examen"
    )
    spans = align(tokenize(edited), tokenize(SOURCE))
    assert len(spans) == 1
    assert 0.6 < spans[0].score < 1.0


def test_texte_sans_rapport() -> None:
    other = (
        "Le marché belge offre de nombreuses occasions aux petites entreprises de logiciels "
        "qui souhaitent se développer rapidement en Europe."
    )
    assert align(tokenize(other), tokenize(SOURCE)) == []


def test_insensible_aux_accents_et_a_la_casse() -> None:
    shouted = SOURCE.upper().replace("É", "E").replace("È", "E")
    spans = align(tokenize(shouted), tokenize(SOURCE))
    assert spans and spans[0].score == 1.0


def test_passage_trop_court_ignore() -> None:
    assert align(tokenize("dans les classes observées les enseignants"), tokenize(SOURCE)) == []
