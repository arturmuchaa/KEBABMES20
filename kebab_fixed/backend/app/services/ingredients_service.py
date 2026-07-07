from typing import Any, Dict, List

from app.db import (
    cx_execute,
    cx_execute_returning,
    cx_query_one,
    query_all,
    transaction,
)
from app.logging_config import get_logger
from app.models.ingredients import IngredientCreate
from app.utils.body import body_get
from app.utils.ids import cuid, now_iso
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)


def list_ingredients() -> List[Dict]:
    return query_all("SELECT * FROM ingredients WHERE active = true ORDER BY name")


def ingredient_stock() -> List[Dict]:
    return query_all(
        """
        SELECT
            i.*,
            COALESCE(SUM(s.qty_available), 0) AS qty_available_total,
            MAX(COALESCE(s.received_date, s.created_at::date)) AS last_receipt_at
        FROM ingredients i
        LEFT JOIN ingredient_stock s ON s.ingredient_id = i.id
        GROUP BY i.id
        ORDER BY i.name
        """
    )


def create_ingredient(dto: IngredientCreate) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO ingredients
                (id, code, name, unit, is_unlimited, category, active, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,true,%s)
            RETURNING *
            """,
            (cuid(), dto.code, dto.name, dto.unit, dto.is_unlimited,
             getattr(dto, "category", None) or "other", now_iso()),
        )
    logger.info("ingredient.created", extra={"ingredient_id": row["id"]})
    return row


def deactivate_ingredient(ingredient_id: str) -> None:
    with transaction() as conn:
        cx_execute(
            conn, "UPDATE ingredients SET active=false WHERE id=%s", (ingredient_id,)
        )
    logger.info("ingredient.deactivated", extra={"ingredient_id": ingredient_id})


def list_ingredient_receipts() -> List[Dict]:
    return query_all(
        """
        SELECT
            s.*,
            i.name AS ingredient_name,
            i.unit
        FROM ingredient_stock s
        LEFT JOIN ingredients i ON i.id = s.ingredient_id
        ORDER BY COALESCE(s.received_date, s.created_at::date) DESC, s.created_at DESC
        """
    )


def create_ingredient_receipt(body: Dict[str, Any]) -> Dict:
    ingredient_id = body_get(body, "ingredient_id")
    qty = float(body_get(body, "qty", 0) or 0)
    stock_id = cuid()
    with transaction() as conn:
        cx_execute_returning(
            conn,
            """
            INSERT INTO ingredient_stock
                (id, ingredient_id, qty_available, qty_initial,
                 expiry_date, batch_no, supplier_id, price_per_unit,
                 invoice_no, received_date, notes, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
            """,
            (
                stock_id,
                ingredient_id,
                qty,
                qty,
                body_get(body, "expiry_date") or None,
                body_get(body, "batch_no") or None,
                body_get(body, "supplier_id") or None,
                body_get(body, "price_per_unit", 0) or 0,
                body_get(body, "invoice_no") or None,
                body_get(body, "received_date") or None,
                body_get(body, "notes") or None,
                now_iso(),
            ),
        )
        row = cx_query_one(
            conn,
            """
            SELECT
                s.*,
                i.name AS ingredient_name,
                i.unit
            FROM ingredient_stock s
            LEFT JOIN ingredients i ON i.id = s.ingredient_id
            WHERE s.id = %s
            """,
            (stock_id,),
        )
        if qty > 0:
            create_stock_movement(
                conn,
                product_type="ingredient",
                batch_id=stock_id,
                qty=qty,
                movement_type="IN",
                source_type="ingredient_receipt",
                source_id=stock_id,
            )
    assert row is not None
    logger.info(
        "ingredient.receipt.created",
        extra={"stock_id": stock_id, "ingredient_id": ingredient_id, "qty": qty},
    )
    return row
