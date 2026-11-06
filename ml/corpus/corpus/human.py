"""Collecte des textes humains depuis un fragment C4 (JSON lignes compressé en gzip)."""

import gzip
import json
from collections.abc import Iterable, Iterator
from typing import IO

from corpus.clean import clean_web_text, count_words, fingerprint
from corpus.sources import LICENCE, HumanSource


def iter_records(stream: IO[bytes]) -> Iterator[dict[str, str]]:
    with gzip.open(stream, "rt", encoding="utf-8") as lines:
        for line in lines:
            record = json.loads(line)
            if isinstance(record, dict) and isinstance(record.get("text"), str):
                yield record


def collect(
    records: Iterable[dict[str, str]], source: HumanSource, shard: str, limit: int
) -> list[dict[str, object]]:
    """Les `limit` premières pages qui passent le nettoyage, sans doublon, dans l'ordre du
    fragment (collecte déterministe)."""
    seen: set[str] = set()
    documents: list[dict[str, object]] = []
    for record in records:
        text = clean_web_text(record["text"])
        if text is None:
            continue
        digest = fingerprint(text)
        if digest in seen:
            continue
        seen.add(digest)
        documents.append(
            {
                "id": f"h-{source.language}-{digest[:16]}",
                "sha256": digest,
                "label": "human",
                "language": source.language,
                "text": text,
                "words": count_words(text),
                "source": f"{source.name}:{shard}",
                "url": record.get("url", ""),
                "licence": LICENCE,
            }
        )
        if len(documents) >= limit:
            break
    return documents
