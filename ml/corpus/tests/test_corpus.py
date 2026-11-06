import gzip
import io
import json
from pathlib import Path

from corpus.clean import clean_web_text, fingerprint
from corpus.generate import ai_document, batch_request, prompt_for, read_llm_model
from corpus.human import collect, iter_records
from corpus.manifest import assign_split, manifest_entries
from corpus.sources import SOURCES

ROOT = Path(__file__).parents[3]
PROSE = " ".join(
    "Les habitants du quartier se retrouvent chaque samedi matin au marché couvert pour "
    "échanger des nouvelles et acheter des légumes cultivés dans la vallée voisine."
    for _ in range(14)
)


def test_clean_keeps_prose_and_drops_menus() -> None:
    page = "Accueil\nContact\n" + PROSE + "\nPartager sur Facebook"
    text = clean_web_text(page)
    assert text is not None and "Accueil" not in text and "Facebook" not in text


def test_clean_refuses_boilerplate_short_and_numeric_pages() -> None:
    assert clean_web_text(PROSE + " Ce site utilise des cookies.") is None
    assert clean_web_text("Une phrase de six mots bien finie.") is None
    numbers = " ".join("Le lot 123456 coûte 789 euros et 1011 centimes." for _ in range(40))
    assert clean_web_text(numbers) is None


def test_fingerprint_ignores_spacing_and_case() -> None:
    assert fingerprint("Bonjour  le Monde") == fingerprint("bonjour le monde")


def test_collect_is_deterministic_and_deduplicated() -> None:
    lines = [
        {"text": PROSE, "url": "https://a.fr"},
        {"text": PROSE, "url": "https://b.fr"},
        {"text": "court.", "url": "x"},
    ]
    raw = io.BytesIO()
    with gzip.open(raw, "wt", encoding="utf-8") as out:
        out.write("\n".join(json.dumps(line) for line in lines))
    raw.seek(0)
    docs = collect(iter_records(raw), SOURCES["fr"], "shard", limit=10)
    assert len(docs) == 1
    assert docs[0]["url"] == "https://a.fr" and docs[0]["label"] == "human"
    assert str(docs[0]["id"]).startswith("h-fr-")


def test_model_comes_from_the_single_config() -> None:
    assert read_llm_model(ROOT) == "claude-sonnet-5-5"


def test_batch_request_is_paired_cheap_and_does_not_copy_the_human_text() -> None:
    human = {"id": "h-fr-abc", "language": "fr", "text": PROSE, "words": 320}
    request = batch_request(human, "claude-sonnet-5-5")
    assert request["custom_id"] == "a-fr-abc"
    params = request["params"]
    assert params["thinking"] == {"type": "between_tools"}
    assert params["output_config"] == {"effort": "low"}
    prompt = prompt_for(human)
    assert "environ 300 mots" in prompt
    assert PROSE[:200] not in prompt  # seul le début (30 mots) sert d'amorce


def test_ai_document_drops_short_outputs() -> None:
    human = {"id": "h-en-1", "language": "en"}
    assert ai_document("a-en-1", "Too short.", human, "m") is None
    doc = ai_document("a-en-1", PROSE, human, "m")
    assert doc is not None and doc["paired_with"] == "h-en-1" and doc["source"] == "generated:m"


def test_split_and_manifest_never_keep_text() -> None:
    human = {"id": "h-fr-0000000a", "sha256": "x", "label": "human", "text": "secret"}
    ai = {"id": "a-fr-0000000a", "paired_with": "h-fr-0000000a", "text": "secret"}
    assert assign_split(human, test=False) == assign_split(ai, test=False) == "calibration"
    assert assign_split({"id": "h-fr-0000000b"}, test=False) == "train"
    assert assign_split(human, test=True) == "test"
    assert "text" not in manifest_entries([human])[0]
