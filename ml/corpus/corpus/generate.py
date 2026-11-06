"""Textes générés par Claude, appariés aux textes humains (même sujet, même genre, même
longueur), par l'API Message Batches (moitié prix, asynchrone).

Le modèle est celui de packages/core/src/config/llm.ts : il n'est écrit nulle part ailleurs.
"""

import re
from pathlib import Path
from typing import Any

from corpus.clean import count_words, fingerprint

GENERATOR_LICENCE = "Texte généré par Claude (Anthropic) pour AltyDetect"
# Début du texte humain donné comme amorce de sujet (jamais recopié dans la sortie).
TOPIC_WORDS = 30

PROMPTS = {
    "fr": (
        "Voici le début d'une page web en français :\n\n« {start} »\n\n"
        "Écris un texte original d'environ {words} mots sur le même sujet et dans le même genre "
        "(article, page de présentation, billet de blog, message de forum…). Ne recopie pas ce "
        "début. Réponds uniquement par le texte, en paragraphes, sans titre ni commentaire."
    ),
    "en": (
        'Here is the beginning of a web page in English:\n\n"{start}"\n\n'
        "Write an original text of about {words} words on the same topic and in the same genre "
        "(article, product or service page, blog post, forum message…). Do not copy this "
        "beginning. Reply with the text only, in paragraphs, with no title or commentary."
    ),
}


def read_llm_model(repo_root: Path) -> str:
    """Lit LLM_MODEL dans packages/core/src/config/llm.ts (source unique du modèle)."""
    config = (repo_root / "packages/core/src/config/llm.ts").read_text(encoding="utf-8")
    match = re.search(r'export const LLM_MODEL = "([^"]+)"', config)
    if not match:
        raise RuntimeError("LLM_MODEL introuvable dans packages/core/src/config/llm.ts")
    return match.group(1)


def prompt_for(human: dict[str, Any]) -> str:
    words = str(human["text"]).split()
    start = " ".join(words[:TOPIC_WORDS])
    target = max(150, round(int(human["words"]) / 50) * 50)
    return PROMPTS[str(human["language"])].format(start=start, words=target)


def batch_request(human: dict[str, Any], model: str) -> dict[str, Any]:
    """Requête Message Batches pour un texte humain. Réflexion désactivée et effort faible :
    un texte courant, au moindre coût."""
    target_words = int(human["words"])
    return {
        "custom_id": str(human["id"]).replace("h-", "a-", 1),
        "params": {
            "model": model,
            "max_tokens": max(1024, target_words * 3),
            "thinking": {"type": "between_tools"},
            "output_config": {"effort": "low"},
            "messages": [{"role": "user", "content": prompt_for(human)}],
        },
    }


def ai_document(
    custom_id: str, text: str, human: dict[str, Any], model: str
) -> dict[str, object] | None:
    """Document généré, ou None s'il est trop court (refus, sortie tronquée)."""
    text = text.strip()
    words = count_words(text)
    if words < 150:
        return None
    return {
        "id": custom_id,
        "sha256": fingerprint(text),
        "label": "ai",
        "language": human["language"],
        "text": text,
        "words": words,
        "source": f"generated:{model}",
        "paired_with": human["id"],
        "licence": GENERATOR_LICENCE,
    }
