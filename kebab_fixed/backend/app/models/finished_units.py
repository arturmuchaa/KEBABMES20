"""DTO requestów dla finished_units (QR per sztuka)."""
from typing import Optional

from pydantic import BaseModel


class GenerateUnitsRequest(BaseModel):
    plan_line_id: str


class ScanProducedRequest(BaseModel):
    code: str
    trolley_id: Optional[str] = None
