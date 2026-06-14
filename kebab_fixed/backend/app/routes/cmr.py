"""Endpointy CMR."""
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.config import settings
from app.models.cmr import CmrForm
from app.services import cmr_service as svc
from app.services.pdf_render import render_url_to_pdf

router = APIRouter(prefix="/api/cmr", tags=["cmr"])


@router.post("/generate")
def generate(order_id: str = Query(...), form: CmrForm = CmrForm()):
    return svc.generate_cmr(order_id, form.model_dump())


# /layout musi być PRZED /{cmr_id}, by nie złapała go trasa z parametrem.
@router.get("/layout")
def get_layout():
    return svc.get_cmr_layout()


@router.put("/layout")
def put_layout(positions: dict):
    return svc.save_cmr_layout(positions)


@router.get("/{cmr_id}/pdf")
def pdf(cmr_id: str):
    doc = svc.get_cmr(cmr_id)
    url = f"{settings.self_base_url}/office/cmr/{cmr_id}/druk?pdf=1"
    try:
        data = render_url_to_pdf(url)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))
    number = (doc.get("number") or cmr_id).replace("/", "-")
    filename = f"CMR_{number}.pdf"
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"})


@router.patch("/{cmr_id}")
def update(cmr_id: str, form: CmrForm = CmrForm()):
    return svc.update_cmr(cmr_id, form.model_dump())


@router.get("/{cmr_id}")
def get(cmr_id: str):
    return svc.get_cmr(cmr_id)


@router.get("")
def list_all():
    return svc.list_cmr()
