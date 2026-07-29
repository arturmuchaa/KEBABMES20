from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class RawBatchCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    internal_batch_no: str = Field("", alias="internalBatchNo")  # opcjonalny — user może wpisać np. "R308"
    material_type_id: str = Field("", alias="materialTypeId")    # rodzaj surowca (domyślnie ćwiartka)
    supplier_id: str = Field(..., alias="supplierId", min_length=1)
    supplier_batch_no: str = Field("", alias="supplierBatchNo")
    slaughter_date: str = Field("", alias="slaughterDate")
    received_date: str = Field("", alias="receivedDate")
    kg_received: float = Field(..., alias="kgReceived", gt=0)
    price_per_kg: float = Field(0, alias="pricePerKg", ge=0)
    expiry_date: str = Field("", alias="expiryDate")
    invoice_no: str = Field("", alias="invoiceNo")
    notes: str = ""
    supplier_batches: List[Any] = Field(default_factory=list, alias="supplierBatches")
    # Nośniki zwrotne — kaliber pojemnika (None = niekalibrowany, wtedy
    # containers_count wpisuje operator) i palety liczone ręcznie.
    container_kg: Optional[float] = Field(None, alias="containerKg", ge=0)
    containers_count: Optional[int] = Field(None, alias="containersCount", ge=0)
    pallets_h1: int = Field(0, alias="palletsH1", ge=0)
    pallets_other: int = Field(0, alias="palletsOther", ge=0)


class RawBatchUpdate(BaseModel):
    """PUT /api/raw-batches/{id} — edycja partii zanim trafi do rozbioru."""

    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    supplier_batch_no: Optional[str] = Field(None, alias="supplierBatchNo")
    slaughter_date: Optional[str] = Field(None, alias="slaughterDate")
    received_date: Optional[str] = Field(None, alias="receivedDate")
    kg_received: float = Field(..., alias="kgReceived", gt=0)
    price_per_kg: float = Field(0, alias="pricePerKg", ge=0)
    expiry_date: Optional[str] = Field(None, alias="expiryDate")
    notes: Optional[str] = None
    # Nośniki zwrotne. WSZYSTKIE opcjonalne z None: formularz edycji partii
    # nie wysyła tych pól, a gdyby brak pola znaczył „zero", każda edycja
    # ceny kasowałaby saldo pojemników dostawcy. None = „nie ruszaj".
    container_kg: Optional[float] = Field(None, alias="containerKg", ge=0)
    containers_count: Optional[int] = Field(None, alias="containersCount", ge=0)
    pallets_h1: Optional[int] = Field(None, alias="palletsH1", ge=0)
    pallets_other: Optional[int] = Field(None, alias="palletsOther", ge=0)

    @classmethod
    def model_validate(cls, obj, **kw):  # type: ignore[override]
        if isinstance(obj, dict):
            mapping = {
                "internalBatchNo": "internal_batch_no",
                "supplierId": "supplier_id",
                "supplierBatchNo": "supplier_batch_no",
                "slaughterDate": "slaughter_date",
                "receivedDate": "received_date",
                "kgReceived": "kg_received",
                "pricePerKg": "price_per_kg",
                "expiryDate": "expiry_date",
                "invoiceNo": "invoice_no",
                "supplierBatches": "supplier_batches",
                "containerKg": "container_kg",
                "containersCount": "containers_count",
                "palletsH1": "pallets_h1",
                "palletsOther": "pallets_other",
            }
            normalized = {mapping.get(k, k): v for k, v in obj.items()}
            return super().model_validate(normalized, **kw)
        return super().model_validate(obj, **kw)
