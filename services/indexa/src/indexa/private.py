"""Base privée : indexation des documents de référence et recherche des passages communs."""

import secrets
from dataclasses import dataclass

import psycopg

from indexa.align import Span, align
from indexa.config import PRIVATE_CANDIDATES
from indexa.contracts import PrivateSource, PrivateSourceInput
from indexa.fingerprint import shingles, winnow
from indexa.text import Token, tokenize


@dataclass(frozen=True, slots=True)
class SourceMatch:
    """Passages communs avec une source privée."""

    source_id: str
    title: str
    text: str
    tokens: list[Token]
    spans: list[Span]


def new_source_id() -> str:
    return f"src_{secrets.token_urlsafe(16)}"


def index_source(conn: psycopg.Connection, source: PrivateSourceInput) -> PrivateSource:
    """Enregistre un document de la base privée et ses empreintes (winnowing)."""
    tokens = tokenize(source.text)
    fingerprints = winnow(shingles(tokens))
    source_id = new_source_id()
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            "INSERT INTO private_sources (id, workspace_id, title, text, word_count) "
            "VALUES (%s, %s, %s, %s, %s)",
            (source_id, source.workspace_id, source.title, source.text, len(tokens)),
        )
        cur.executemany(
            "INSERT INTO source_fingerprints (source_id, hash, position) VALUES (%s, %s, %s)",
            [(source_id, h, position) for h, position in fingerprints],
        )
    return PrivateSource(source_id=source_id, title=source.title, word_count=len(tokens))


def delete_source(conn: psycopg.Connection, workspace_id: str, source_id: str) -> bool:
    """Supprime un document (et ses empreintes, en cascade) s'il appartient à l'espace."""
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            "DELETE FROM private_sources WHERE id = %s AND workspace_id = %s",
            (source_id, workspace_id),
        )
        return cur.rowcount > 0


def search_private(
    conn: psycopg.Connection, workspace_id: str, query_tokens: list[Token]
) -> list[SourceMatch]:
    """Sources de l'espace qui partagent des empreintes avec le texte, puis alignement fin."""
    hashes = list({h for h, _ in winnow(shingles(query_tokens))})
    if not hashes:
        return []
    with conn.cursor() as cur:
        cur.execute(
            "SELECT s.id, s.title, s.text FROM private_sources s "
            "JOIN source_fingerprints f ON f.source_id = s.id "
            "WHERE s.workspace_id = %s AND f.hash = ANY(%s) "
            "GROUP BY s.id ORDER BY count(*) DESC LIMIT %s",
            (workspace_id, hashes, PRIVATE_CANDIDATES),
        )
        candidates = cur.fetchall()
    matches: list[SourceMatch] = []
    for source_id, title, text in candidates:
        tokens = tokenize(text)
        spans = align(query_tokens, tokens)
        if spans:
            matches.append(SourceMatch(source_id, title, text, tokens, spans))
    return matches
