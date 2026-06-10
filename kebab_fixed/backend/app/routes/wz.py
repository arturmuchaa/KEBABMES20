"""Endpointy WZ (Wydanie Zewnętrzne)."""
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.config import settings
from app.services import wz_service as svc
from app.services.pdf_render import render_url_to_pdf

router = APIRouter(prefix="/api/wz", tags=["wz"])


@router.post("")
def generate(body: dict):
    return svc.generate_wz(
        source_type=body.get("sourceType"),
        source_id=body.get("sourceId"),
        buyer=body.get("buyer") or {},
        items=body.get("items") or [],
        valued=bool(body.get("valued", True)),
        place=body.get("place"),
        issued_date=body.get("issuedDate"),
        release_date=body.get("releaseDate"),
        notes=body.get("notes", ""),
    )


@router.get("")
def list_docs():
    return svc.list_wz()


@router.get("/{wz_id}/pdf")
def pdf(wz_id: str):
    doc = svc.get_wz(wz_id)  # 404, gdy nie istnieje
    url = f"{settings.self_base_url}/office/wz/{wz_id}/druk?pdf=1"
    try:
        data = render_url_to_pdf(url)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))
    number = (doc.get("number") or wz_id).replace("/", "-")
    filename = f"WZ_{number}.pdf"
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/stock/finished-goods")
def stock_fg():
    return svc.stock_finished_goods()


@router.get("/stock/raw")
def stock_raw():
    return svc.stock_raw()


@router.post("/manual")
def manual(body: dict):
    items = [
        {"stock_type": it.get("stockType"), "stock_id": it.get("stockId"),
         "name": it.get("name"), "unit": it.get("unit"), "qty": it.get("qty"),
         "price": it.get("price"), "batch_no": it.get("batchNo"),
         "kg_per_unit": it.get("kgPerUnit")}
        for it in (body.get("items") or [])
    ]
    return svc.create_manual_wz(
        buyer=body.get("buyer") or {},
        selections=items,
        valued=bool(body.get("valued", True)),
        place=body.get("place"),
        issued_date=body.get("issuedDate"),
        release_date=body.get("releaseDate"),
        currency=(body.get("currency") or "PLN"),
        eur_rate=body.get("eurRate"),
        notes=body.get("notes", ""),
    )


@router.patch("/{wz_id}/prices")
def update_prices(wz_id: str, body: dict):
    return svc.update_wz_prices(wz_id, body.get("prices") or [])


@router.post("/from-order")
def from_order(body: dict):
    order_id = (body.get("orderId") or "").strip()
    if not order_id:
        raise HTTPException(400, "orderId wymagany")
    return svc.create_wz_from_order(order_id)


@router.get("/{wz_id}")
def get(wz_id: str):
    return svc.get_wz(wz_id)
