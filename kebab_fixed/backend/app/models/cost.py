"""Parametry kalkulacji kosztu (app_settings → klucz `cost_params`)."""
from pydantic import BaseModel, ConfigDict, Field


class CostParams(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    backs_price: float = Field(0.50, alias="backsPrice")   # cena sprzedaży grzbietów zł/kg
    bones_price: float = Field(0.02, alias="bonesPrice")   # cena sprzedaży kości zł/kg
    plant_per_kg: float = Field(2.00, alias="plantPerKg")  # koszt zakładu zł/kg wyrobu
