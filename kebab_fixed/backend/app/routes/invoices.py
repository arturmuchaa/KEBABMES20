"""Invoice endpoints."""
from fastapi import APIRouter, Query

from app.models.invoices import InvoiceCreate
from app.services import invoices_service as svc

router = APIRouter(prefix="/api/invoices", tags=["invoices"])


@router.get("")
def list_invoices(category: str = Query("")):
    return svc.list_invoices(category or None)


@router.post("")
def create_invoice(dto: InvoiceCreate):
    return svc.create_invoice(dto)


@router.patch("/{invoice_id}")
def update_invoice(invoice_id: str, body: dict):
    return svc.update_invoice(invoice_id, body)


@router.delete("/{invoice_id}")
def delete_invoice(invoice_id: str):
    return svc.delete_invoice(invoice_id)
