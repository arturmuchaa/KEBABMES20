"""Endpointy HDI."""
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.config import settings
from app.services import hdi_service as svc
from app.services.pdf_render import render_url_to_pdf
from app.utils.doc_pdf import doc_pdf_filename, full_client_name

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
    # HDI_<PEŁNA nazwa klienta>_<nr>.pdf (wielkimi — feedback 2026-07-17).
    filename = doc_pdf_filename(
        "HDI",
        full_client_name(doc.get("order_id"), doc.get("client_name") or ""),
        doc.get("number") or hdi_id)
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
