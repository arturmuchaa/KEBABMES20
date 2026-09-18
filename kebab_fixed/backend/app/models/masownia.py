"""Modele panelu masowania."""
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class SpiceCartCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    order_id: str = Field(..., alias="orderId", min_length=1)
    #: Numer paczki nadaje BACKEND (licznik ciągły od 1) — panel go nie wybiera.
    #: Pole zostaje tylko dla zgodności ze starą ścieżką i jest ignorowane.
    cart_no: int = Field(0, alias="cartNo", ge=0)
    kg_target: float = Field(..., alias="kgTarget", gt=0)
    #: W ilu workach są te przyprawy (200 kg → 1, 600 kg → 3). Operator wpisuje
    #: to na koniec ważenia; z tej liczby wie, ile sztuk zabrać do maszyny.
    bags: int = Field(1, ge=1, le=20)
    #: Komplet odważonych składników. Panel zakłada pojemnik DOPIERO po
    #: zatwierdzeniu całego ważenia, więc przysyła je naraz; pusta lista to
    #: stara ścieżka (załóż, potem ważenie po jednym).
    ingredients: List["SpiceWeighDto"] = Field(default_factory=list)


class SpiceWeighDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    seq: int = Field(..., ge=0)
    name: str = ""
    unit: str = "kg"
    qty: float = 0
    weighed: float = 0
    #: Ślad „ręcznie" — waga była odłączona, operator ważył gdzie indziej.
    manual: bool = False


class ChargeMeatDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    pallet_id: Optional[str] = Field(None, alias="palletId")
    lot_no: str = Field("", alias="lotNo")
    meat_stock_id: str = Field("", alias="meatStockId")
    kg: float = Field(0, ge=0)


class ChargeCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    order_id: str = Field(..., alias="orderId", min_length=1)
    machine_id: int = Field(..., alias="machineId", ge=1, le=3)
    cart_id: Optional[str] = Field(None, alias="cartId")
    water_l: float = Field(0, alias="waterL", ge=0)
    meat: List[ChargeMeatDto] = Field(default_factory=list)
    #: Przyprawy odważone PRZY MASZYNIE, gdy nie było gotowego pojemnika.
    #: Należą do wsadu, nie do pojemnika — nikt ich nigdzie nie odstawiał.
    spices: List[SpiceWeighDto] = Field(default_factory=list)


class ChargeFinish(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kg_output: float = Field(..., alias="kgOutput", gt=0)


SpiceCartCreate.model_rebuild()
