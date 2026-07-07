from pydantic import BaseModel


class SupplierCreate(BaseModel):
    name: str
    code: str = ""
    nip: str = ""
    vet_number: str = ""
    contact_name: str = ""
    phone: str = ""
    email: str = ""
    # Adres (m.in. z GUS) — bez tych pól pydantic gubił dane i adres nie zapisywał się.
    address: str = ""
    city: str = ""
    postal_code: str = ""
