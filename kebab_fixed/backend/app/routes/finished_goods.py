"""Finished goods endpoints."""
from fastapi import APIRouter

from app.models.production import FinishDayDto, FinishedGoodCreate, StockCartonCreate
from app.services import finished_goods_service as svc

router = APIRouter(prefix="/api/finished-goods", tags=["finished-goods"])


@router.get("")
def list_finished():
    return svc.list_finished()


@router.post("")
def create_finished_good(dto: FinishedGoodCreate):
    return svc.create_finished_good(dto)


@router.post("/stock-carton")
def create_stock_carton(dto: StockCartonCreate):
    """Karton magazynowy „z ręki" — wyrób na magazyn z przypisanym klientem."""
    return svc.create_stock_carton(dto)


@router.post("/finish-day")
def finish_day(dto: FinishDayDto):
    return svc.finish_day(dto)
