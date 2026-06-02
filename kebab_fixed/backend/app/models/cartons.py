"""DTO kartonów (pakowanie QR per sztuka)."""
from typing import Optional

from pydantic import BaseModel


class CreateCartonRequest(BaseModel):
    order_id: Optional[str] = None
    client_name: str = ""
    product_type_id: str = ""
    recipe_id: str = ""
    tuleja: str = ""
    target_qty: int
    target_weight_kg: float


class CartonScanRequest(BaseModel):
    code: str
