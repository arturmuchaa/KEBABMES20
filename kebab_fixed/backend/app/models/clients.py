from pydantic import BaseModel


class ClientCreate(BaseModel):
    name: str
    display_name: str = ""
    nip: str = ""
    regon: str = ""
    address: str = ""
    # Kod pocztowy OSOBNO od adresu — dokumenty (CMR pole 2) drukują
    # "kod, miasto, kraj" w linii pod adresem; bez tego pola operatorzy
    # doklejali kod do adresu i wychodził w złej linii.
    postal_code: str = ""
    city: str = ""
    contact_name: str = ""
    phone: str = ""
    email: str = ""
    language: str = ""
    dest_name: str = ""
    dest_address: str = ""
    dest_city: str = ""
    # Na których dokumentach stosować miejsce przeznaczenia (ptaszki w kartotece).
    dest_for_hdi: bool = True
    dest_for_cmr: bool = True
    halal_supervision: bool = False
