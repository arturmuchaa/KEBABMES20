"""Przyjęcie surowca jako DOKUMENT całej dostawy.

Jedna dostawa → jeden numer przyjęcia („12/08/2026") → kilka numerów
porządkowych (grup). Partie dostawcy (jego numery, np. „112819") wiszą pod
grupą, do której fizycznie trafiły.
"""
from typing import List, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class ReceptionSupplierBatchIn(BaseModel):
    """Jedna pozycja z HDI dostawcy."""

    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    supplier_batch_no: str = Field("", alias="supplierBatchNo")
    # Formularz nazywa to pole `kgReceived` (tak samo jak wagę partii), kolumna
    # w bazie to `kg`. Przyjmujemy OBIE nazwy — inaczej kilogramy pozycji HDI
    # cicho wpadały jako 0 i kontrola „suma = waga numeru porządkowego" nigdy
    # nie miała czego sprawdzać.
    kg: float = Field(0, ge=0, validation_alias=AliasChoices("kg", "kgReceived"))
    slaughter_date: str = Field("", alias="slaughterDate")
    expiry_date: str = Field("", alias="expiryDate")


class ReceptionGroupIn(BaseModel):
    """Jeden numer porządkowy w obrębie dostawy.

    Nośniki zwrotne zostają PER GRUPA, bo tak są liczone na rampie i tak
    księgują się na saldzie dostawcy — przyjęcie ich nie sumuje.
    """

    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    internal_batch_no: str = Field("", alias="internalBatchNo")
    #: Partia, którą ta grupa JEST (tylko edycja dokumentu). Puste = pozycja
    #: nowa. Parujemy po id, nie po numerze porządkowym: numer bywa zmieniany,
    #: a przy dołożonym wierszu jeszcze nie istnieje.
    batch_id: Optional[str] = Field(None, alias="batchId")
    kg_received: float = Field(..., alias="kgReceived", gt=0)
    supplier_batches: List[ReceptionSupplierBatchIn] = Field(
        default_factory=list, alias="supplierBatches")
    slaughter_date: str = Field("", alias="slaughterDate")
    expiry_date: str = Field("", alias="expiryDate")
    container_kg: Optional[float] = Field(None, alias="containerKg", ge=0)
    containers_count: Optional[int] = Field(None, alias="containersCount", ge=0)
    pallets_h1: int = Field(0, alias="palletsH1", ge=0)
    pallets_other: int = Field(0, alias="palletsOther", ge=0)
    pallets_other_kind: Optional[str] = Field(None, alias="palletsOtherKind")


class ReceptionCreate(BaseModel):
    """POST /api/receptions — rejestracja całej dostawy naraz."""

    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    reception_no: str = Field("", alias="receptionNo")
    received_date: str = Field("", alias="receivedDate")
    supplier_id: str = Field(..., alias="supplierId", min_length=1)
    material_type_id: str = Field("", alias="materialTypeId")
    document_no: str = Field("", alias="documentNo")
    hdi_no: str = Field("", alias="hdiNo")
    #: Identyfikator wczytanego skanu — zapis przyjęcia czyni go załącznikiem.
    hdi_scan_id: str = Field("", alias="hdiScanId")
    # Sumy ze stopki HDI — kontrola przepisania dokumentu, nie źródło stanu.
    doc_kg: Optional[float] = Field(None, alias="docKg", ge=0)
    doc_containers: Optional[int] = Field(None, alias="docContainers", ge=0)
    price_per_kg: float = Field(0, alias="pricePerKg", ge=0)
    notes: str = ""
    is_service: bool = Field(False, alias="isService")
    #: Stan CAŁEJ dostawy — jedno auto wiezie albo chłodzone, albo bloki.
    storage_state: str = Field("chlodzony", alias="storageState")
    groups: List[ReceptionGroupIn] = Field(default_factory=list)


class ReceptionUpdate(BaseModel):
    """PUT /api/receptions/{id} — zapis CAŁEGO dokumentu po edycji.

    Kształt jak przy tworzeniu, bez pól, których edycja nie rusza: dostawcy
    (przesuwałby saldo pojemników i unieważniał opis wypalony na skanie HDI),
    numeru przyjęcia (klucz ludzki w rejestrze i na wydrukach), trybu
    usługowego (inna seria numerów) oraz skanu HDI (ma własny przycisk).
    """

    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    received_date: str = Field("", alias="receivedDate")
    material_type_id: str = Field("", alias="materialTypeId")
    document_no: str = Field("", alias="documentNo")
    hdi_no: str = Field("", alias="hdiNo")
    doc_kg: Optional[float] = Field(None, alias="docKg", ge=0)
    doc_containers: Optional[int] = Field(None, alias="docContainers", ge=0)
    price_per_kg: float = Field(0, alias="pricePerKg", ge=0)
    notes: str = ""
    storage_state: str = Field("chlodzony", alias="storageState")
    groups: List[ReceptionGroupIn] = Field(default_factory=list)
