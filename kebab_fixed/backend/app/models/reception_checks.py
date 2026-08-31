"""Wpis kontroli HACCP dostawy — kolumny f-k karty 1.1.1.

Wszystkie pola są opcjonalne, bo przyjęcie zapisuje się jak dawniej,
a kontrolę biuro uzupełnia później (czasem po pół godziny).
"""
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class ReceptionCheckIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    #: kol. f — ocena wizualna dostawy i książka mycia pojazdu: 'bz' | 'N'
    visual: Optional[str] = None
    #: kol. g/h — NAJWYŻSZY zmierzony odczyt, zgodnie z instrukcją 1.1
    temp_chamber: Optional[float] = Field(None, alias="tempChamber")
    temp_meat: Optional[float] = Field(None, alias="tempMeat")
    #: kol. i — zgodność kg z zamówieniem i dokumentami: 'bz' | 'N'
    kg_match: Optional[str] = Field(None, alias="kgMatch")
    notes: str = ""                                   # kol. j
    #: kol. k — kwalifikacja: 'K' przyjęta | 'N' odmowa przyjęcia
    verdict: Optional[str] = None
    nc_description: str = Field("", alias="ncDescription")
    nc_action: str = Field("", alias="ncAction")
    nc_at: Optional[str] = Field(None, alias="ncAt")
