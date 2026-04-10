"""Finished goods endpoints."""
from fastapi import APIRouter

from app.models.production import FinishDayDto
from app.services import finished_goods_service as svc

router = APIRouter(prefix="/api/finished-goods", tags=["finished-goods"])


@router.get("")
def list_finished():
    return svc.list_finished()


@router.post("")
def create_finished_good(body: dict):
    return svc.create_finished_good(body)


@router.post("/finish-day")
def finish_day(dto: FinishDayDto):
    return svc.finish_day(dto)
