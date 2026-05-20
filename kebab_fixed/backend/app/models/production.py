from typing import List

from pydantic import BaseModel, ConfigDict, Field


class PlanLineCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    qty: int = 0
    kg_per_unit: float = Field(0, alias="kgPerUnit")
    product_type_id: str = Field("", alias="productTypeId")
    product_type_name: str = Field("", alias="productTypeName")
    recipe_id: str = Field("", alias="recipeId")
    recipe_name: str = Field("", alias="recipeName")
    packaging_id: str = Field("", alias="packagingId")
    packaging_name: str = Field("", alias="packagingName")
    seasoned_batch_id: str = Field("", alias="seasonedBatchId")
    seasoned_batch_no: str = Field("", alias="seasonedBatchNo")
    seasoned_batch_ids: List[str] = Field(default_factory=list, alias="seasonedBatchIds")
    client_order_id: str = Field("", alias="clientOrderId")
    client_order_no: str = Field("", alias="clientOrderNo")
    client_order_line_id: str = Field("", alias="clientOrderLineId")
    client_name: str = Field("", alias="clientName")


class ProductionPlanCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    plan_date: str = Field("", alias="planDate")
    notes: str = ""
    lines: List[PlanLineCreate] = Field(default_factory=list)


class FinishDayEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    plan_line_id: str = Field("", alias="planLineId")
    qty: int = 0
    worker_names: List[str] = Field(default_factory=list, alias="workerNames")
    kg_per_unit: float = Field(0, alias="kgPerUnit")
    product_type_id: str = Field("", alias="productTypeId")
    product_type_name: str = Field("", alias="productTypeName")
    recipe_id: str = Field("", alias="recipeId")
    recipe_name: str = Field("", alias="recipeName")
    packaging_id: str = Field("", alias="packagingId")
    packaging_name: str = Field("", alias="packagingName")
    client_order_id: str = Field("", alias="clientOrderId")
    client_order_no: str = Field("", alias="clientOrderNo")
    client_name: str = Field("", alias="clientName")
    seasoned_batch_nos: List[str] = Field(default_factory=list, alias="seasonedBatchNos")


class FinishDayDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    plan_id: str = Field("", alias="planId", min_length=1)
    entries: List[FinishDayEntry] = Field(default_factory=list)


class FinishedGoodCreate(BaseModel):
    """POST /api/finished-goods — manualne dodanie wyrobu (np. korekta).

    Linia produkcyjna idzie przez /finish-day; ten endpoint jest dla
    biura, gdy trzeba wpisać wyrób ręcznie. Stąd `seasoned_batch_nos`
    jest opcjonalne, a kg/qty muszą być dodatnie.
    """

    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    batch_no: str = Field("", alias="batchNo")
    plan_no: str = Field("", alias="planNo")
    product_type_id: str = Field("", alias="productTypeId")
    product_type_name: str = Field("", alias="productTypeName")
    recipe_id: str = Field("", alias="recipeId")
    recipe_name: str = Field("", alias="recipeName")
    packaging_id: str = Field("", alias="packagingId")
    packaging_name: str = Field("", alias="packagingName")
    client_name: str = Field("", alias="clientName")
    client_order_no: str = Field("", alias="clientOrderNo")
    qty: int = Field(..., gt=0)
    kg_per_unit: float = Field(..., alias="kgPerUnit", gt=0)
    produced_date: str = Field("", alias="producedDate")
    produced_by: List[str] = Field(default_factory=list, alias="producedBy")
    seasoned_batch_nos: List[str] = Field(default_factory=list, alias="seasonedBatchNos")
