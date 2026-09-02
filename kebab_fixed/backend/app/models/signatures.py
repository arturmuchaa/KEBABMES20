"""Podpisy elektroniczne — DTO wzoru i aktu podpisania."""
from pydantic import BaseModel, ConfigDict, Field


class SignatureSampleIn(BaseModel):
    """Wzór rysowany na HMI rozbioru.

    PIN, nie sam kod serwisowy: 0099 otwiera menu, ale nie upoważnia
    kierownika do narysowania cudzego podpisu.
    """

    model_config = ConfigDict(populate_by_name=True)

    png: str = Field(..., min_length=32)
    pin: str = Field(..., min_length=1)


class SignIn(BaseModel):
    """Złożenie podpisu pod dokumentem.

    PIN podpisującego, nie sesja biura: zalogowana przeglądarka znaczy
    tylko tyle, że ktoś ją zostawił otwartą.
    """

    model_config = ConfigDict(populate_by_name=True)

    doc_type: str = Field(..., alias="docType", min_length=1)
    doc_id: str = Field(..., alias="docId", min_length=1)
    #: 'wykonal' (kol. l) albo 'sprawdzil' (kol. m) karty 1.1.1.
    role: str = Field(..., min_length=1)
    worker_id: str = Field(..., alias="workerId", min_length=1)
    pin: str = Field(..., min_length=1)
