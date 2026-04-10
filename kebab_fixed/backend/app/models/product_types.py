from typing import Any, List

from pydantic import BaseModel, ConfigDict, Field


class ProductTypeCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str = ""
    description: str = ""
    components: List[Any] = Field(default_factory=list)
