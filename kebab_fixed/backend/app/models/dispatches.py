"""DTO wydań (dispatches)."""
from typing import Optional

from pydantic import BaseModel


class CreateDispatchRequest(BaseModel):
    client_id: Optional[str] = None
    client_name: str = ""
    vehicle_id: Optional[str] = None
    cmr_requested: bool = False
    operator: str = ""


class DispatchScanRequest(BaseModel):
    code: str
