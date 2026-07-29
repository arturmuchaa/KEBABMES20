"""DTO salda pojemników. Front wysyła camelCase, backend trzyma snake_case."""
from typing import Dict, List

from pydantic import BaseModel, ConfigDict, Field


class ContainerDocLine(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    asset_type: str = Field(..., alias="assetType")
    in_qty: int = Field(0, alias="inQty", ge=0)
    out_qty: int = Field(0, alias="outQty", ge=0)


class ContainerDocCreate(BaseModel):
    """Wystawienie „WZ na POJEMNIKI". Partner wskazany wprost (partnerId)
    albo przez kartotekę (refType + refId)."""

    model_config = ConfigDict(populate_by_name=True)

    partner_id: str = Field("", alias="partnerId")
    ref_type: str = Field("", alias="refType")   # 'supplier' | 'client'
    ref_id: str = Field("", alias="refId")
    doc_date: str = Field("", alias="docDate")
    driver: str = ""
    vehicle: str = ""
    lines: List[ContainerDocLine] = Field(default_factory=list)
    notes: str = ""
    # Powiązanie z dostawą: kolumna „Dostawa/odbiór" staje się wtedy samą
    # REFERENCJĄ na druku — nośniki zaksięgowało już przyjęcie surowca.
    linked_source_type: str = Field("", alias="linkedSourceType")
    linked_source_id: str = Field("", alias="linkedSourceId")


class ContainerGroupCorrect(BaseModel):
    """Korekta i potwierdzenie grupy ruchów jednego źródła (biuro)."""

    model_config = ConfigDict(populate_by_name=True)

    partner_id: str = Field(..., alias="partnerId", min_length=1)
    source_type: str = Field(..., alias="sourceType", min_length=1)
    source_id: str = Field("", alias="sourceId")
    targets: Dict[str, int] = Field(default_factory=dict)
    confirm: bool = False


class ContainerMovementCreate(BaseModel):
    """Ruch ręczny. qty ZE ZNAKIEM: dodatnie = przyjechało do nas."""

    model_config = ConfigDict(populate_by_name=True)

    partner_id: str = Field(..., alias="partnerId", min_length=1)
    asset_type: str = Field(..., alias="assetType", min_length=1)
    qty: int
    movement_date: str = Field("", alias="movementDate")
    note: str = ""
