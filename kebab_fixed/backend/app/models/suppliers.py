from pydantic import BaseModel


class SupplierCreate(BaseModel):
    name: str
    # Krótka nazwa do list/dokumentów — bez pola w modelu pydantic zjadał
    # wartość i „nazwa wyświetlana" nie zapisywała się (kolumna w bazie była).
    display_name: str = ""
    code: str = ""
    nip: str = ""
    regon: str = ""
    vet_number: str = ""
    contact_name: str = ""
    phone: str = ""
    email: str = ""
    # Adres (m.in. z GUS) — bez tych pól pydantic gubił dane i adres nie zapisywał się.
    address: str = ""
    city: str = ""
    postal_code: str = ""
