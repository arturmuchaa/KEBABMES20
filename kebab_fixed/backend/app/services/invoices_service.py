"""Invoices.

When ``create_wz=True`` the invoice also tops up packaging / ingredient
stock — that mutation happens inside the same transaction so the
financial record and the stock reception are always atomic.
"""
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import (
    cx_execute,
    cx_execute_returning,
    cx_execute_rowcount,
    cx_query_one,
    transaction,
    query_all,
)
from app.logging_config import get_logger
from app.models.invoices import InvoiceCreate
from app.utils.ids import cuid, now_iso
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)


def list_invoices(category: str | None) -> List[Dict]:
    sql = (
        "SELECT i.*, s.name as supplier_name "
        "FROM invoices i LEFT JOIN suppliers s ON s.id = i.supplier_id"
    )
    params: list = []
    if category:
        sql += " WHERE i.category = %s"
        params.append(category)
    sql += " ORDER BY i.invoice_date DESC"
    return query_all(sql, params or None)


def create_invoice(dto: InvoiceCreate) -> Dict:
    net = round(dto.qty * dto.unit_price, 2)
    vat = round(net * dto.vat_rate, 2)
    gross = round(net + vat, 2)
    amount_eur = dto.amount_eur
    exchange_rate = dto.exchange_rate
    if dto.currency == "EUR" and exchange_rate and not amount_eur:
        amount_eur = round(gross / exchange_rate, 2)

    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO invoices
                (id, invoice_no, supplier_id, category, invoice_date, due_date,
                 qty, unit_price, vat_rate, total_net, total_vat, total_gross,
                 raw_batch_id, ingredient_id, packaging_id, notes, currency,
                 exchange_rate, amount_eur, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                cuid(),
                dto.invoice_no,
                dto.supplier_id,
                dto.category,
                dto.invoice_date,
                dto.due_date or None,
                dto.qty,
                dto.unit_price,
                dto.vat_rate,
                net,
                vat,
                gross,
                dto.raw_batch_id or None,
                dto.ingredient_id or None,
                dto.packaging_id or None,
                dto.notes or None,
                dto.currency or "PLN",
                exchange_rate,
                amount_eur,
                now_iso(),
            ),
        )
        assert row is not None

        if dto.create_wz:
            if dto.category == "OPAKOWANIA_TULEJE" and dto.packaging_id:
                # Lock packaging row before topping up
                pkg = cx_query_one(
                    conn,
                    "SELECT id FROM packaging WHERE id=%s FOR UPDATE",
                    (dto.packaging_id,),
                )
                if not pkg:
                    raise HTTPException(404, "Opakowanie nie znalezione")
                cx_execute(
                    conn,
                    """
                    UPDATE packaging
                    SET kg_available = COALESCE(kg_available,0) + %s,
                        kg_initial   = COALESCE(kg_initial,0)   + %s
                    WHERE id = %s
                    """,
                    (dto.qty, dto.qty, dto.packaging_id),
                )
                create_stock_movement(
                    conn,
                    product_type="packaging",
                    batch_id=dto.packaging_id,
                    qty=dto.qty,
                    movement_type="IN",
                    source_type="invoice",
                    source_id=row["id"],
                )
            elif dto.category == "PRZYPRAWY_I_DODATKI" and dto.ingredient_id:
                stock_id = cuid()
                cx_execute(
                    conn,
                    """
                    INSERT INTO ingredient_stock
                        (id, ingredient_id, qty_available, qty_initial,
                         expiry_date, batch_no, created_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        stock_id,
                        dto.ingredient_id,
                        dto.qty,
                        dto.qty,
                        dto.expiry_date or None,
                        dto.batch_no or None,
                        now_iso(),
                    ),
                )
                create_stock_movement(
                    conn,
                    product_type="ingredient",
                    batch_id=stock_id,
                    qty=dto.qty,
                    movement_type="IN",
                    source_type="invoice",
                    source_id=row["id"],
                )

    logger.info(
        "invoice.created",
        extra={
            "invoice_id": row["id"],
            "invoice_no": dto.invoice_no,
            "category": dto.category,
            "gross": gross,
        },
    )
    return row


def update_invoice(invoice_id: str, body: Dict[str, Any]) -> Dict:
    with transaction() as conn:
        existing = cx_query_one(
            conn,
            "SELECT id FROM invoices WHERE id=%s FOR UPDATE",
            (invoice_id,),
        )
        if not existing:
            raise HTTPException(404, "Faktura nie znaleziona")
        cx_execute(
            conn,
            """
            UPDATE invoices
            SET invoice_no=%s, category=%s, invoice_date=%s,
                due_date=%s, qty=%s, unit_price=%s, notes=%s
            WHERE id=%s
            """,
            (
                body.get("invoiceNo"),
                body.get("category"),
                body.get("invoiceDate"),
                body.get("dueDate") or None,
                body.get("qty", 0),
                body.get("unitPrice", 0),
                body.get("notes"),
                invoice_id,
            ),
        )
        row = cx_query_one(conn, "SELECT * FROM invoices WHERE id=%s", (invoice_id,))
    assert row is not None
    logger.info("invoice.updated", extra={"invoice_id": invoice_id})
    return row


def delete_invoice(invoice_id: str) -> Dict[str, bool]:
    with transaction() as conn:
        rowcount = cx_execute_rowcount(
            conn, "DELETE FROM invoices WHERE id=%s", (invoice_id,)
        )
    if rowcount == 0:
        raise HTTPException(404, "Faktura nie znaleziona")
    logger.info("invoice.deleted", extra={"invoice_id": invoice_id})
    return {"ok": True}
