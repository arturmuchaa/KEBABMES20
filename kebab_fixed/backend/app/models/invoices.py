from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class InvoiceCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    invoice_no: str = Field("", alias="invoiceNo")
    supplier_id: str = Field("", alias="supplierId")
    category: str = ""
    invoice_date: str = Field("", alias="invoiceDate")
    due_date: str = Field("", alias="dueDate")
    qty: float = 0
    unit_price: float = Field(0, alias="unitPrice")
    vat_rate: float = Field(0.05, alias="vatRate")
    notes: str = ""
    raw_batch_id: str = Field("", alias="rawBatchId")
    ingredient_id: str = Field("", alias="ingredientId")
    packaging_id: str = Field("", alias="packagingId")
    create_wz: bool = Field(False, alias="createWZ")
    expiry_date: str = Field("", alias="expiryDate")
    batch_no: str = Field("", alias="batchNo")
    currency: str = "PLN"
    exchange_rate: Optional[float] = Field(None, alias="exchangeRate")
    amount_eur: Optional[float] = Field(None, alias="amountEur")
