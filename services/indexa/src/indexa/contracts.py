# Généré par scripts/export-contracts.ts à partir des schémas zod de @altydetect/core.
# Ne pas modifier à la main : pnpm contracts:generate.

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Any

from pydantic import BaseModel, Field, RootModel


class IndexaContracts(RootModel[Any]):
    root: Annotated[Any, Field(title="IndexaContracts")]


class Scope(StrEnum):
    web = "web"
    private = "private"
    both = "both"


class PlagiarismInput(BaseModel):
    text: Annotated[str, Field(max_length=60000, min_length=1)]
    scope: Scope
    workspace_id: Annotated[str | None, Field(max_length=64, min_length=1)] = None


class PlagiarismMatch(BaseModel):
    start: Annotated[int, Field(ge=0, le=9007199254740991)]
    end: Annotated[int, Field(ge=0, le=9007199254740991)]
    source_url: str | None = None
    source_doc_id: str | None = None
    excerpt: str
    score: Annotated[float, Field(ge=0.0, le=1.0)]


class PlagiarismOutput(BaseModel):
    similarity: Annotated[float, Field(ge=0.0, le=1.0)]
    matches: list[PlagiarismMatch]
    engine: str


class Status(StrEnum):
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"


class PlagiarismTask(BaseModel):
    task_id: str
    status: Status
    progress: Annotated[float | None, Field(ge=0.0, le=1.0)] = 0
    result: PlagiarismOutput | None = None
    error: str | None = None


class PrivateSourceInput(BaseModel):
    workspace_id: Annotated[str, Field(max_length=64, min_length=1)]
    title: Annotated[str, Field(max_length=200, min_length=1)]
    text: Annotated[str, Field(max_length=400000, min_length=1)]


class PrivateSource(BaseModel):
    source_id: str
    title: str
    word_count: Annotated[int, Field(ge=0, le=9007199254740991)]
