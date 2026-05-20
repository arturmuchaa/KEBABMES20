"""Traceability, recall, and admin endpoints."""
from fastapi import APIRouter, Depends, Query

from app.services import traceability_service as svc
from app.utils.auth import require_admin

router = APIRouter(tags=["traceability"])


@router.get("/api/traceability")
def traceability(
    batch_id: str = Query("", alias="batchId"),
    direction: str = Query("backward"),
):
    return svc.traceability(batch_id, direction)


@router.get("/api/recall/{batch_id}")
def recall(batch_id: str):
    return svc.recall(batch_id)


@router.get("/api/debug/trace/{finished_good_id}")
def debug_trace(finished_good_id: str):
    return svc.debug_trace(finished_good_id)


@router.get("/api/admin/lineage-health", dependencies=[Depends(require_admin)])
def lineage_health(limit: int = Query(200)):
    return svc.lineage_health(limit)


@router.post("/api/admin/repair-lineage", dependencies=[Depends(require_admin)])
def repair_lineage():
    return svc.repair_lineage()


@router.post("/api/admin/recalculate-recipe-yields", dependencies=[Depends(require_admin)])
def recalculate_recipe_yields():
    return svc.recalculate_recipe_yields()
