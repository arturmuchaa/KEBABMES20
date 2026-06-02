"""label_templates — upsert, pobieranie i sprawdzanie szablonu etykiety (per klient+receptura)."""
from typing import Any, Dict, Optional

from app.db import cx_execute_returning, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid

logger = get_logger(__name__)


def _row_to_summary(row: Dict[str, Any]) -> Dict[str, Any]:
    """Mapuje wiersz DB na camelCase (bez backgroundData — dla listy/upsert)."""
    return {
        "id": row["id"],
        "clientId": row.get("client_id") or "",
        "recipeId": row.get("recipe_id") or "",
        "kind": row.get("kind") or "overlay",
        "pageSize": row.get("page_size") or "a4",
        "labelsPerSheet": int(row.get("labels_per_sheet") or 2),
        "hasBackground": bool(row.get("background_data")),
        "fieldPositions": row.get("field_positions") or {},
    }


def _row_to_full(row: Dict[str, Any]) -> Dict[str, Any]:
    """Mapuje wiersz DB na camelCase (pełny, z backgroundData i zpl)."""
    return {
        "id": row["id"],
        "clientId": row.get("client_id") or "",
        "recipeId": row.get("recipe_id") or "",
        "kind": row.get("kind") or "overlay",
        "backgroundData": row.get("background_data") or "",
        "fieldPositions": row.get("field_positions") or {},
        "pageSize": row.get("page_size") or "a4",
        "labelsPerSheet": int(row.get("labels_per_sheet") or 2),
        "zpl": row.get("zpl") or "",
        "hasBackground": bool(row.get("background_data")),
    }


def upsert_template(dto: Dict[str, Any]) -> Dict[str, Any]:
    """Tworzy lub aktualizuje szablon etykiety dla pary (client_id, recipe_id).

    Przy kolizji UNIQUE (client_id, recipe_id) nadpisuje wszystkie pola
    i odświeża updated_at. Zwraca podsumowanie bez pola backgroundData
    (aby nie przenosić dużego base64 z powrotem).
    """
    new_id = cuid()
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO label_templates
                (id, client_id, recipe_id, kind, background_data,
                 field_positions, page_size, labels_per_sheet, zpl, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, now())
            ON CONFLICT (client_id, recipe_id) DO UPDATE SET
                kind             = EXCLUDED.kind,
                background_data  = EXCLUDED.background_data,
                field_positions  = EXCLUDED.field_positions,
                page_size        = EXCLUDED.page_size,
                labels_per_sheet = EXCLUDED.labels_per_sheet,
                zpl              = EXCLUDED.zpl,
                updated_at       = now()
            RETURNING *
            """,
            (
                new_id,
                dto.get("client_id") or "",
                dto.get("recipe_id") or "",
                dto.get("kind") or "overlay",
                dto.get("background_data") or "",
                __import__("json").dumps(dto.get("field_positions") or {}),
                dto.get("page_size") or "a4",
                int(dto.get("labels_per_sheet") or 2),
                dto.get("zpl") or "",
            ),
        )

    logger.info(
        "label_templates.upsert",
        extra={
            "id": (row or {}).get("id"),
            "client_id": dto.get("client_id"),
            "recipe_id": dto.get("recipe_id"),
        },
    )
    return _row_to_summary(row) if row else {}


def get_template(client_id: str, recipe_id: str) -> Optional[Dict[str, Any]]:
    """Zwraca pełny szablon (incl. backgroundData) lub None jeśli nie istnieje."""
    row = query_one(
        "SELECT * FROM label_templates WHERE client_id=%s AND recipe_id=%s",
        (client_id, recipe_id),
    )
    if row is None:
        return None
    return _row_to_full(row)


def template_exists(client_id: str, recipe_id: str) -> Dict[str, Any]:
    """Sprawdza czy szablon dla danej pary (client_id, recipe_id) istnieje."""
    row = query_one(
        "SELECT id FROM label_templates WHERE client_id=%s AND recipe_id=%s",
        (client_id, recipe_id),
    )
    return {"exists": row is not None}
