"""Worker and payroll endpoints."""
from fastapi import APIRouter, Query

from app.models.work_hours import StampDto, WorkHoursDto
from app.models.workers import (
    WorkerCreate,
    WorkerDeductionDto,
    WorkerUpdate,
    CreateSettlementDto,
    KgAdjustmentDto,
)
from app.services import work_hours_service as hours_svc
from app.services import workers_service as svc

router = APIRouter(tags=["workers"])


# --- Workers ---

@router.get("/api/workers")
def list_workers(include_inactive: int = Query(0, alias="includeInactive")):
    return svc.list_workers(include_inactive=bool(include_inactive))


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


# --- Potrącenia oczekujące ---

@router.get("/api/payroll/deductions")
def list_deductions(
    worker_id: str = Query(..., alias="workerId"),
    status: str = Query("pending"),
):
    return svc.list_worker_deductions(worker_id, status)


@router.post("/api/payroll/deductions")
def create_deduction(dto: WorkerDeductionDto):
    return svc.create_worker_deduction(dto)


@router.delete("/api/payroll/deductions/{deduction_id}")
def cancel_deduction(deduction_id: str):
    return svc.cancel_worker_deduction(deduction_id)


@router.get("/api/payroll/match-worker")
def match_worker(name: str = Query(""), nip: str = Query("")):
    return svc.match_worker_by_name(name, nip)


# --- Godziny pracowników ogólnych ---

@router.get("/api/payroll/hours")
def list_hours(
    date_from: str = Query("", alias="dateFrom"),
    date_to: str = Query("", alias="dateTo"),
):
    return hours_svc.list_hours(date_from, date_to)


@router.put("/api/payroll/hours")
def upsert_hours(dto: WorkHoursDto):
    return hours_svc.upsert_hours(dto)


@router.delete("/api/payroll/hours")
def delete_hours(
    worker_id: str = Query(..., alias="workerId"),
    work_date: str = Query(..., alias="workDate"),
):
    return hours_svc.delete_hours(worker_id, work_date)


@router.post("/api/payroll/hours/stamp")
def stamp_hours(dto: StampDto):
    return hours_svc.stamp_hours(dto)


@router.get("/api/payroll/pending-kg-days")
def pending_kg_days(
    worker_id: str = Query(..., alias="workerId"),
    date_from: str = Query("", alias="dateFrom"),
    date_to: str = Query("", alias="dateTo"),
):
    return svc.pending_kg_days(worker_id, date_from, date_to)
