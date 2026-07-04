"""Deboning entry DTOs."""
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class DeboningEntryCreate(BaseModel):
    """POST /api/deboning/entries — nowy wpis rozbioru.

    Frontend (`deboningApi.create`) wysyła zarówno snake jak i camel:
    `raw_batch_id` + `rawBatchId`, `session_id` + `sessionId`. Pydantic
    obsłuży obie wersje przez populate_by_name + aliasy.

    `kg_taken` LUB `kg_quarter` musi być > 0 (frontend wysyła jedno lub drugie).
    Walidacja podwójna w serwisie: jeśli oba puste → 400.
    """

    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    raw_batch_id: str = Field(..., alias="rawBatchId", min_length=1)
    session_id: Optional[str] = Field(None, alias="sessionId")
    worker_id: Optional[str] = Field(None, alias="workerId")
    worker_name: Optional[str] = Field(None, alias="workerName")
    # FE może wysłać tylko jedno z kg_taken/kg_quarter — oba opcjonalne tutaj,
    # service waliduje że suma > 0 i emituje 400 z czytelnym komunikatem.
    kg_taken: Optional[float] = Field(None, alias="kgTaken", ge=0)
    kg_quarter: Optional[float] = Field(None, alias="kgQuarter", ge=0)
    kg_meat: float = Field(..., alias="kgMeat", gt=0)
    kg_backs: float = Field(0, alias="kgBacks", ge=0)
    kg_bones: float = Field(0, alias="kgBones", ge=0)
    # Ważenie automatyczne RS232 (HMI v10) — audyt brutto/tara; wszystkie
    # opcjonalne, wpis ręczny wysyła tylko weigh_mode='manual' albo nic.
    kg_gross: Optional[float] = Field(None, alias="kgGross", ge=0)
    tare_cart_kg: Optional[float] = Field(None, alias="tareCartKg", ge=0)
    tare_e2_kg: Optional[float] = Field(None, alias="tareE2Kg", ge=0)
    e2_count: Optional[int] = Field(None, alias="e2Count", ge=0)
    weigh_mode: Optional[str] = Field(None, alias="weighMode", pattern="^(auto|manual)$")


class DeboningEntryUpdate(BaseModel):
    """PATCH /api/deboning/entries/{id} — korekta wpisu."""

    model_config = ConfigDict(populate_by_name=True)

    kg_taken: Optional[float] = Field(None, alias="kgTaken", ge=0)
    kg_quarter: Optional[float] = Field(None, alias="kgQuarter", ge=0)
    kg_meat: Optional[float] = Field(None, alias="kgMeat", ge=0)
    kg_backs: Optional[float] = Field(None, alias="kgBacks", ge=0)
    kg_bones: Optional[float] = Field(None, alias="kgBones", ge=0)
