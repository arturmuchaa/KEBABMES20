"""DTO szablonów etykiet (per klient+receptura)."""
from typing import Any, Dict

from pydantic import BaseModel


class LabelTemplateUpsert(BaseModel):
    client_id: str = ""
    recipe_id: str = ""
    kind: str = "overlay"
    background_data: str = ""          # base64 data URL obrazu tła
    background_pdf: str = ""           # oryginalny PDF tła (base64) — pod druk wektorowy
    field_positions: Dict[str, Any] = {}
    page_size: str = "a4"
    labels_per_sheet: int = 2
    zpl: str = ""
    slot_offsets: list = []            # [{dx: float, dy: float}, ...] per slot; slot 0 = {0,0}
    print_calib: Dict[str, Any] = {}   # {dxMm, dyMm, scale} — kompensacja ucinanego paska przy druku
