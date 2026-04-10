"""Product types (receptur component registry)."""
import json
from typing import Dict, List

from fastapi import HTTPException

from app.db import (
    cx_execute,
    cx_execute_returning,
    query_all,
    transaction,
)
from app.logging_config import get_logger
from app.models.product_types import ProductTypeCreate
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)


def _map(row: Dict) -> Dict:
    comps = row.get("components") or []
    if isinstance(comps, str):
        try:
            comps = json.loads(comps)
        except Exception:
            comps = []
    result_comps: List[Dict] = []
    for c in comps:
        if isinstance(c, dict):
            result_comps.append(
                {
                    "id": c.get("id", cuid()),
                    "name": c.get("name", ""),
                    "pct": float(c.get("pct", 0)),
                    "sourceType": c.get("sourceType", "meat_stock"),
                }
            )
    return {
        "id": row["id"],
        "name": row.get("name", ""),
        "description": row.get("description") or "",
        "components": result_comps,
        "active": row.get("active", True),
        "createdAt": str(row.get("created_at", "")),
    }


def list_product_types() -> List[Dict]:
    rows = query_all(
        "SELECT * FROM product_types WHERE active = true ORDER BY name"
    )
    return [_map(r) for r in rows]


def _comps_to_json(components: List) -> str:
    return json.dumps(
        [
            {
                "id": c.get("id", cuid()),
                "name": c.get("name", ""),
                "pct": c.get("pct", 0),
                "sourceType": c.get("sourceType", "meat_stock"),
            }
            for c in components
            if isinstance(c, dict)
        ]
    )


def create_product_type(dto: ProductTypeCreate) -> Dict:
    comps_json = _comps_to_json(dto.components)
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO product_types
                (id, name, description, components, active, created_at)
            VALUES (%s,%s,%s,%s::jsonb,true,%s)
            RETURNING *
            """,
            (cuid(), dto.name, dto.description or None, comps_json, now_iso()),
        )
    assert row is not None
    logger.info("product_type.created", extra={"id": row["id"]})
    return _map(row)


def update_product_type(type_id: str, dto: ProductTypeCreate) -> Dict:
    comps_json = _comps_to_json(dto.components)
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            UPDATE product_types
            SET name=%s, description=%s, components=%s::jsonb
            WHERE id=%s
            RETURNING *
            """,
            (dto.name, dto.description or None, comps_json, type_id),
        )
    if not row:
        raise HTTPException(404, "Rodzaj produktu nie znaleziony")
    logger.info("product_type.updated", extra={"id": type_id})
    return _map(row)


def deactivate_product_type(type_id: str) -> Dict[str, bool]:
    with transaction() as conn:
        cx_execute(
            conn,
            "UPDATE product_types SET active=false WHERE id=%s",
            (type_id,),
        )
    logger.info("product_type.deactivated", extra={"id": type_id})
    return {"ok": True}
