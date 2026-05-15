"""Day closure endpoints."""
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services import day_closures_service as svc

router = APIRouter(prefix="/api/day-closures", tags=["day-closures"])


class CloseBody(BaseModel):
    section: str
    notes: str = ""
    closed_by: str = ""
    date: str = ""


@router.get("")
def list_closures(date: Optional[str] = None):
    if date:
        return svc.list_for_date(date)
    return svc.list_today()


@router.post("")
def close_section(body: CloseBody):
    return svc.close_section(body.section, body.notes, body.closed_by, body.date)


@router.delete("/{section}")
def reopen_section(section: str, date: Optional[str] = None):
    return svc.reopen_section(section, date or "")
