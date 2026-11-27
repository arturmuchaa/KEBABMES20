"""DTO szablonu etykiety z projektora PROTRIMA (camelCase z frontu)."""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class LabelDesignSave(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: Optional[str] = None
    name: str = ""
    client_id: str = Field("", alias="clientId")
    product_type_id: str = Field("", alias="productTypeId")
    recipe_id: str = Field("", alias="recipeId")
    print_mode: str = Field("a4", alias="printMode")
    background_pdf: str = Field("", alias="backgroundPdf")
    background_png: str = Field("", alias="backgroundPng")
    background_zpl: str = Field("", alias="backgroundZpl")
    width_mm: float = Field(0, alias="widthMm")
    height_mm: float = Field(0, alias="heightMm")
    dpi: int = 203
    source_name: str = Field("", alias="sourceName")
    labels_per_sheet: int = Field(1, alias="labelsPerSheet")
    slot_offset: Dict[str, Any] = Field(default_factory=dict, alias="slotOffset")
    calibration: Dict[str, Any] = Field(default_factory=dict)
    fields: List[Dict[str, Any]] = Field(default_factory=list)
    slot2_fields: Dict[str, Any] = Field(default_factory=dict, alias="slot2Fields")
