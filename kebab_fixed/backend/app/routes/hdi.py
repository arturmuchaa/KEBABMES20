"""Endpointy HDI."""
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.config import settings
from app.db import query_one
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
    # Nazwa pliku: hdi_<PEŁNA nazwa klienta>_<nr>.pdf. hdi_documents.client_name
    # bywa nazwą skróconą z zamówienia — dociągnij oficjalną z kartoteki.
    client_name = doc.get("client_name") or ""
    order = query_one("SELECT client_id, client_name FROM client_orders WHERE id=%s",
                      (doc.get("order_id"),)) if doc.get("order_id") else None
    if order:
        client = None
        if order.get("client_id"):
            client = query_one("SELECT name FROM clients WHERE id=%s", (order.get("client_id"),))
        if not client and order.get("client_name"):
            client = query_one("SELECT name FROM clients WHERE name=%s OR display_name=%s",
                               (order.get("client_name"), order.get("client_name")))
        if client and client.get("name"):
            client_name = client["name"]
    safe_client = "_".join((client_name or "klient").split()).replace("/", "-")
    filename = f"hdi_{safe_client}_{number}.pdf"
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
