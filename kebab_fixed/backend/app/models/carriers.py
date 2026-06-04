from pydantic import BaseModel


class CarrierCreate(BaseModel):
    name: str
    address: str = ""
    postal_code: str = ""
    city: str = ""
    country: str = ""
    nip: str = ""
    vat_eu: str = ""
    default_plate: str = ""
    phone: str = ""
    notes: str = ""
