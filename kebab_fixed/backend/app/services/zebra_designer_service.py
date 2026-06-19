"""Wizualny projektant etykiet Zebra → natywny ZPL."""
import json
import re
from typing import Any, Dict, List

from app.db import cx_execute_returning, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid
from app.services.zebra_labels_service import _zpl_escape, unit_zpl_values

logger = get_logger(__name__)

_TOKEN_RE = re.compile(r"\[\[[A-Z_]+\]\]")

_SAMPLE = {
    "QR": "U|sample", "PARTIA": "030626333", "DATA_PROD": "01.06.2026",
    "DATA_MROZ": "01.06.2026", "BEST_BEFORE": "01.06.2027", "WAGA": "15",
    "NETTO": "15", "KLIENT": "Zagros", "RECEPTURA": "Kebab", "PRODUKT": "Kebab",
}


def _mm_to_dots(mm, dpi) -> int:
    return round(float(mm or 0) / 25.4 * float(dpi or 203))


def _merge(value: str, values: Dict[str, str]) -> str:
    out = value or ""
    for k, v in (values or {}).items():
        out = out.replace(f"[[{k}]]", _zpl_escape(v))
    return _TOKEN_RE.sub("", out)


def design_to_zpl(design: Dict[str, Any], values: Dict[str, str]) -> str:
    dpi = int(design.get("dpi") or 203)
    w = _mm_to_dots(design.get("width_mm") or 100, dpi)
    h = _mm_to_dots(design.get("height_mm") or 150, dpi)
    out: List[str] = ["^XA", "^CI28", f"^PW{w}", f"^LL{h}", "^LS0"]
    for el in (design.get("elements") or []):
        t = el.get("type")
        x = _mm_to_dots(el.get("x") or 0, dpi)
        y = _mm_to_dots(el.get("y") or 0, dpi)
        if t == "text":
            fw = _mm_to_dots(el.get("fontMm") or 3, dpi)
            bw = _mm_to_dots(el.get("w") or 50, dpi)
            just = (el.get("align") or "L").upper()
            if just not in ("L", "C", "R"):
                just = "L"
            txt = _merge(el.get("value") or "", values)
            out.append(f"^FO{x},{y}^A0N,{fw},{fw}^FB{bw},50,0,{just},0^FD{txt}^FS")
        elif t == "qr":
            mag = int(el.get("mag") or 4)
            data = _merge(el.get("value") or "", values)
            out.append(f"^FO{x},{y}^BQN,2,{mag}^FDLA,{data}^FS")
        elif t == "box":
            bw = _mm_to_dots(el.get("w") or 10, dpi)
            bh = _mm_to_dots(el.get("h") or 10, dpi)
            th = max(1, _mm_to_dots(el.get("thickMm") or 0.3, dpi))
            out.append(f"^FO{x},{y}^GB{bw},{bh},{th}^FS")
    out.append("^XZ")
    return "\n".join(out)


def _row_to_design(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "recipeId": row.get("recipe_id") or "",
        "sizeKey": row.get("size_key") or "",
        "widthMm": float(row.get("width_mm") or 100),
        "heightMm": float(row.get("height_mm") or 150),
        "dpi": int(row.get("dpi") or 203),
        "elements": row.get("elements") or [],
    }


def get_design(recipe_id: str, size_key: str) -> Dict[str, Any]:
    row = query_one(
        "SELECT * FROM zebra_label_designs WHERE recipe_id=%s AND size_key=%s",
        (recipe_id, size_key),
    )
    if not row:
        return {"exists": False, "design": None}
    return {"exists": True, "design": _row_to_design(row)}


def save_design(dto: Dict[str, Any]) -> Dict[str, Any]:
    with transaction() as conn:
        cx_execute_returning(
            conn,
            """
            INSERT INTO zebra_label_designs
                (id, recipe_id, size_key, width_mm, height_mm, dpi, elements, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb, now())
            ON CONFLICT (recipe_id, size_key) DO UPDATE SET
                width_mm = EXCLUDED.width_mm, height_mm = EXCLUDED.height_mm,
                dpi = EXCLUDED.dpi, elements = EXCLUDED.elements, updated_at = now()
            RETURNING id
            """,
            (cuid(), dto.get("recipe_id") or "", dto.get("size_key") or "",
             float(dto.get("width_mm") or 100), float(dto.get("height_mm") or 150),
             int(dto.get("dpi") or 203), json.dumps(dto.get("elements") or [])),
        )
    return {"ok": True}


def _design_dict_from_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "width_mm": float(row.get("width_mm") or 100),
        "height_mm": float(row.get("height_mm") or 150),
        "dpi": int(row.get("dpi") or 203),
        "elements": row.get("elements") or [],
    }


def render_units(recipe_id: str, size_key: str, plan_line_id: str) -> Dict[str, Any]:
    row = query_one(
        "SELECT * FROM zebra_label_designs WHERE recipe_id=%s AND size_key=%s",
        (recipe_id, size_key),
    )
    if not row:
        return {"ok": False, "reason": "Brak projektu etykiety Zebra"}
    recipe = query_one("SELECT * FROM recipes WHERE id=%s", (recipe_id,)) or {}
    units = query_all(
        """SELECT qr_code, batch_no, produced_date, weight_kg, client_name, product_type_id
           FROM finished_units WHERE plan_line_id=%s ORDER BY qr_seq""",
        (plan_line_id,),
    )
    if not units:
        return {"ok": False, "reason": "Brak sztuk do druku"}
    design = _design_dict_from_row(row)
    blocks = [design_to_zpl(design, unit_zpl_values(u, recipe)) for u in units]
    return {"ok": True, "zpl": "\n".join(blocks), "count": len(blocks)}


def render_sample(design: Dict[str, Any]) -> Dict[str, Any]:
    return {"ok": True, "zpl": design_to_zpl(design, _SAMPLE), "count": 1}
