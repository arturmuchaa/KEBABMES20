"""Production plans endpoints."""
from typing import List

from fastapi import APIRouter
from pydantic import BaseModel

from app.models.production import ProductionPlanCreate
from app.services import production_plans_service as svc

router = APIRouter(prefix="/api/production-plans", tags=["production-plans"])


class WorkerEntryDto(BaseModel):
    workerId:   str = ""
    workerName: str = ""
    pieces:     int = 0
    addedAt:    str = ""


class LineProgressDto(BaseModel):
    qty_done:       int = 0
    line_status:    str = "PLANNED"
    worker_entries: List[WorkerEntryDto] = []


@router.get("")
def list_plans():
    return svc.list_plans()


@router.post("")
def create_plan(dto: ProductionPlanCreate):
    return svc.create_plan(dto)


@router.put("/{plan_id}")
def update_plan(plan_id: str, dto: ProductionPlanCreate):
    return svc.update_plan(plan_id, dto)


@router.patch("/{plan_id}/status")
def update_plan_status(plan_id: str, body: dict):
    return svc.update_plan_status(plan_id, body.get("status", ""))


@router.patch("/{plan_id}/lines/{line_id}/progress")
def update_line_progress(plan_id: str, line_id: str, body: LineProgressDto):
    return svc.update_line_progress(
        plan_id,
        line_id,
        qty_done=body.qty_done,
        line_status=body.line_status,
        worker_entries=[e.model_dump() for e in body.worker_entries],
    )
