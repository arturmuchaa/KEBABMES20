"""Endpointy projektanta etykiet Zebra."""
from fastapi import APIRouter, Query

from app.models.zebra_designs import RenderSampleRequest, SaveDesignRequest
from app.services import zebra_designer_service as svc

router = APIRouter(prefix="/api/zebra-designs", tags=["zebra-designs"])


@router.get("")
def get(client_id: str = Query(""), recipe_id: str = Query("")):
    return svc.get_design(client_id, recipe_id)


@router.put("")
def save(dto: SaveDesignRequest):
    return svc.save_design(dto.model_dump())


@router.get("/render")
def render(client_id: str = Query(""), recipe_id: str = Query(""), plan_line_id: str = Query("")):
    return svc.render_units(client_id, recipe_id, plan_line_id)


@router.post("/render-sample")
def render_sample(dto: RenderSampleRequest):
    return svc.render_sample(dto.model_dump())
