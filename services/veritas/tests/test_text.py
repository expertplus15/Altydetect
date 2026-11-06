from veritas.text import count_words, detect_language, split_sentences


def test_count_words_keeps_elisions_and_hyphens() -> None:
    assert count_words("L’état d'esprit, c'est-à-dire 32 %.") == 4


def test_split_sentences_returns_exact_positions() -> None:
    text = "  Première phrase. « Deuxième ? » Troisième !\n\nTitre\n\nFin"
    sentences = split_sentences(text)
    assert [text[s.start : s.end] for s in sentences] == [
        "Première phrase.",
        "« Deuxième ? »",
        "Troisième !",
        "Titre",
        "Fin",
    ]
    assert sentences[0].words == 2


def test_split_sentences_ignores_punctuation_only_chunks() -> None:
    assert split_sentences("... ") == []


def test_detect_language() -> None:
    assert detect_language("Le chat est sur la table et il dort.") == "fr"
    assert detect_language("The cat is on the table and it sleeps.") == "en"
