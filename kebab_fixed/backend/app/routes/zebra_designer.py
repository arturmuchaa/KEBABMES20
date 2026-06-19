"""Endpointy projektanta etykiet Zebra."""
from fastapi import APIRouter, Query

from app.models.zebra_designs import RenderSampleRequest, SaveDesignRequest
from app.services import zebra_designer_service as svc

router = APIRouter(prefix="/api/zebra-designs", tags=["zebra-designs"])


@router.get("")
def get(recipe_id: str = Query(""), size_key: str = Query("")):
    return svc.get_design(recipe_id, size_key)


@router.put("")
def save(dto: SaveDesignRequest):
    return svc.save_design(dto.model_dump())


@router.get("/render")
def render(recipe_id: str = Query(""), size_key: str = Query(""), plan_line_id: str = Query("")):
    return svc.render_units(recipe_id, size_key, plan_line_id)


@router.post("/render-sample")
def render_sample(dto: RenderSampleRequest):
    return svc.render_sample(dto.model_dump())
