"""Comparaisons Veritas / fournisseur externe (ADR-0008).

Chaque fois que les deux avis existent, l'aiguillage enregistre une comparaison : segment,
langue, offre, nombre de mots, probabilités, bandes, accord. Jamais le texte (CLAUDE.md §4.5).
"""

from dataclasses import dataclass
from typing import Literal, Protocol

import psycopg

from veritas.contracts import AgreementReport, SegmentAgreement
from veritas.scoring import Scored, agreement, concordant
from veritas.settings import Routing

Source = Literal["sync", "shadow"]


@dataclass(frozen=True, slots=True)
class Comparison:
    source: Source
    segment: str
    language: str
    plan: str
    word_count: int
    external_engine: str
    external_probability: float
    external_band: str
    veritas_engine: str
    veritas_probability: float
    veritas_band: str
    agreement: float
    concordant: bool

    @classmethod
    def of(
        cls, source: Source, segment: str, plan: str, external: Scored, veritas: Scored
    ) -> "Comparison":
        return cls(
            source=source,
            segment=segment,
            language=external.output.language,
            plan=plan,
            word_count=external.output.word_count,
            external_engine=external.output.engine.primary,
            external_probability=round(external.probability, 4),
            external_band=external.output.verdict_band.value,
            veritas_engine=veritas.output.engine.primary,
            veritas_probability=round(veritas.probability, 4),
            veritas_band=veritas.output.verdict_band.value,
            agreement=agreement(external, veritas),
            concordant=concordant(external, veritas),
        )


@dataclass(frozen=True, slots=True)
class SegmentCount:
    segment: str
    veritas_engine: str
    comparisons: int
    concordant: int


class ComparisonStore(Protocol):
    def record(self, comparison: Comparison) -> None: ...

    def counts(self) -> list[SegmentCount]: ...


class MemoryComparisonStore:
    """Stockage en mémoire (tests)."""

    def __init__(self) -> None:
        self.items: list[Comparison] = []

    def record(self, comparison: Comparison) -> None:
        self.items.append(comparison)

    def counts(self) -> list[SegmentCount]:
        groups: dict[tuple[str, str], list[Comparison]] = {}
        for item in self.items:
            groups.setdefault((item.segment, item.veritas_engine), []).append(item)
        return [
            SegmentCount(segment, engine, len(items), sum(i.concordant for i in items))
            for (segment, engine), items in sorted(groups.items())
        ]


_COLUMNS = (
    "source, segment, language, plan, word_count, external_engine, external_probability, "
    "external_band, veritas_engine, veritas_probability, veritas_band, agreement, concordant"
)


class PostgresComparisonStore:
    """Table detection_comparisons (migration infra/migrations, modèle Prisma)."""

    def __init__(self, database_url: str) -> None:
        self._url = database_url

    def record(self, comparison: Comparison) -> None:
        c = comparison
        with psycopg.connect(self._url) as conn:
            conn.execute(
                f"INSERT INTO detection_comparisons ({_COLUMNS}) "  # noqa: S608 (colonnes fixes)
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    c.source,
                    c.segment,
                    c.language,
                    c.plan,
                    c.word_count,
                    c.external_engine,
                    c.external_probability,
                    c.external_band,
                    c.veritas_engine,
                    c.veritas_probability,
                    c.veritas_band,
                    c.agreement,
                    c.concordant,
                ),
            )

    def counts(self) -> list[SegmentCount]:
        with psycopg.connect(self._url) as conn:
            rows = conn.execute(
                "SELECT segment, veritas_engine, count(*), count(*) FILTER (WHERE concordant) "
                "FROM detection_comparisons GROUP BY segment, veritas_engine "
                "ORDER BY segment, veritas_engine"
            ).fetchall()
        return [SegmentCount(str(r[0]), str(r[1]), int(r[2]), int(r[3])) for r in rows]


def agreement_report(store: ComparisonStore, routing: Routing) -> AgreementReport:
    """Taux d'accord par segment et par modèle, et porte de sortie (seuil + échantillon)."""
    segments = []
    for count in store.counts():
        rate = count.concordant / count.comparisons if count.comparisons else 0.0
        segments.append(
            SegmentAgreement(
                segment=count.segment,
                veritas_engine=count.veritas_engine,
                comparisons=count.comparisons,
                concordant=count.concordant,
                rate=round(rate, 4),
                gate_passed=count.comparisons >= routing.min_comparisons
                and rate >= routing.agreement_threshold,
            )
        )
    return AgreementReport(
        threshold=routing.agreement_threshold,
        min_comparisons=routing.min_comparisons,
        segments=segments,
    )
