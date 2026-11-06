"""Base privée sur une vraie base PostgreSQL (migrée par Prisma), exécuté en CI."""

import os
import secrets
from collections.abc import Iterator

import psycopg
import pytest

from indexa.contracts import PrivateSourceInput
from indexa.private import delete_source, index_source, search_private
from indexa.text import tokenize

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL absente")

MEMOIRE = (
    "Dans les classes observées, les enseignants donnent un retour régulier et précis, ce qui "
    "permet à chacun de corriger ses méthodes avant l'examen final. Les résultats montrent un "
    "gain moyen de trente-deux pour cent sur l'année scolaire."
)


@pytest.fixture
def conn() -> Iterator[psycopg.Connection]:
    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        yield connection


@pytest.fixture
def workspace(conn: psycopg.Connection) -> Iterator[str]:
    workspace_id = f"test-{secrets.token_hex(6)}"
    yield workspace_id
    with conn.transaction():
        conn.execute("DELETE FROM private_sources WHERE workspace_id = %s", (workspace_id,))


def test_indexe_puis_retrouve_un_passage(conn: psycopg.Connection, workspace: str) -> None:
    source = index_source(
        conn, PrivateSourceInput(workspace_id=workspace, title="Mémoire 2025", text=MEMOIRE)
    )
    assert source.word_count == len(tokenize(MEMOIRE))
    count = conn.execute(
        "SELECT count(*) FROM source_fingerprints WHERE source_id = %s", (source.source_id,)
    ).fetchone()
    assert count is not None and count[0] > 0

    text = "Introduction. " + MEMOIRE[:150] + " Fin du texte sans rapport avec la source."
    matches = search_private(conn, workspace, tokenize(text))
    assert [m.source_id for m in matches] == [source.source_id]
    assert matches[0].title == "Mémoire 2025"


def test_isole_les_espaces(conn: psycopg.Connection, workspace: str) -> None:
    index_source(conn, PrivateSourceInput(workspace_id=workspace, title="A", text=MEMOIRE))
    assert search_private(conn, f"{workspace}-autre", tokenize(MEMOIRE)) == []


def test_supprime_seulement_dans_son_espace(conn: psycopg.Connection, workspace: str) -> None:
    source = index_source(conn, PrivateSourceInput(workspace_id=workspace, title="A", text=MEMOIRE))
    assert delete_source(conn, "autre-espace", source.source_id) is False
    assert delete_source(conn, workspace, source.source_id) is True
    remaining = conn.execute(
        "SELECT count(*) FROM source_fingerprints WHERE source_id = %s", (source.source_id,)
    ).fetchone()
    assert remaining == (0,)
