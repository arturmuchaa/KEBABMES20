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
