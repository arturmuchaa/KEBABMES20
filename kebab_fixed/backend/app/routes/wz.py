"""Endpointy WZ (Wydanie Zewnętrzne)."""
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.config import settings
from app.db import query_one
from app.services import wz_service as svc
from app.services.pdf_render import render_url_to_pdf
from app.utils.doc_pdf import doc_pdf_filename, full_client_name

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
    # WZ_<PEŁNA nazwa klienta>_<nr>.pdf — jak HDI/CMR. WZ ręczny nie ma
    # zamówienia → nazwa nabywcy z dokumentu (dociągnięta z kartoteki po nazwie).
    order_id = doc.get("source_id") if (doc.get("source_type") or "") == "order" else None
    buyer = doc.get("buyer_name") or ""
    client_name = full_client_name(order_id, buyer)
    if client_name == buyer and buyer:
        row = query_one("SELECT name FROM clients WHERE name=%s OR display_name=%s", (buyer, buyer))
        if row and row.get("name"):
            client_name = row["name"]
    filename = doc_pdf_filename("WZ", client_name, doc.get("number") or wz_id)
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


@router.get("/stock/raw/card")
def stock_raw_card(stock_type: str, stock_id: str):
    """Kartoteka partii dla wiersza Magazynu surowca (klik wiersza)."""
    from app.services import stock_card_service
    return stock_card_service.stock_card(stock_type, stock_id)


@router.post("/manual")
def manual(body: dict):
    items = [
        {"stock_type": it.get("stockType"), "stock_id": it.get("stockId"),
         "name": it.get("name"), "unit": it.get("unit"), "qty": it.get("qty"),
         "price": it.get("price"), "batch_no": it.get("batchNo"),
         "kg_per_unit": it.get("kgPerUnit"), "containers": it.get("containers"),
         "production_date": it.get("productionDate")}
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


@router.patch("/{wz_id}/lines")
def update_lines(wz_id: str, body: dict):
    return svc.update_wz_lines(wz_id, body.get("edits") or [])


@router.patch("/{wz_id}/cancel")
def cancel(wz_id: str):
    """Anuluj WZ: pełny zwrot wszystkich pozycji na magazyn, dokument
    zostaje (status 'anulowany'), nie jest usuwany."""
    return svc.cancel_wz(wz_id)


@router.get("/from-order/{order_id}/preview")
def from_order_preview(order_id: str):
    """Pozycje przyszłego WZ z zamówienia (do okna cen) — bez tworzenia dokumentu."""
    return svc.preview_order_wz(order_id)


@router.post("/from-order")
def from_order(body: dict):
    order_id = (body.get("orderId") or "").strip()
    if not order_id:
        raise HTTPException(400, "orderId wymagany")
    return svc.create_wz_from_order(
        order_id,
        valued=bool(body.get("valued", False)),
        currency=(body.get("currency") or "PLN"),
        eur_rate=body.get("eurRate"),
        prices=body.get("prices") or None,
    )


@router.get("/{wz_id}")
def get(wz_id: str):
    return svc.get_wz(wz_id)
