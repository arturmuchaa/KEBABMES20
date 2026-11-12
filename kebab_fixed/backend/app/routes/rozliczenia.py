"""Panel rozliczeń z odbiorcami — API `/api/rozliczenia`.

Trasy są cienkie: parsują kwoty i daty z granicy HTTP i oddają sprawę
serwisom `rozliczenia_service` / `rozliczenia_wz`. Walidację merytoryczną
(księgi, powody, daty startu) robią serwisy.
"""
from datetime import date
import math
from typing import Any, Dict, Optional
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from app.config import settings
from app.services import rozliczenia_service as svc
from app.services import rozliczenia_wz as wz
from app.services.pdf_render import render_url_to_pdf
from app.utils.doc_pdf import doc_pdf_filename

router = APIRouter(prefix="/api/rozliczenia", tags=["rozliczenia"])


def _data(wartosc: Any) -> Optional[date]:
    """Data `RRRR-MM-DD` z ciała lub zapytania; puste → None.

    Wartość inna niż tekst (np. domyślny obiekt `Query` przy wywołaniu trasy
    wprost) traktujemy jak brak.
    """
    if isinstance(wartosc, date):
        return wartosc
    if not isinstance(wartosc, str) or not wartosc.strip():
        return None
    try:
        return date.fromisoformat(wartosc.strip())
    except ValueError:
        raise HTTPException(400, "Nieprawidłowa data")


def _kwota(wartosc: Any) -> Any:
    """Kwota jako liczba albo tekst z przecinkiem (`"15 000,50"`)."""
    if wartosc is None:
        return None
    if isinstance(wartosc, bool):
        raise HTTPException(400, "Nieprawidłowa kwota")
    if isinstance(wartosc, (int, float)):
        if not math.isfinite(wartosc):
            raise HTTPException(400, "Nieprawidłowa kwota")
        return wartosc
    if isinstance(wartosc, str):
        txt = wartosc.translate({ord(c): None for c in " \u00a0\u202f"}).replace(",", ".")
        if not txt:
            return None
        try:
            liczba = float(txt)
            if math.isfinite(liczba):
                return liczba
        except ValueError:
            pass
    raise HTTPException(400, "Nieprawidłowa kwota")


def _kg(wartosc: Any) -> Any:
    """Kilogramy jak kwota (liczba albo `"1 250,5"`), z własnym komunikatem."""
    try:
        return _kwota(wartosc)
    except HTTPException:
        raise HTTPException(400, "Nieprawidłowa liczba kg")


def _kto(request: Request) -> str:
    # Sesja biura (auth_service._office_public) niesie `name` (nazwa wyświetlana
    # albo login) — bez tego w księdze lądowało surowe id użytkownika.
    subject = getattr(request.state, "subject", None) or {}
    return str(subject.get("name") or subject.get("login") or subject.get("username")
               or subject.get("id") or "")


def _tekst(body: Dict[str, Any], pole: str) -> str:
    return str(body.get(pole) or "")


@router.get("")
def lista(od: str = Query(""), do: str = Query("")):
    """`od`/`do` — okres obrotu i kg (puste = od daty startu, bez końca)."""
    return svc.lista(od=_data(od), do=_data(do))


@router.get("/ustawienia")
def ustawienia():
    return {"start": wz.data_startu().isoformat()}


@router.put("/ustawienia")
def ustaw_ustawienia(body: Dict[str, Any], request: Request):
    # Data startu ustawiona na produkcji (12.11.2026) — przypadkowa zmiana
    # przesunęłaby saldo otwarcia wszystkich klientów. Zmienia ją tylko
    # administrator skryptem (`rozliczenia_wz.ustaw_date_startu`).
    raise HTTPException(403, "Data startu rozliczeń jest zablokowana")


@router.get("/klient/{client_id}")
def karta(client_id: str, od: str = Query(""), do: str = Query(""),
          okres_od: str = Query(""), okres_do: str = Query("")):
    """`od`/`do` — filtr listy dokumentów; `okres_od`/`okres_do` — okres
    obrotu i kg (puste = od daty startu, bez końca)."""
    return svc.karta(client_id, od=_data(od), do=_data(do),
                     okres_od=_data(okres_od), okres_do=_data(okres_do))


@router.get("/klient/{client_id}/historia-zmian")
def historia_zmian(client_id: str, limit: int = Query(200)):
    return svc.historia_zmian(client_id, limit=limit if isinstance(limit, int) else 200)


@router.put("/klient/{client_id}/ustawienia")
def ustaw_klienta(client_id: str, body: Dict[str, Any], request: Request):
    svc.ustaw_klienta(client_id, body, _kto(request))
    return {"ok": True}


@router.put("/klient/{client_id}/otwarcie/{ksiega}")
def ustaw_otwarcie(client_id: str, ksiega: str, body: Dict[str, Any], request: Request):
    svc.ustaw_otwarcie(
        client_id, ksiega, kwota=_kwota(body.get("kwota")),
        zalegle_od=_data(body.get("zalegle_od")),
        uwagi=_tekst(body, "uwagi"), kto=_kto(request))
    return {"ok": True}


@router.post("/klient/{client_id}/faktury")
def dodaj_fakture(client_id: str, body: Dict[str, Any], request: Request):
    return svc.dodaj_fakture(
        client_id, numer=_tekst(body, "numer"), data=_data(body.get("data")),
        kwota=_kwota(body.get("kwota")), termin=_data(body.get("termin")),
        forma=body.get("forma") or None, uwagi=_tekst(body, "uwagi"),
        kto=_kto(request), kg=_kg(body.get("kg")))


@router.post("/klient/{client_id}/wplaty/podglad")
def podglad_wplaty(client_id: str, body: Dict[str, Any]):
    return svc.podglad_wplaty(
        client_id, ksiega=_tekst(body, "ksiega"), kwota=_kwota(body.get("kwota")),
        dokument_id=body.get("dokument_id") or None)


@router.post("/klient/{client_id}/wplaty")
def dodaj_wplate(client_id: str, body: Dict[str, Any], request: Request):
    return svc.dodaj_wplate(
        client_id, ksiega=_tekst(body, "ksiega"), forma=_tekst(body, "forma"),
        kwota=_kwota(body.get("kwota")), data=_data(body.get("data")),
        dokument_id=body.get("dokument_id") or None, uwagi=_tekst(body, "uwagi"),
        kto=_kto(request))


@router.post("/wplaty/{wplata_id}/usun")
def usun_wplate(wplata_id: str, body: Dict[str, Any], request: Request):
    svc.usun_wplate(wplata_id, _tekst(body, "powod"), _kto(request))
    return {"ok": True}


@router.get("/dokumenty/{dokument_id}")
def dokument(dokument_id: str):
    return svc.dokument(dokument_id)


@router.patch("/dokumenty/{dokument_id}")
def edytuj_dokument(dokument_id: str, body: Dict[str, Any], request: Request):
    zmiany = {k: v for k, v in body.items() if k != "powod"}
    if "kwota" in zmiany:
        zmiany["kwota"] = _kwota(zmiany["kwota"])
    if "kg" in zmiany:
        zmiany["kg"] = _kg(zmiany["kg"])
    for pole in ("data", "termin"):
        if pole in zmiany:
            zmiany[pole] = _data(zmiany[pole])
    return svc.edytuj_dokument(dokument_id, zmiany, _kto(request), _tekst(body, "powod"))


@router.post("/dokumenty/{dokument_id}/usun")
def usun_dokument(dokument_id: str, body: Dict[str, Any], request: Request):
    svc.usun_dokument(dokument_id, _tekst(body, "powod"), _kto(request))
    return {"ok": True}


@router.post("/dokumenty/{dokument_id}/nie-licz")
def nie_licz(dokument_id: str, body: Dict[str, Any], request: Request):
    """WZ „nie licz do rozrachunków”: `{nie_licz: bool, powod: str}` → `Dok`."""
    return svc.ustaw_nie_licz(dokument_id, body.get("nie_licz"), _tekst(body, "powod"),
                              _kto(request))


@router.post("/dokumenty/{dokument_id}/przypisz")
def przypisz(dokument_id: str, body: Dict[str, Any], request: Request):
    wz.przypisz_wz(dokument_id, _tekst(body, "client_id"), _kto(request))
    return {"ok": True}


@router.post("/klient/{client_id}/dziennik")
def dodaj_wpis(client_id: str, body: Dict[str, Any], request: Request):
    return svc.dodaj_wpis_dziennika(
        client_id, _tekst(body, "tresc"), _data(body.get("przypomnij")), _kto(request))


@router.post("/dziennik/{wpis_id}/odhacz")
def odhacz(wpis_id: str, request: Request):
    svc.odhacz_wpis(wpis_id, _kto(request))
    return {"ok": True}


@router.post("/dziennik/{wpis_id}/usun")
def usun_wpis(wpis_id: str, body: Dict[str, Any], request: Request):
    """Miękkie usunięcie notatki; `powod` opcjonalny (trafia do historii)."""
    svc.usun_wpis_dziennika(wpis_id, _kto(request), powod=_tekst(body, "powod"))
    return {"ok": True}


@router.get("/klient/{client_id}/zestawienie")
def zestawienie(client_id: str, na_dzien: str = Query(""), wz_id: str = Query("")):
    return svc.zestawienie(
        client_id, na_dzien=_data(na_dzien),
        wz_id=wz_id if isinstance(wz_id, str) and wz_id else None)


@router.get("/na-wz/{wz_id}")
def na_wz(wz_id: str):
    wynik = svc.zestawienie_dla_wz(wz_id)
    if wynik is None:
        raise HTTPException(404, "Brak zestawienia dla tego dokumentu")
    return wynik


@router.get("/klient/{client_id}/historia")
def historia(client_id: str, od: str = Query(""), do: str = Query("")):
    d_od, d_do = _data(od), _data(do)
    if d_od is None or d_do is None:
        raise HTTPException(400, "Nieprawidłowa data")
    return svc.historia_okresu(client_id, d_od, d_do)


def _pdf(client_id: str, sciezka: str, parametry: str, prefiks: str, data_txt: str) -> Response:
    klient = svc._klient(client_id)
    url = f"{settings.self_base_url}/office/rozliczenia/{client_id}/{sciezka}/druk?pdf=1{parametry}"
    try:
        dane = render_url_to_pdf(url)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))
    nazwa = doc_pdf_filename(prefiks, svc._nazwa(klient), data_txt)
    return Response(content=dane, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(nazwa)}"})


@router.get("/klient/{client_id}/zestawienie/pdf")
def zestawienie_pdf(client_id: str, na_dzien: str = Query("")):
    d = _data(na_dzien)
    txt = d.isoformat() if d else date.today().isoformat()
    return _pdf(client_id, "zestawienie", f"&na_dzien={txt}", "SALDO", txt)


@router.get("/klient/{client_id}/historia/pdf")
def historia_pdf(client_id: str, od: str = Query(""), do: str = Query("")):
    d_od, d_do = _data(od), _data(do)
    if d_od is None or d_do is None:
        raise HTTPException(400, "Nieprawidłowa data")
    return _pdf(client_id, "historia", f"&od={d_od.isoformat()}&do={d_do.isoformat()}",
                "ROZLICZENIA", f"{d_od.isoformat()}_{d_do.isoformat()}")
