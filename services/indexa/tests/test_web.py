"""Recherche web (fournisseur et pages simulés) et moteur d'analyse."""

from pathlib import Path

import pytest

from indexa.contracts import PlagiarismInput, Scope
from indexa.engine import EngineDeps, EngineStats, analyze
from indexa.web.fetch import FixturePageFetcher, html_to_text, is_public_address, url_allowed
from indexa.web.queries import select_queries
from indexa.web.search import FixtureSearchProvider

FIXTURES = Path(__file__).parent / "fixtures" / "web-pages.json"

TEXT = (
    "Introduction de mon mémoire sur la pédagogie au collège et ses effets mesurables. "
    "Dans les classes observées, les enseignants donnent un retour régulier et précis, ce qui "
    "permet à chacun de corriger ses méthodes avant l'examen final. "
    "Ma propre conclusion porte sur la motivation des élèves de quatrième dans les zones rurales."
)


def deps() -> tuple[EngineDeps, FixtureSearchProvider]:
    provider = FixtureSearchProvider.from_file(FIXTURES)
    return EngineDeps(
        search=provider, fetcher=FixturePageFetcher(provider), max_queries=4
    ), provider


def test_extraction_du_texte_visible() -> None:
    text = html_to_text(
        "<nav>Menu</nav><script>x()</script><p>Premier&nbsp;paragraphe</p><p>Second</p>"
    )
    assert text == "Premier paragraphe\nSecond"


@pytest.mark.parametrize(
    ("address", "public"),
    [
        ("127.0.0.1", False),
        ("10.1.2.3", False),
        ("169.254.169.254", False),
        ("::1", False),
        ("93.184.216.34", True),
    ],
)
def test_adresses_publiques(address: str, public: bool) -> None:
    assert is_public_address(address) is public


def test_url_refusee_vers_le_reseau_interne() -> None:
    assert not url_allowed("http://127.0.0.1/admin")
    assert not url_allowed("http://localhost:8080/")
    assert not url_allowed("ftp://example.com/")
    assert not url_allowed("https://user:pass@example.com/")


def test_requetes_distinctives_entre_guillemets() -> None:
    queries = select_queries(TEXT, 2)
    assert len(queries) == 2
    assert all(q.startswith('"') and q.endswith('"') for q in queries)
    assert all(len(q.strip('"').split()) == 12 for q in queries)


def test_analyse_web_retrouve_la_source() -> None:
    engine_deps, provider = deps()
    stats = EngineStats()
    progress: list[float] = []
    result = analyze(
        PlagiarismInput(text=TEXT, scope=Scope.web), engine_deps, progress.append, stats
    )
    assert result.engine == "IDX-WEB-1.0"
    assert [m.source_url for m in result.matches] == ["https://revue.example/evaluation-formative"]
    match = result.matches[0]
    assert TEXT[match.start : match.end].startswith("Dans les classes observées")
    assert match.excerpt.startswith("Dans les classes observées")
    assert 0.3 < result.similarity < 0.7
    assert stats.queries == len(provider.queries) and stats.pages >= 1
    assert progress[-1] == 1.0 and progress == sorted(progress)


def test_analyse_sans_correspondance() -> None:
    engine_deps, _ = deps()
    other = (
        "Un texte entièrement original qui parle de navigation à voile en Bretagne, "
        "des marées et du vent."
    )
    result = analyze(PlagiarismInput(text=other, scope=Scope.web), engine_deps)
    assert result.similarity == 0 and result.matches == []


def test_base_privee_exige_un_espace() -> None:
    with pytest.raises(ValueError, match="Base privée"):
        analyze(PlagiarismInput(text=TEXT, scope=Scope.private), EngineDeps())
