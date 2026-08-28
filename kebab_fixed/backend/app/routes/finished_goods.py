"""Finished goods endpoints."""
from typing import List

from fastapi import APIRouter, Query

from app.models.production import FinishDayDto, FinishedGoodCreate
from app.services import finished_goods_service as svc

router = APIRouter(prefix="/api/finished-goods", tags=["finished-goods"])


@router.get("")
def list_finished():
    return svc.list_finished()


@router.post("")
def create_finished_good(dto: FinishedGoodCreate):
    return svc.create_finished_good(dto)


@router.post("/bulk")
def create_finished_goods_bulk(items: List[FinishedGoodCreate]):
    """Kilka wyrobów naraz, JEDNA transakcja.

    Biuro zaznacza kilka pozycji zamówienia i klika raz — błąd na trzeciej
    pozycji ma cofnąć całość, a nie zostawić połowę wpisu.
    """
    return svc.create_finished_goods_bulk(items)


@router.patch("/{goods_id}/rodzaj")
def zmien_rodzaj(goods_id: str, product_type_id: str = Query(...)):
    """Korekta rodzaju na wierszu magazynu — tylko dopóki nic nie wyjechało."""
    return svc.zmien_rodzaj(goods_id, product_type_id)


@router.post("/finish-day")
def finish_day(dto: FinishDayDto):
    return svc.finish_day(dto)
