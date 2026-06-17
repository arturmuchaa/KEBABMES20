"""Analityka KPI (trendy). Dostęp: biuro (default permission)."""
from datetime import date, timedelta

from fastapi import APIRouter, Query

from app.services import analytics_service as svc

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
