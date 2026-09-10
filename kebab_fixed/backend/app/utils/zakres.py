"""Warianty dokumentu przy podziale wysyłki — jeden słownik dla CMR i HDI.

Zakres mówi, JAKĄ CZĘŚĆ wysyłki obejmuje dokument: `calosc` — całą dostawę
(ten papier jedzie z kierowcą), `fv` — tylko część fakturowaną (faktura
powstaje w Subiekcie, poza tym systemem).

Walidacja siedzi w jednym miejscu, bo wartość przychodzi z parametru HTTP
i wpada do dwóch różnych serwisów. Dopóki każdy normalizował ją po swojemu
(HDI robiło `strip()` i `None` → `calosc`, CMR nie robiło ani jednego, ani
drugiego), to samo żądanie przechodziło dla jednego dokumentu i wywracało
się na 400 dla drugiego — a komplet dokumentów wystawia oba naraz.
"""
from typing import Optional

from fastapi import HTTPException

#: Dokument na CAŁĄ wysyłkę.
ZAKRES_CALOSC = "calosc"
#: Dokument na część fakturowaną.
ZAKRES_FV = "fv"
ZAKRESY = (ZAKRES_CALOSC, ZAKRES_FV)

#: Część niefakturowana. NIE jest wariantem dokumentu — żyje wyłącznie jako
#: `wz_documents.split_scope` WZ-tki dla klienta. Nazwana tu, żeby dokument,
#: który ma o niej własną regułę (HDI), mógł ją rozpoznać i odmówić po ludzku.
ZAKRES_WZ = "wz"


def sprawdz_zakres(scope: Optional[str], dokument: str,
                   komunikat_wz: str = "") -> str:
    """Znormalizowany wariant dokumentu albo 400.

    `komunikat_wz` podaje dokument, który ma WŁASNĄ regułę o części na WZ —
    wtedy odmowa tłumaczy tę regułę zamiast mówić „nieznany wariant".
    """
    zakres = (scope or ZAKRES_CALOSC).strip()
    if zakres == ZAKRES_WZ and komunikat_wz:
        raise HTTPException(400, komunikat_wz)
    if zakres not in ZAKRESY:
        raise HTTPException(400, f"Nieznany wariant {dokument}: {zakres}")
    return zakres
