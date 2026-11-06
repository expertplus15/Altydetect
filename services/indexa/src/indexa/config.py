"""Configuration d'Indexa, lue dans l'environnement (voir .env.example)."""

import os

# Références des moteurs (CLAUDE.md §1) : IDX-[WEB|PRV]-x.y.
ENGINE_WEB = "IDX-WEB-1.0"
ENGINE_PRIVATE = "IDX-PRV-1.0"

# Nombre maximal de sources privées examinées en détail par analyse.
PRIVATE_CANDIDATES = 10
# Longueur maximale d'un extrait de source renvoyé.
EXCERPT_CHARS = 300


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL manquante : voir .env.example.")
    return url


def redis_url() -> str:
    return os.environ.get("REDIS_URL", "redis://localhost:6379")
