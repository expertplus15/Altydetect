"""Téléchargement des pages trouvées et extraction de leur texte.

Les adresses viennent d'un moteur de recherche : seules les adresses publiques sont
autorisées (pas de réseau interne), avec un délai et une taille bornés. Rien n'est conservé.
"""

import ipaddress
import socket
from html.parser import HTMLParser
from typing import Protocol
from urllib.parse import urljoin, urlsplit

import httpx2

from indexa.web.search import FixtureSearchProvider

MAX_BYTES = 1024 * 1024
TIMEOUT_SECONDS = 6.0
MAX_REDIRECTS = 3


def is_public_address(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def resolves_to_public(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    addresses = {str(info[4][0]) for info in infos}
    return bool(addresses) and all(is_public_address(a) for a in addresses)


def url_allowed(url: str) -> bool:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return False
    if parts.username or parts.password or parts.port not in (None, 80, 443):
        return False
    return resolves_to_public(parts.hostname)


class _TextExtractor(HTMLParser):
    """Texte visible d'une page : ignore scripts, styles, navigation et pieds de page."""

    SKIP = frozenset({"script", "style", "noscript", "nav", "footer", "header", "svg", "form"})
    BLOCK = frozenset(
        {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section", "article"}
    )

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.SKIP:
            self._skip_depth += 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP and self._skip_depth:
            self._skip_depth -= 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip_depth:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    parser.close()
    lines = (" ".join(line.split()) for line in "".join(parser.parts).splitlines())
    return "\n".join(line for line in lines if line)


class PageFetcher(Protocol):
    def fetch_text(self, url: str) -> str | None: ...


class HttpPageFetcher:
    """Téléchargement réel, avec revérification de chaque redirection."""

    def __init__(self, client: httpx2.Client | None = None) -> None:
        self._client = client or httpx2.Client(
            timeout=TIMEOUT_SECONDS,
            follow_redirects=False,
            headers={"User-Agent": "AltyDetect-Indexa/1.0", "Accept": "text/html"},
        )

    def fetch_text(self, url: str) -> str | None:
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            if not url_allowed(current):
                return None
            try:
                with self._client.stream("GET", current) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            return None
                        current = urljoin(current, location)
                        continue
                    if response.status_code != 200 or "html" not in response.headers.get(
                        "content-type", ""
                    ):
                        return None
                    body = bytearray()
                    for chunk in response.iter_bytes():
                        body.extend(chunk)
                        if len(body) >= MAX_BYTES:
                            break
                    return html_to_text(
                        bytes(body[:MAX_BYTES]).decode(response.encoding or "utf-8", "replace")
                    )
            except httpx2.HTTPError:
                return None
        return None


class FixturePageFetcher:
    """Pages du corpus local (tests, benchmark)."""

    def __init__(self, provider: FixtureSearchProvider) -> None:
        self._pages = provider.pages

    def fetch_text(self, url: str) -> str | None:
        page = self._pages.get(url)
        return html_to_text(page["html"]) if page else None
