from pydantic import BaseModel


class SupplierCreate(BaseModel):
    name: str
    code: str = ""
    nip: str = ""
    vet_number: str = ""
    contact_name: str = ""
    phone: str = ""
    email: str = ""
