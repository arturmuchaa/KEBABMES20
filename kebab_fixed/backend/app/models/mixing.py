from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class MixingLotDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    meat_lot_id: str = Field("", alias="meatLotId")
    kg_planned: float = Field(0, alias="kgPlanned", ge=0)


class MixingOrderCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, validate_default=True)
    recipe_id: str = Field(..., alias="recipeId", min_length=1)
    product_type_id: Optional[str] = Field(None, alias="productTypeId")
    meat_kg: float = Field(..., alias="meatKg", gt=0)
    notes: Optional[str] = None
    meat_lots: List[MixingLotDto] = Field(default_factory=list, alias="meatLots")


class FinishMixingLotAlloc(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    meat_lot_id: str = Field("", alias="meatLotId")
    kg: float = Field(0, ge=0)


class FinishMixingSessionDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True, validate_default=True)
    kg_actual: float = Field(..., alias="kgActual", gt=0)
    batch_no: str = Field("", alias="batchNo")
    lot_allocations: List[FinishMixingLotAlloc] = Field(
        default_factory=list, alias="lotAllocations"
    )
