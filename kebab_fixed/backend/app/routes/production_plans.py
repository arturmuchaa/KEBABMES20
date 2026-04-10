"""Production plans endpoints."""
from fastapi import APIRouter

from app.models.production import ProductionPlanCreate
from app.services import production_plans_service as svc

router = APIRouter(prefix="/api/production-plans", tags=["production-plans"])


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
