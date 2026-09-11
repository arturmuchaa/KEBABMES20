"""Trasy podziału wysyłki na fakturę i WZ.

Klient bierze część dostawy na fakturę (wystawianą w Subiekcie, POZA tym
systemem), resztę na WZ. Cały silnik siedzi w serwisach — tu jest wyłącznie
warstwa HTTP: podgląd i zapis podziału na pozycjach zamówienia oraz JEDEN
przycisk, którym biuro wystawia komplet papierów przed odjazdem auta.

Warstwa HTTP i tylko ona: kolejność wystawiania dokumentów, walidacja
wstępna i idempotencja mieszkają w `split_documents_service.wystaw_komplet`.
"""
from typing import Dict, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.models.cmr import CmrForm
from app.services import order_split_service as svc
from app.services import split_documents_service as dokumenty

router = APIRouter(prefix="/api/client-orders", tags=["client-orders"])


class CelPodzialu(BaseModel):
    """Ile kilogramów ma pójść na fakturę."""
    cel_kg: float = 0.0


class ZapisPodzialu(BaseModel):
    cel_kg: float = 0.0
    #: Ręczne poprawki biura per pozycja (`id pozycji` → sztuki na fakturę).
    #: Puste = zostaw wyliczenie. Bez tego pola trasa gubiłaby korektę, którą
    #: operator właśnie wpisał — klasa błędu z `test_wz_route_contract`.
    per_line: Optional[Dict[str, int]] = None


class KompletDokumentow(BaseModel):
    #: HDI do faktury jest OPCJONALNE — na całość powstaje zawsze, drugie
    #: tylko gdy biuro go zażąda (właściciel, 2026-09-09). Do części
    #: wydawanej na WZ HDI nie powstaje w ogóle.
    hdi_fv: bool = False
    #: Ten sam formularz, co `/api/cmr/generate`. Oba listy przewozowe idą
    #: z niego: ten sam kierowca i to samo auto, różni je WYŁĄCZNIE zakres.
    cmr: CmrForm = CmrForm()


@router.post("/{order_id}/split/preview")
def podglad_podzialu(order_id: str, body: CelPodzialu):
    """Jak rozłoży się podział — BEZ zapisu. Biuro ogląda tabelę, poprawia
    pojedynczą pozycję i dopiero wtedy zatwierdza."""
    return svc.podglad_podzialu(order_id, body.cel_kg)


@router.get("/{order_id}/split")
def zapisany_podzial(order_id: str):
    """Podział ZAPISANY na zamówieniu — nie propozycja algorytmu.

    Okno podziału czyta to przy otwarciu, żeby wiedzieć, co leży w bazie,
    zanim biuro cokolwiek wpisze: z bazy powstają dokumenty, więc bez tego
    jedyną drogą do odblokowania „Wystaw komplet" był ponowny zapis —
    kasujący ręczne korekty z poprzedniej sesji."""
    return svc.zapisany_podzial(order_id)


@router.put("/{order_id}/split")
def zapisz_podzial(order_id: str, body: ZapisPodzialu):
    return svc.zapisz_podzial(order_id, body.cel_kg, body.per_line)


@router.delete("/{order_id}/split")
def wyczysc_podzial(order_id: str):
    """Kasuje podział — zamówienie wraca do zachowania sprzed tej zmiany."""
    svc.wyczysc_podzial(order_id)
    return {"order_id": order_id, "podzial": None}


@router.post("/{order_id}/split/documents")
def wystaw_komplet(order_id: str, body: KompletDokumentow = KompletDokumentow()):
    """Komplet papierów przed odjazdem auta: WM, WZ dla klienta, HDI (na
    całość zawsze, do faktury na życzenie) i dwa CMR-y.

    Walidacja wstępna, kolejność i idempotencja siedzą w serwisie — ta
    kolejność jest nośna dla poprawności stanu magazynu i dla treści papierów,
    więc nie ma prawa mieszkać w warstwie HTTP."""
    return dokumenty.wystaw_komplet(order_id, body.cmr.model_dump(), body.hdi_fv)


@router.delete("/{order_id}/split/documents")
def anuluj_komplet(order_id: str):
    """Wycofanie kompletu — wyjście ze ślepego zaułka.

    Zwykły WZ jest po podziale zablokowany (`wz_service` odsyła do „anuluj
    dokumenty podziału"), a `cancel_wz` odrzuca dokumenty z `source_type`
    innym niż `manual`. Bez tej trasy jedno omyłkowe kliknięcie zostawiało
    zamówienie, którego biuro nie odblokuje bez ręcznej roboty w bazie.
    """
    return dokumenty.anuluj_dokumenty_podzialu(order_id)
