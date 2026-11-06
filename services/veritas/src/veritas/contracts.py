# Généré par scripts/export-contracts.ts à partir des schémas zod de @altydetect/core.
# Ne pas modifier à la main : pnpm contracts:generate.

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Any

from pydantic import BaseModel, Field, RootModel


class VeritasContracts(RootModel[Any]):
    root: Annotated[Any, Field(title="VeritasContracts")]


class VerdictBand(StrEnum):
    likely_ai = "likely_ai"
    undetermined = "undetermined"
    likely_human = "likely_human"


class Confidence(StrEnum):
    high = "high"
    medium = "medium"
    low = "low"


class Language(StrEnum):
    auto = "auto"
    fr = "fr"
    en = "en"


class Mode(StrEnum):
    standard = "standard"
    deep = "deep"


class DetectInput(BaseModel):
    text: Annotated[str, Field(max_length=60000, min_length=1)]
    language: Language | None = Language.auto
    mode: Mode | None = Mode.standard
    keep_text: bool | None = False


class Plan(StrEnum):
    free = "free"
    pro = "pro"


class VeritasDetectRequest(BaseModel):
    text: Annotated[str, Field(max_length=60000, min_length=1)]
    language: Language | None = Language.auto
    mode: Mode | None = Mode.standard
    plan: Plan | None = Plan.free


class Overall(BaseModel):
    ai: Annotated[float, Field(ge=0.0, le=1.0)]
    undetermined: Annotated[float, Field(ge=0.0, le=1.0)]
    human: Annotated[float, Field(ge=0.0, le=1.0)]


class SentenceScore(BaseModel):
    start: Annotated[int, Field(ge=0, le=9007199254740991)]
    end: Annotated[int, Field(ge=0, le=9007199254740991)]
    score: Annotated[float, Field(ge=0.0, le=1.0)]
    band: VerdictBand


class Humanization(StrEnum):
    none = "none"
    weak = "weak"
    strong = "strong"


class DetectSignals(BaseModel):
    probable_model: str | None = None
    humanization: Humanization | None = Humanization.none


class DetectEngine(BaseModel):
    primary: str
    secondary: str | None = None
    agreement: Annotated[float | None, Field(ge=0.0, le=1.0)] = None


class DetectOutput(BaseModel):
    overall: Overall
    confidence: Confidence
    verdict_band: VerdictBand
    language: str
    sentences: list[SentenceScore]
    signals: DetectSignals
    engine: DetectEngine
    word_count: Annotated[int, Field(ge=0, le=9007199254740991)]


class Error(StrEnum):
    TEXT_TOO_SHORT = "TEXT_TOO_SHORT"
    UNSUPPORTED_LANGUAGE = "UNSUPPORTED_LANGUAGE"
    DETECTION_UNAVAILABLE = "DETECTION_UNAVAILABLE"


class DetectError(BaseModel):
    error: Error
    min_words: Annotated[int | None, Field(ge=-9007199254740991, le=9007199254740991)] = None


class SegmentAgreement(BaseModel):
    segment: str
    comparisons: Annotated[int, Field(ge=0, le=9007199254740991)]
    concordant: Annotated[int, Field(ge=0, le=9007199254740991)]
    rate: Annotated[float, Field(ge=0.0, le=1.0)]
    gate_passed: bool


class AgreementReport(BaseModel):
    threshold: Annotated[float, Field(ge=0.0, le=1.0)]
    min_comparisons: Annotated[int, Field(ge=1, le=9007199254740991)]
    segments: list[SegmentAgreement]
