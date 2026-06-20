from pydantic import BaseModel


class ClientCreate(BaseModel):
    name: str
    display_name: str = ""
    nip: str = ""
    regon: str = ""
    address: str = ""
    city: str = ""
    contact_name: str = ""
    phone: str = ""
    email: str = ""
    language: str = ""
    dest_name: str = ""
    dest_address: str = ""
    dest_city: str = ""
    halal_supervision: bool = False
