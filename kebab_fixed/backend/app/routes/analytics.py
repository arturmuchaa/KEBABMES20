"""Analityka KPI (trendy). Dostęp: biuro (default permission)."""
from datetime import date, timedelta

from fastapi import APIRouter, Query

from app.services import analytics_service as svc
from app.services import kpi_snapshot_service as kpi

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _default_range(date_from: str, date_to: str) -> tuple[str, str]:
    today = date.today()
    to = date_to or today.isoformat()
    frm = date_from or (today - timedelta(days=30)).isoformat()
    return frm, to


@router.get("/mixing-yield")
def mixing_yield(
    from_: str = Query("", alias="from"),
    to: str = Query(""),
    granularity: str = Query("day"),
):
    frm, t = _default_range(from_, to)
    return svc.mixing_yield(frm, t, granularity)


@router.get("/volume")
def volume(
    from_: str = Query("", alias="from"),
    to: str = Query(""),
    granularity: str = Query("day"),
):
    frm, t = _default_range(from_, to)
    return svc.volume(frm, t, granularity)


@router.get("/cost-trend")
def cost_trend(
    from_: str = Query("", alias="from"),
    to: str = Query(""),
    granularity: str = Query("day"),
):
    frm, t = _default_range(from_, to)
    return svc.cost_trend(frm, t, granularity)


@router.get("/kpi-months")
def kpi_months(limit: int = Query(12, ge=1, le=60)):
    """Trend miesięczny do raportu zarządczego: zamknięte miesiące z migawek
    + bieżący na żywo. Domyka po drodze zaległe miesiące (idempotentnie),
    więc nikt nie musi pamiętać o „zamknięciu miesiąca"."""
    return {"data": kpi.list_kpi_months(limit)}


@router.get("/kpi-months/{year_month}")
def kpi_month(year_month: str):
    return kpi.get_month_kpi(year_month)


@router.get("/eur-rate")
def eur_rate(on: str = Query("")):
    """Kurs średni EUR (NBP tab. A) obowiązujący w dniu `on` — do raportu
    zarządczego. Brak odpowiedzi NBP → `null`, raport drukuje same złotówki
    (zmyślony kurs cicho zafałszowałby dokument)."""
    from app.services.fx_service import nbp_eur_rate
    return nbp_eur_rate(on or None) or {}


@router.post("/kpi-months/{year_month}/close")
def kpi_month_close(year_month: str, force: bool = Query(False), by: str = Query("")):
    """Zamknięcie miesiąca. `force=1` przelicza już zamknięty — świadoma
    decyzja biura po korekcie wstecznej, ze śladem kto/kiedy."""
    return kpi.close_month(year_month, closed_by=by, force=force)
