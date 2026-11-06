"""Fournisseurs de recherche web, derrière une interface unique (ADR-0007)."""

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import httpx2


@dataclass(frozen=True, slots=True)
class SearchResult:
    url: str
    title: str


class SearchProvider(Protocol):
    def search(self, query: str) -> list[SearchResult]: ...


class SearchUnavailableError(RuntimeError):
    """Aucun fournisseur de recherche n'est configuré (clé absente)."""


class BraveSearchProvider:
    """Brave Search API, point d'accès Web Search."""

    ENDPOINT = "https://api.search.brave.com/res/v1/web/search"

    def __init__(self, api_key: str, client: httpx2.Client | None = None, count: int = 5) -> None:
        self._key = api_key
        self._client = client or httpx2.Client(timeout=8.0)
        self._count = count

    def search(self, query: str) -> list[SearchResult]:
        response = self._client.get(
            self.ENDPOINT,
            params={"q": query, "count": self._count, "safesearch": "off"},
            headers={"Accept": "application/json", "X-Subscription-Token": self._key},
        )
        response.raise_for_status()
        results = response.json().get("web", {}).get("results", [])
        return [
            SearchResult(url=str(r["url"]), title=str(r.get("title", "")))
            for r in results
            if isinstance(r, dict) and str(r.get("url", "")).startswith(("http://", "https://"))
        ]


class FixtureSearchProvider:
    """Recherche simulée (tests, benchmark) : renvoie les pages d'un corpus local qui contiennent
    la requête. Le corpus est un fichier JSON {url: {"title": …, "html": …}}."""

    def __init__(self, pages: dict[str, dict[str, str]]) -> None:
        self.pages = pages
        self.queries: list[str] = []

    @classmethod
    def from_file(cls, path: str | Path) -> "FixtureSearchProvider":
        return cls(json.loads(Path(path).read_text(encoding="utf-8")))

    def search(self, query: str) -> list[SearchResult]:
        from indexa.text import tokenize

        self.queries.append(query)
        needle = " ".join(t.norm for t in tokenize(query))
        return [
            SearchResult(url=url, title=page.get("title", ""))
            for url, page in self.pages.items()
            if needle and needle in " ".join(t.norm for t in tokenize(page.get("html", "")))
        ]


def provider_from_env() -> SearchProvider:
    """Fournisseur choisi par INDEXA_SEARCH_PROVIDER : brave (défaut) ou fixtures."""
    kind = os.environ.get("INDEXA_SEARCH_PROVIDER", "brave")
    if kind == "fixtures":
        return FixtureSearchProvider.from_file(os.environ["INDEXA_FIXTURES_PATH"])
    key = os.environ.get("BRAVE_SEARCH_API_KEY")
    if not key:
        raise SearchUnavailableError("BRAVE_SEARCH_API_KEY manquante : recherche web indisponible.")
    return BraveSearchProvider(key)
