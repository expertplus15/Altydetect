"""Sources des textes humains : C4 / mC4 (allenai/c4 sur Hugging Face), licence ODC-BY 1.0.

Pages web de l'exploration Common Crawl d'avril 2019 pour mC4 et C4 : antérieures aux
générateurs de texte grand public, donc sans contamination par des textes d'IA. Le fragment 0
alimente l'entraînement et la calibration, le fragment 1 le jeu de test gelé.
"""

from dataclasses import dataclass

HF_BASE = "https://huggingface.co/datasets/allenai/c4/resolve/main"
LICENCE = "ODC-BY-1.0 (allenai/c4) ; conditions d'utilisation de Common Crawl"


@dataclass(frozen=True, slots=True)
class HumanSource:
    language: str
    name: str
    train_shard: str
    test_shard: str

    def url(self, shard: str) -> str:
        return f"{HF_BASE}/{shard}"


SOURCES: dict[str, HumanSource] = {
    "fr": HumanSource(
        language="fr",
        name="mc4-fr",
        train_shard="multilingual/c4-fr.tfrecord-00000-of-02048.json.gz",
        test_shard="multilingual/c4-fr.tfrecord-00001-of-02048.json.gz",
    ),
    "en": HumanSource(
        language="en",
        name="c4-en",
        train_shard="en/c4-train.00000-of-01024.json.gz",
        test_shard="en/c4-train.00001-of-01024.json.gz",
    ),
}
