"""Analyse de plagiat : web, base privée ou les deux (contrat PlagiarismOutput)."""

import os
from collections.abc import Callable
from dataclasses import dataclass

import psycopg

from indexa.align import Span, align, coverage
from indexa.config import ENGINE_PRIVATE, ENGINE_WEB, EXCERPT_CHARS
from indexa.contracts import PlagiarismInput, PlagiarismMatch, PlagiarismOutput, Scope
from indexa.private import search_private
from indexa.text import Token, tokenize
from indexa.web.fetch import PageFetcher
from indexa.web.queries import select_queries
from indexa.web.search import SearchProvider

Progress = Callable[[float], None]


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass
class EngineDeps:
    """Accès externes de l'analyse, fournis par le worker (réels) ou par les tests (simulés)."""

    connect: Callable[[], psycopg.Connection] | None = None
    search: SearchProvider | None = None
    fetcher: PageFetcher | None = None
    max_queries: int = _int_env("INDEXA_MAX_QUERIES", 8)
    max_pages: int = _int_env("INDEXA_MAX_PAGES", 10)


@dataclass
class EngineStats:
    """Coût d'une analyse, pour le benchmark (requêtes de recherche et pages lues)."""

    queries: int = 0
    pages: int = 0


def _excerpt(text: str, tokens: list[Token], span: Span) -> str:
    start, end = tokens[span.s_start].start, tokens[span.s_end - 1].end
    excerpt = text[start:end]
    return excerpt if len(excerpt) <= EXCERPT_CHARS else f"{excerpt[: EXCERPT_CHARS - 1].rstrip()}…"


def _match(
    query_tokens: list[Token],
    span: Span,
    excerpt: str,
    *,
    url: str | None = None,
    doc_id: str | None = None,
) -> PlagiarismMatch:
    return PlagiarismMatch(
        start=query_tokens[span.q_start].start,
        end=query_tokens[span.q_end - 1].end,
        source_url=url,
        source_doc_id=doc_id,
        excerpt=excerpt,
        score=span.score,
    )


def analyze(
    request: PlagiarismInput,
    deps: EngineDeps,
    progress: Progress | None = None,
    stats: EngineStats | None = None,
) -> PlagiarismOutput:
    report = progress or (lambda _: None)
    stats = stats or EngineStats()
    tokens = tokenize(request.text)
    matches: list[PlagiarismMatch] = []
    all_spans: list[Span] = []
    engines: list[str] = []

    if request.scope in (Scope.private, Scope.both):
        if deps.connect is None or not request.workspace_id:
            raise ValueError("Base privée demandée sans espace ni base de données.")
        engines.append(ENGINE_PRIVATE)
        with deps.connect() as conn:
            for source in search_private(conn, request.workspace_id, tokens):
                for span in source.spans:
                    all_spans.append(span)
                    matches.append(
                        _match(
                            tokens,
                            span,
                            _excerpt(source.text, source.tokens, span),
                            doc_id=source.source_id,
                        )
                    )
        report(0.2 if request.scope is Scope.both else 0.9)

    if request.scope in (Scope.web, Scope.both):
        if deps.search is None or deps.fetcher is None:
            raise ValueError("Recherche web demandée sans fournisseur.")
        engines.append(ENGINE_WEB)
        base = 0.2 if request.scope is Scope.both else 0.0
        queries = select_queries(request.text, deps.max_queries)
        urls: list[str] = []
        for i, query in enumerate(queries):
            stats.queries += 1
            for result in deps.search.search(query):
                if result.url not in urls:
                    urls.append(result.url)
            report(base + (0.4 - base / 2) * (i + 1) / max(1, len(queries)))
        for i, url in enumerate(urls[: deps.max_pages]):
            stats.pages += 1
            page = deps.fetcher.fetch_text(url)
            if page:
                page_tokens = tokenize(page)
                for span in align(tokens, page_tokens):
                    all_spans.append(span)
                    matches.append(_match(tokens, span, _excerpt(page, page_tokens, span), url=url))
            report(0.6 + 0.35 * (i + 1) / max(1, min(len(urls), deps.max_pages)))

    report(1.0)
    matches.sort(key=lambda m: (m.start, -m.score))
    return PlagiarismOutput(
        similarity=coverage(all_spans, len(tokens)),
        matches=matches[:200],
        engine=",".join(engines),
    )
