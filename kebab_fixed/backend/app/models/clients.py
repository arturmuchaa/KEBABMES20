from pydantic import BaseModel


class ClientCreate(BaseModel):
    name: str
    nip: str = ""
    regon: str = ""
    address: str = ""
    city: str = ""
    contact_name: str = ""
    phone: str = ""
    email: str = ""
