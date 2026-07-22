"""Worker and payroll endpoints."""
from fastapi import APIRouter, Query

from app.models.workers import (
    WorkerCreate,
    WorkerUpdate,
    CreateSettlementDto,
    KgAdjustmentDto,
)
from app.services import workers_service as svc

router = APIRouter(tags=["workers"])


# --- Workers ---

@router.get("/api/workers")
def list_workers():
    return svc.list_workers()


@router.post("/api/workers")
def create_worker(dto: WorkerCreate):
    return svc.create_worker(dto)


@router.put("/api/workers/{worker_id}")
def update_worker(worker_id: str, dto: WorkerUpdate):
    return svc.update_worker(worker_id, dto)


# --- Payroll ---

@router.get("/api/payroll/worker-days")
def get_worker_days(
    worker_id: str = Query(..., alias="workerId"),
    date_from: str = Query("", alias="dateFrom"),
    date_to: str = Query("", alias="dateTo"),
):
    return svc.get_worker_days(worker_id, date_from, date_to)


@router.get("/api/payroll/kg-adjustments")
def list_kg_adjustments(
    worker_id: str = Query(..., alias="workerId"),
    date_from: str = Query("", alias="dateFrom"),
    date_to: str = Query("", alias="dateTo"),
):
    return svc.list_kg_adjustments(worker_id, date_from, date_to)


@router.post("/api/payroll/kg-adjustments")
def create_kg_adjustment(dto: KgAdjustmentDto):
    return svc.create_kg_adjustment(dto)


@router.post("/api/payroll/settlements")
def create_settlement(dto: CreateSettlementDto):
    return svc.create_settlement(dto)


@router.get("/api/payroll/settlements")
def list_settlements(worker_id: str = Query("", alias="workerId")):
    return svc.list_settlements(worker_id or None)


@router.get("/api/payroll/settlements/{sid}")
def get_settlement(sid: str):
    return svc.get_settlement(sid)
