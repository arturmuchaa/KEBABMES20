"""Modele palet mięsa przyprawionego (wywóz na halę, zwrot końcówki)."""
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class TakeDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    code: str = Field(..., min_length=1)
    worker_name: str = Field("", alias="workerName")
    plan_id: Optional[str] = Field(None, alias="planId")


class ReturnDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    code: str = Field(..., min_length=1)
    kg: float = Field(..., ge=0)


class LabelsPrintedDto(BaseModel):
    ids: List[str] = Field(default_factory=list)
