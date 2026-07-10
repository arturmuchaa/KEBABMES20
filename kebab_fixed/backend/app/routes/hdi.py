"""Endpointy HDI."""
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.config import settings
from app.services import hdi_service as svc
from app.services.pdf_render import render_url_to_pdf

router = APIRouter(prefix="/api/hdi", tags=["hdi"])


@router.post("/generate")
def generate(order_id: str = Query(...)):
    return svc.generate_hdi(order_id)


@router.get("/{hdi_id}/pdf")
def pdf(hdi_id: str):
    doc = svc.get_hdi(hdi_id)  # 404, gdy nie istnieje
    url = f"{settings.self_base_url}/office/hdi/{hdi_id}/druk?pdf=1"
    try:
        data = render_url_to_pdf(url)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))
    number = (doc.get("number") or hdi_id).replace("/", "-")
    filename = f"HDI_{number}.pdf"
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/{hdi_id}")
def get(hdi_id: str):
    return svc.get_hdi(hdi_id)


@router.get("")
def list_all():
    return svc.list_hdi()
