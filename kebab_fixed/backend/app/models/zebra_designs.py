"""DTO projektanta etykiet Zebra."""
from typing import Any, List

from pydantic import BaseModel


class SaveDesignRequest(BaseModel):
    recipe_id: str = ""
    size_key: str = ""
    width_mm: float = 100
    height_mm: float = 150
    dpi: int = 203
    elements: List[Any] = []


class RenderSampleRequest(BaseModel):
    width_mm: float = 100
    height_mm: float = 150
    dpi: int = 203
    elements: List[Any] = []
