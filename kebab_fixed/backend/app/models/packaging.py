from pydantic import BaseModel


class PackagingReceive(BaseModel):
    name: str
    #: Kod pozycji. Pusty = wyliczany z nazwy i rodzaju (`TUL-M65`, `OPA-001`).
    code: str = ""
    type: str = "tuleja"
    unit: str = "szt"
    qty: float = 0
    supplier_id: str = ""
    expiry_date: str = ""
    notes: str = ""
