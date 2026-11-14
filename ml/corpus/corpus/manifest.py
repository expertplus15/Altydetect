"""Manifestes commitables : tout sauf le texte (CLAUDE.md §6)."""

from collections.abc import Iterable
from typing import Any

MANIFEST_FIELDS = (
    "id",
    "sha256",
    "label",
    "language",
    "words",
    "source",
    "url",
    "paired_with",
    "licence",
    "split",
    # Veritas 0.2 : textes de modèles ouverts, reformulations et textes mixtes.
    "category",
    "generator",
    "derived_from",
    "ai_starts_at",
    # Veritas FR 0.3 : registre (universitaire, juridique) et date du texte humain.
    "register",
    "date",
)


def manifest_entries(documents: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: d[k] for k in MANIFEST_FIELDS if k in d} for d in documents]


def assign_split(document: dict[str, Any], test: bool) -> str:
    """Fragment de test → « test » ; sinon 1 document sur 10 (selon l'empreinte de son texte
    humain d'origine) en calibration, le reste en entraînement. Un texte généré suit toujours
    le texte humain auquel il est apparié."""
    if test:
        return "test"
    anchor = str(document.get("paired_with", document["id"]))
    return "calibration" if int(anchor.split("-")[-1][:8], 16) % 10 == 0 else "train"
