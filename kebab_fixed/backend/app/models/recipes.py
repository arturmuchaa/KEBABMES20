from typing import List

from pydantic import BaseModel, ConfigDict, Field


class RecipeIngredientDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    ingredient_id: str = Field("", alias="ingredientId")
    ingredient_name: str = Field("", alias="ingredientName")
    unit: str = "kg"
    qty_per_100kg: float = Field(0, alias="qtyPer100kg")


class RecipeCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str = ""
    product_type_id: str = Field("", alias="productTypeId")
    product_type_name: str = Field("", alias="productTypeName")
    total_output_per_100kg: float = Field(100, alias="totalOutputPer100kg")
    notes: str = ""
    ingredients: List[RecipeIngredientDto] = Field(default_factory=list)
