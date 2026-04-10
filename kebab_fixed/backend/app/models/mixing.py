from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class MixingLotDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    meat_lot_id: str = Field("", alias="meatLotId")
    kg_planned: float = Field(0, alias="kgPlanned")


class MixingOrderCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    recipe_id: str = Field("", alias="recipeId")
    product_type_id: Optional[str] = Field(None, alias="productTypeId")
    meat_kg: float = Field(0, alias="meatKg")
    notes: Optional[str] = None
    meat_lots: List[MixingLotDto] = Field(default_factory=list, alias="meatLots")
