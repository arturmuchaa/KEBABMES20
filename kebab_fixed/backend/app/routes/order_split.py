"""Trasy podziału wysyłki na fakturę i WZ.

Klient bierze część dostawy na fakturę (wystawianą w Subiekcie, POZA tym
systemem), resztę na WZ. Cały silnik siedzi w serwisach — tu jest wyłącznie
warstwa HTTP: podgląd i zapis podziału na pozycjach zamówienia oraz JEDEN
przycisk, którym biuro wystawia komplet papierów przed odjazdem auta.

KOLEJNOŚĆ W `wystaw_komplet` NIE JEST KOSMETYCZNA: wynika z dwóch realnych
zależności — WM przed WZ dla klienta i HDI przed CMR — opisanych przy tej
funkcji.
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.models.cmr import CmrForm
from app.services import cmr_service, hdi_service
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

    Każdy krok jest osobno idempotentny, więc powtórne kliknięcie oddaje TE
    SAME dokumenty zamiast wystawiać drugi komplet.

    KOLEJNOŚĆ WYNIKA Z DWÓCH ZALEŻNOŚCI, nie z upodobania:

    * WM przed WZ dla klienta — WM jako jedyny zdejmuje stan magazynu, a
      `wystaw_wz_klienta` tego pilnuje i bez niego odmawia. Zamówienie z samym
      WZ klienta przeszłoby obie bramki załadunku i stan zszedłby drugi raz.
    * HDI przed CMR — `build_cmr` wpisuje w pole „załączniki" numer HDI
      SWOJEGO wariantu. Odwrotna kolejność dawała listy przewozowe z PUSTYM
      załącznikiem, a gdy `generate_hdi(scope='fv')` odmawiał (np. „podział
      nie przewiduje ani jednej sztuki na fakturę"), zostawały nadane numery
      CMR na dokumentach, które nigdy nie były prawdziwe. Tak ustawione:
      ta sama awaria nie zdąży spalić numeru CMR — biuro poprawia podział
      i klika ponownie, dostając komplet poprawny za pierwszym razem.
      `build_hdi` nie czyta `cmr_documents` w żadnym miejscu, więc odwrotnej
      zależności nie ma.
    """
    forma_cmr = body.cmr.model_dump()
    wm = dokumenty.wystaw_wz_wewnetrzny(order_id)
    wz = dokumenty.wystaw_wz_klienta(order_id)
    hdi_calosc = hdi_service.generate_hdi(order_id)
    hdi_fv = hdi_service.generate_hdi(
        order_id, scope=hdi_service.ZAKRES_FV) if body.hdi_fv else None
    # Oba listy z JEDNEGO formularza: ten sam kierowca i to samo auto,
    # różni je wyłącznie zakres.
    cmr: List[Dict[str, Any]] = [
        cmr_service.generate_cmr(order_id, forma_cmr, scope=cmr_service.ZAKRES_CALOSC),
        cmr_service.generate_cmr(order_id, forma_cmr, scope=cmr_service.ZAKRES_FV),
    ]
    return {"order_id": order_id, "wm": wm, "wz": wz, "cmr": cmr,
            "hdi_calosc": hdi_calosc, "hdi_fv": hdi_fv}


@router.delete("/{order_id}/split/documents")
def anuluj_komplet(order_id: str):
    """Wycofanie kompletu — wyjście ze ślepego zaułka.

    Zwykły WZ jest po podziale zablokowany (`wz_service` odsyła do „anuluj
    dokumenty podziału"), a `cancel_wz` odrzuca dokumenty z `source_type`
    innym niż `manual`. Bez tej trasy jedno omyłkowe kliknięcie zostawiało
    zamówienie, którego biuro nie odblokuje bez ręcznej roboty w bazie.
    """
    return dokumenty.anuluj_dokumenty_podzialu(order_id)
