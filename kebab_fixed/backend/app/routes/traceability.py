"""Traceability, recall, and admin endpoints."""
from fastapi import APIRouter, Query

from app.services import traceability_service as svc

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


@router.post("/api/admin/repair-lineage")
def repair_lineage():
    return svc.repair_lineage()


@router.post("/api/admin/recalculate-recipe-yields")
def recalculate_recipe_yields():
    return svc.recalculate_recipe_yields()
