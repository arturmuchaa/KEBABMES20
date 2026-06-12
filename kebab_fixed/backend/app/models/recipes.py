from typing import List

from pydantic import BaseModel, ConfigDict, Field


class RecipeIngredientDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    ingredient_id: str = Field("", alias="ingredientId")
    ingredient_name: str = Field("", alias="ingredientName")
    unit: str = "kg"
    qty_per_100kg: float = Field(0, alias="qtyPer100kg")


class RecipeComponentDto(BaseModel):
    """Komponent składu produkcyjnego (kebab komponentowy, np. 70/30):
    rodzaj mięsa przyprawionego + udział %. Pusta lista komponentów =
    produkt jednoskładnikowy (dotychczasowe zachowanie)."""
    model_config = ConfigDict(populate_by_name=True)
    material_type_id: str = Field("", alias="materialTypeId")
    material_name: str = Field("", alias="materialName")
    pct: float = 0


class RecipeCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str = ""
    product_type_id: str = Field("", alias="productTypeId")
    product_type_name: str = Field("", alias="productTypeName")
    total_output_per_100kg: float = Field(100, alias="totalOutputPer100kg")
    shelf_life_days: int = Field(5, alias="shelfLifeDays")
    notes: str = ""
    ingredients: List[RecipeIngredientDto] = Field(default_factory=list)
    components: List[RecipeComponentDto] = Field(default_factory=list)
