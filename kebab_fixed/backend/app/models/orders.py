from typing import List

from pydantic import BaseModel


class OrderLineCreate(BaseModel):
    qty: int
    kg_per_unit: float
    product_type_id: str = ""
    product_type_name: str = ""
    recipe_id: str
    recipe_name: str = ""
    packaging_id: str = ""
    packaging_name: str = ""


class ClientOrderCreate(BaseModel):
    client_id: str
    order_date: str
    delivery_date: str = ""
    notes: str = ""
    lines: List[OrderLineCreate]
