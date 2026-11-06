"""Nettoyage des pages web humaines : on garde de la prose, pas des menus ni des listes."""

import hashlib
import re
import unicodedata

MIN_WORDS = 180
MAX_WORDS = 900

_WORD = re.compile(r"[^\W_]+(?:['’-][^\W_]+)*", re.UNICODE)
_BOILERPLATE = re.compile(
    r"cookie|javascript|lorem ipsum|tous droits réservés|all rights reserved|"
    r"newsletter|\bcopyright\b|politique de confidentialité|privacy policy|"
    r"cliquez ici|click here|ajouter au panier|add to cart",
    re.IGNORECASE,
)


def count_words(text: str) -> int:
    return len(_WORD.findall(text))


def fingerprint(text: str) -> str:
    """Empreinte SHA-256 du texte normalisé (espaces, casse) : identifiant et déduplication."""
    normalized = " ".join(unicodedata.normalize("NFC", text).lower().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def clean_web_text(raw: str) -> str | None:
    """Texte de prose d'au moins MIN_WORDS mots, ou None si la page ne convient pas.

    Lignes gardées : phrases terminées par une ponctuation finale, d'au moins 6 mots. La page
    est refusée si elle contient du texte de gabarit (cookies, mentions légales…), trop de
    chiffres ou de caractères spéciaux, ou si elle sort des bornes de longueur.
    """
    if _BOILERPLATE.search(raw):
        return None
    lines = []
    for line in raw.splitlines():
        stripped = " ".join(line.split())
        if count_words(stripped) >= 6 and stripped[-1:] in '.!?…»"”':
            lines.append(stripped)
    text = "\n\n".join(lines)
    words = count_words(text)
    if not MIN_WORDS <= words <= MAX_WORDS:
        return None
    letters = sum(ch.isalpha() for ch in text)
    digits = sum(ch.isdigit() for ch in text)
    if letters < 0.7 * len(text) or digits > 0.05 * len(text):
        return None
    return text
