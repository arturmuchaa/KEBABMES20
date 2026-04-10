from pydantic import BaseModel


class PackagingReceive(BaseModel):
    name: str
    type: str = "tuleja"
    unit: str = "szt"
    qty: float = 0
    supplier_id: str = ""
    expiry_date: str = ""
    notes: str = ""
