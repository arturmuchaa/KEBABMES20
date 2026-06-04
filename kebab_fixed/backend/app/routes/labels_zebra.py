"""Endpoint renderu etykiet Zebra (ZPL)."""
from fastapi import APIRouter, Query

from app.services import zebra_labels_service as svc

router = APIRouter(prefix="/api/labels/zebra", tags=["labels-zebra"])


@router.get("/render")
def render(plan_line_id: str = Query(...), client_id: str = Query(""), recipe_id: str = Query("")):
    return svc.render_zebra_labels(plan_line_id, client_id, recipe_id)
