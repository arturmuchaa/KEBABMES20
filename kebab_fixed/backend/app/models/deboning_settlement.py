"""Strict, finite measurements. Server owns tolerance and workflow order."""
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SettlementWeighing(BaseModel):
    model_config = ConfigDict(populate_by_name=True, allow_inf_nan=False)

    request_id: str = Field(alias="requestId", min_length=8, max_length=100)
    kind: Literal["meat", "backs", "bones"]
    kg_net: float = Field(alias="kgNet", gt=0, le=10000)
    kg_gross: Optional[float] = Field(None, alias="kgGross", ge=0, le=20000)
    tare_cart_kg: Optional[float] = Field(None, alias="tareCartKg", ge=0, le=10000)
    tare_e2_kg: Optional[float] = Field(None, alias="tareE2Kg", ge=0, le=2000)
    e2_count: Optional[int] = Field(None, alias="e2Count", ge=0, le=1000)
    weigh_mode: Literal["auto", "manual"] = Field(alias="weighMode")
    reason: str = Field("", max_length=500)

    @model_validator(mode="after")
    def validate_measurement(self):
        if self.weigh_mode == "auto":
            if any(v is None for v in (self.kg_gross, self.tare_cart_kg, self.tare_e2_kg, self.e2_count)):
                raise ValueError("Pomiar automatyczny wymaga brutto, tary i liczby pojemników")
            if abs(self.tare_e2_kg - self.e2_count * 2) > 0.001:
                raise ValueError("Tara E2 musi odpowiadać liczbie pojemników × 2 kg")
            if abs(self.kg_gross - self.tare_cart_kg - self.tare_e2_kg - self.kg_net) > 0.01:
                raise ValueError("Netto nie zgadza się z brutto minus tara")
        elif len(self.reason.strip()) < 3:
            raise ValueError("Podaj powód ręcznego pomiaru")
        return self


class SettlementAdvance(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    stage: Literal["meat", "backs", "bones"]
    override_yield: bool = Field(False, alias="overrideYield")


class SettlementFinish(BaseModel):
    """Optional: closing OUTSIDE the tolerance needs the manager's code and a reason."""
    model_config = ConfigDict(populate_by_name=True)
    exception_code: Optional[str] = Field(None, alias="exceptionCode", max_length=20)
    exception_reason: Optional[str] = Field(None, alias="exceptionReason", max_length=200)


class SettlementReopen(BaseModel):
    stage: Literal["meat", "backs", "bones"]
