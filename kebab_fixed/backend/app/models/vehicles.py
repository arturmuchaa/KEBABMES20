from pydantic import BaseModel


class VehicleCreate(BaseModel):
    name: str
    plate: str = ""
    kind: str = "own"            # 'own' | 'external'
    vehicle_type: str = "dostawczy"  # 'dostawczy' | 'tir' | 'solo' | ...
    sort_order: int = 0
    notes: str = ""


class VehicleUpdate(BaseModel):
    name: str
    plate: str = ""
    kind: str = "own"
    vehicle_type: str = "dostawczy"
    sort_order: int = 0
    notes: str = ""
    active: bool = True
