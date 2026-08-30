from typing import List

from pydantic import BaseModel, ConfigDict, Field


class IngredientCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str = ""
    unit: str = "kg"
    is_unlimited: bool = Field(False, alias="isUnlimited")
    code: str = ""
    # Kategoria składnika: spice_mix | functional | other. Bez tego pola pydantic
    # gubił kategorię z formularza → wszystko lądowało jako „Inne".
    category: str = "other"


class IngredientReceptionLineIn(BaseModel):
    """Jedna pozycja dostawy DDFiP — jeden składnik z jednej partii dostawcy."""

    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    #: Czym jest ta pozycja: ``ingredient`` (przyprawa, dodatek) albo
    #: ``packaging`` (folia, tuleja, karton). Karta 1.3.1 nazywa się
    #: „Rejestr przyjęcia OPAKOWAŃ, przypraw i dodatków technologicznych" —
    #: jedno auto potrafi przywieźć i jedno, i drugie, a każde idzie na INNY
    #: magazyn: składnik do `ingredient_stock`, opakowanie do `packaging`.
    kind: str = "ingredient"
    ingredient_id: str = Field("", alias="ingredientId")
    #: Pozycja magazynu opakowań, gdy dokładamy do istniejącej.
    packaging_id: str = Field("", alias="packagingId")
    #: Nazwa NOWEJ pozycji opakowania (gdy nie ma jej jeszcze w magazynie).
    name: str = ""
    #: Rodzaj z magazynu opakowań: tuleja | opakowanie | inne.
    packaging_type: str = Field("opakowanie", alias="packagingType")
    unit: str = "szt"
    qty: float = Field(..., gt=0)
    #: Numer partii DOSTAWCY z opakowania — po nim idzie identyfikowalność
    #: (instrukcja 1.3 wymienia „brak identyfikowalności partii" jako zagrożenie).
    batch_no: str = Field("", alias="batchNo")
    expiry_date: str = Field("", alias="expiryDate")
    price_per_unit: float = Field(0, alias="pricePerUnit", ge=0)


class IngredientReceptionCreate(BaseModel):
    """POST /api/ingredient-receptions — karta 1.3.1, jeden wiersz = jedna dostawa.

    Oceny cząstkowe (`visual_check`, `compliance_check`) przyjmują wartości
    z instrukcji 1.3: ``bz`` (bez zastrzeżeń) albo ``N`` (niezgodne).
    Kwalifikacja całej dostawy (`decision`) to ``K`` albo ``N``.

    Dostawa z ``decision='N'`` NIE wchodzi na magazyn, ale MUSI dać się
    zapisać: „Pomimo braku fizycznego przyjęcia (…) należy takie zdarzenie
    zarejestrować w karcie przyjęcia, gdyż posłużyć ono może w przyszłości
    do oceny dostawców".
    """

    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    reception_no: str = Field("", alias="receptionNo")
    received_date: str = Field("", alias="receivedDate")
    supplier_id: str = Field(..., alias="supplierId", min_length=1)
    document_no: str = Field("", alias="documentNo")
    visual_check: str = Field("bz", alias="visualCheck")
    compliance_check: str = Field("bz", alias="complianceCheck")
    notes: str = ""
    decision: str = "K"
    done_by: str = Field("", alias="doneBy")
    checked_by: str = Field("", alias="checkedBy")
    lines: List[IngredientReceptionLineIn] = Field(default_factory=list)
