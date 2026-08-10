"""Karty HACCP do pobrania — arkusz kontroli sanitarnej i kontrola temperatury.

Obie karty to PUSTE formularze papierowe: MES ich nie wypełnia, tylko numeruje
i renderuje do PDF, żeby biuro mogło pobrać kartę na dowolny dzień z archiwum.
Stąd brak tabel w bazie — PDF powstaje z tej samej strony SPA, którą widać na
ekranie (ten sam mechanizm co HDI/CMR).
"""
from datetime import date, timedelta
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.config import settings
from app.services.pdf_render import render_url_to_pdf

router = APIRouter(prefix="/api/karty-haccp", tags=["karty-haccp"])


def _parse_day(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, "Data karty musi być w formacie RRRR-MM-DD")


def _render(url: str, filename: str) -> Response:
    try:
        data = render_url_to_pdf(url)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/arkusz-kontroli/pdf")
def sanitary_check_pdf(data: str = Query(..., description="dzień karty, RRRR-MM-DD")):
    """Arkusz kontroli techniczno-sanitarnej — jedna karta na dzień roboczy."""
    day = _parse_day(data)
    url = f"{settings.self_base_url}/office/arkusz-kontroli/druk?pdf=1&data={day.isoformat()}"
    return _render(url, f"Arkusz-kontroli_{day.isoformat()}.pdf")


@router.get("/kontrola-temperatury/pdf")
def temperature_log_pdf(od: str = Query(..., description="dowolny dzień tygodnia karty, RRRR-MM-DD")):
    """Karta kontroli temperatury — jedna karta na tydzień (pon–ndz).

    Normalizujemy do poniedziałku, żeby środa i piątek z tego samego tygodnia
    dały ten sam plik. Samego NUMERU karty tu nie liczymy — jest wyprowadzany
    w SPA (lib/temperatureLogCard), więc nie ma dwóch źródeł prawdy. W nazwie
    pliku dajemy CAŁY zakres: karta bywa numerowana miesiącem swojej niedzieli
    (01/08/2026 zaczyna się 27.07), więc sam poniedziałek mylił.
    """
    day = _parse_day(od)
    monday = day - timedelta(days=day.weekday())
    sunday = monday + timedelta(days=6)
    url = f"{settings.self_base_url}/office/kontrola-temperatury/druk?pdf=1&od={monday.isoformat()}"
    return _render(url, f"Kontrola-temperatury_{monday.isoformat()}_{sunday.isoformat()}.pdf")


def _first_of_month(value: str) -> date:
    """Rejestr przyjęcia idzie miesiącami — normalizujemy do 1. dnia, żeby
    3.08 i 17.08 dały ten sam plik (jak poniedziałek w karcie temperatur)."""
    day = _parse_day(value)
    return day.replace(day=1)


@router.get("/rejestr-przyjecia/pdf")
def reception_register_pdf(od: str = Query(..., description="dowolny dzień miesiąca karty, RRRR-MM-DD")):
    """Karta 1.1.1 — rejestr przyjęcia artykułów pochodzenia zwierzęcego.

    PUSTY druk: przyjęcia biuro prowadzi ręcznie, poza MES. System nadaje tylko
    numer karty (MM/RRRR) i renderuje ją w stylu reszty księgi HACCP.
    """
    first = _first_of_month(od)
    url = f"{settings.self_base_url}/office/rejestr-przyjecia/druk?pdf=1&od={first.isoformat()}"
    return _render(url, f"Rejestr-przyjecia_{first.strftime('%Y-%m')}.pdf")


@router.get("/rejestr-przyjecia-szczegolowy/pdf")
def reception_register_detail_pdf(od: str = Query(..., description="dowolny dzień miesiąca karty, RRRR-MM-DD")):
    """Karta 1.1.1/2 — rozbicie dostawy na numery porządkowe. Też pusty druk."""
    first = _first_of_month(od)
    url = f"{settings.self_base_url}/office/rejestr-przyjecia-szczegolowy/druk?pdf=1&od={first.isoformat()}"
    return _render(url, f"Rejestr-przyjecia-szczegolowy_{first.strftime('%Y-%m')}.pdf")
