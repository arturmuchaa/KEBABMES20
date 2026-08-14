"""Paleta / wózek mięsa z ważenia zbiorczego.

To OPIS ułożenia, nie ruch magazynowy: mięso jest na stanie od chwili
rozbioru, a ten zapis mówi tylko, ile go leży na danej palecie i z jakich
partii — żeby operator masowania nie musiał ważyć po raz drugi u siebie.
"""
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class MeatPalletLotIn(BaseModel):
    """Jedna partia w składzie palety."""

    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    lot_no: str = Field(..., alias="lotNo", min_length=1)
    kg: float = Field(..., gt=0)


class MeatPalletCreate(BaseModel):
    """POST /api/meat-pallets — zapis skompletowanej palety."""

    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    #: Cel z kafelka (100/200/400/600/800) — zostaje dla raportu odchyleń.
    target_kg: float = Field(..., alias="targetKg", gt=0)
    #: Cel pojedynczego słupka albo None (kafelek bez podziału).
    stack_kg: Optional[float] = Field(None, alias="stackKg", ge=0)
    kg_net: float = Field(..., alias="kgNet", gt=0)
    containers: int = Field(0, ge=0)
    carrier_label: str = Field("", alias="carrierLabel")
    carrier_kg: float = Field(0, alias="carrierKg", ge=0)
    operator: str = ""
    #: Dzień PRODUKCYJNY rozbioru (zmiana przed 04:00 to poprzedni dzień).
    production_date: str = Field(..., alias="productionDate", min_length=10)
    #: Najkrótszy termin ze składu palety.
    expiry_date: str = Field("", alias="expiryDate")
    lots: List[MeatPalletLotIn] = Field(default_factory=list)
