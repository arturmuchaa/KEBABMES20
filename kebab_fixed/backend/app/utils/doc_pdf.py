"""Nazwy plików PDF dokumentów: PREFIKS_<pełna nazwa klienta>_<nr>.pdf."""
from typing import Optional

from app.db import query_one


def full_client_name(order_id: Optional[str], fallback: str = "") -> str:
    """Oficjalna (pełna) nazwa klienta z kartoteki dla zamówienia.

    Dokumenty (hdi_documents/cmr_documents.client_name) trzymają często nazwę
    skróconą z zamówienia ("ISSA DISTRIB") — plik ma mieć pełną
    ("SAS ISSA DISTRIB")."""
    if not order_id:
        return fallback
    order = query_one("SELECT client_id, client_name FROM client_orders WHERE id=%s", (order_id,))
    if not order:
        return fallback
    client = None
    if order.get("client_id"):
        client = query_one("SELECT name FROM clients WHERE id=%s", (order.get("client_id"),))
    if not client and order.get("client_name"):
        client = query_one("SELECT name FROM clients WHERE name=%s OR display_name=%s",
                           (order.get("client_name"), order.get("client_name")))
    return (client or {}).get("name") or order.get("client_name") or fallback


def doc_pdf_filename(prefix: str, client_name: str, number: str) -> str:
    safe_client = "_".join((client_name or "klient").split()).replace("/", "-")
    safe_no = (number or "").replace("/", "-")
    return f"{prefix}_{safe_client}_{safe_no}.pdf"
