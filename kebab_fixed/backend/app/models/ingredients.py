from pydantic import BaseModel, ConfigDict, Field


class IngredientCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str = ""
    unit: str = "kg"
    is_unlimited: bool = Field(False, alias="isUnlimited")
    code: str = ""
