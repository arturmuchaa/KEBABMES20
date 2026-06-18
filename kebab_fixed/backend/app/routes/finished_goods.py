"""Finished goods endpoints."""
from fastapi import APIRouter

from app.models.production import FinishDayDto, FinishedGoodCreate
from app.services import finished_goods_service as svc

router = APIRouter(prefix="/api/finished-goods", tags=["finished-goods"])


@router.get("")
def list_finished():
    return svc.list_finished()


@router.post("")
def create_finished_good(dto: FinishedGoodCreate):
    return svc.create_finished_good(dto)


@router.post("/finish-day")
def finish_day(dto: FinishDayDto):
    return svc.finish_day(dto)
