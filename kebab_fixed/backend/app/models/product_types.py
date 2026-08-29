from typing import Any, List

from pydantic import BaseModel, ConfigDict, Field


class ProductTypeCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str = ""
    description: str = ""
    #: Nazwa na dokumentach dla klienta (HDI). Puste = nazwa rodzaju.
    document_name: str = Field("", alias="documentName")
    components: List[Any] = Field(default_factory=list)
