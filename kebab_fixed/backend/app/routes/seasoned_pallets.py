"""Palety mięsa przyprawionego — skan wywozu na halę i zwrot końcówki."""
from typing import Optional

from fastapi import APIRouter

from app.models.seasoned_pallets import LabelsPrintedDto, ReturnDto, TakeDto
from app.services import seasoned_pallets_service as svc

router = APIRouter(prefix="/api/seasoned-pallets", tags=["seasoned-pallets"])


@router.get("")
def list_pallets(status: Optional[str] = None, plan_id: Optional[str] = None):
    """Palety (chłodnia / hala / zamknięte), najnowsze pierwsze."""
    return {"data": svc.list_pallets(status, plan_id)}


@router.post("/label-printed")
def labels_printed(dto: LabelsPrintedDto):
    """Biuro wydrukowało etykiety palet/końcówek z QR."""
    return svc.mark_pallet_labels_printed(dto.ids)


@router.post("/take")
def take(dto: TakeDto):
    """Skan kierownika przy wywozie palety z chłodni na halę (blokada spoza planu)."""
    return svc.take_pallet(dto.code, dto.worker_name, dto.plan_id)


@router.post("/return")
def return_remainder(dto: ReturnDto):
    """Zwrot końcówki: kg z wagi paletowej (0 = paleta zużyta do zera)."""
    return svc.return_pallet(dto.code, dto.kg)
