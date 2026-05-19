from typing import Any, List

from pydantic import BaseModel, ConfigDict, Field


class RawBatchCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    internal_batch_no: str = Field("", alias="internalBatchNo")  # opcjonalny — user może wpisać np. "R308"
    supplier_id: str = Field("", alias="supplierId")
    supplier_batch_no: str = Field("", alias="supplierBatchNo")
    slaughter_date: str = Field("", alias="slaughterDate")
    received_date: str = Field("", alias="receivedDate")
    kg_received: float = Field(0, alias="kgReceived")
    price_per_kg: float = Field(0, alias="pricePerKg")
    expiry_date: str = Field("", alias="expiryDate")
    invoice_no: str = Field("", alias="invoiceNo")
    notes: str = ""
    supplier_batches: List[Any] = Field(default_factory=list, alias="supplierBatches")

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
            }
            normalized = {mapping.get(k, k): v for k, v in obj.items()}
            return super().model_validate(normalized, **kw)
        return super().model_validate(obj, **kw)
