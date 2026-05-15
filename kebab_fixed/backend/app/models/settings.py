from pydantic import BaseModel


class CompanySettings(BaseModel):
    name: str = ""
    nip: str = ""
    regon: str = ""
    address: str = ""
    city: str = ""
    postal_code: str = ""
    phone: str = ""
    email: str = ""
