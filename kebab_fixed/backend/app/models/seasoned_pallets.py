"""Modele palet mięsa przyprawionego (wywóz na halę, zwrot końcówki)."""
from pydantic import BaseModel, ConfigDict, Field


class TakeDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    code: str = Field(..., min_length=1)
    worker_name: str = Field("", alias="workerName")


class ReturnDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    code: str = Field(..., min_length=1)
    kg: float = Field(..., ge=0)
