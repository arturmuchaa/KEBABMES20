"""Palety mięsa przyprawionego — skan wywozu na halę i zwrot końcówki."""
from typing import Optional

from fastapi import APIRouter

from app.db import query_all
from app.models.seasoned_pallets import ReturnDto, TakeDto
from app.services import seasoned_pallets_service as svc

router = APIRouter(prefix="/api/seasoned-pallets", tags=["seasoned-pallets"])


@router.get("")
def list_pallets(status: Optional[str] = None, plan_id: Optional[str] = None):
    """Palety (chłodnia / hala / zamknięte), najnowsze pierwsze."""
    warunki, args = [], []
    if status:
        warunki.append("status=%s"); args.append(status)
    if plan_id:
        warunki.append("taken_plan_id=%s"); args.append(plan_id)
    where = ("WHERE " + " AND ".join(warunki)) if warunki else ""
    rows = query_all(
        f"SELECT * FROM seasoned_pallets {where} ORDER BY created_at DESC LIMIT 500", tuple(args))
    return {"data": [svc.pallet_out(r) for r in rows]}


@router.post("/take")
def take(dto: TakeDto):
    """Skan kierownika przy wywozie palety z chłodni na halę (blokada spoza planu)."""
    return svc.take_pallet(dto.code, dto.worker_name, dto.plan_id)


@router.post("/return")
def return_remainder(dto: ReturnDto):
    """Zwrot końcówki: kg z wagi paletowej (0 = paleta zużyta do zera)."""
    return svc.return_pallet(dto.code, dto.kg)
