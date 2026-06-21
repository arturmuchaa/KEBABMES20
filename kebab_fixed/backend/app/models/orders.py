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


class RequirementsPreviewItem(BaseModel):
    qty: float = 0
    kg_per_unit: float = 0
    recipe_id: str = ""
    product_type_id: str = ""


class RequirementsPreviewRequest(BaseModel):
    items: List[RequirementsPreviewItem]


# ── Palety wydania ────────────────────────────────────────────────
class PalletItemDto(BaseModel):
    order_line_id: str
    qty: int


class PalletDto(BaseModel):
    pallet_no: int | None = None  # ignorowane przy zapisie — numerujemy 1..N
    notes: str = ""
    items: List[PalletItemDto]


class PalletsRequest(BaseModel):
    pallets: List[PalletDto]


# ── Skanowanie palet (QR) ────────────────────────────────────────
class PalletScanRequest(BaseModel):
    code: str
    action: str
    operator: str = ""
    vehicle_id: str = ""


class PackUnitRequest(BaseModel):
    code: str
