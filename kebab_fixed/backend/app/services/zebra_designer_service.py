"""Wizualny projektant etykiet Zebra → natywny ZPL."""
import json
import re
from typing import Any, Dict, List

from app.db import cx_execute_returning, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid
from app.services.zebra_labels_service import _zpl_escape, unit_zpl_values
from app.services.label_templates_service import client_key_candidates

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


def _element_blocks(elements, dpi, values) -> List[str]:
    out: List[str] = []
    for el in (elements or []):
        t = el.get("type")
        x = _mm_to_dots(el.get("x") or 0, dpi)
        y = _mm_to_dots(el.get("y") or 0, dpi)
        # Element zrasteryzowany (obraz HALAL/WE, albo tekst-grafika z fontem systemowym
        # i polskimi znakami): gotowe ^GFA wygenerowane w przeglądarce.
        gf = el.get("gf")
        if gf:
            out.append(f"^FO{x},{y}{gf}^FS")
            continue
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
    return out


def design_to_zpl(design: Dict[str, Any], values: Dict[str, str]) -> str:
    dpi = int(design.get("dpi") or 203)
    blocks = _element_blocks(design.get("elements"), dpi, values)
    bg = (design.get("background_zpl") or "").strip()
    if bg:
        # Tło wklejone z Zebra Designer (statyka 1:1) — usuń zamykające ^XZ,
        # dołącz ^CI28 (UTF-8 dla nakładki) i pola dynamiczne na wierzch, zamknij ^XZ.
        base = re.sub(r"\^XZ\s*$", "", bg).rstrip()
        if "^CI28" not in base:
            base = re.sub(r"(\^XA)", r"\1^CI28", base, count=1)
        parts = [base] + blocks + ["^XZ"]
        return "\n".join(p for p in parts if p)
    w = _mm_to_dots(design.get("width_mm") or 100, dpi)
    h = _mm_to_dots(design.get("height_mm") or 150, dpi)
    return "\n".join(["^XA", "^CI28", f"^PW{w}", f"^LL{h}", "^LS0", *blocks, "^XZ"])


def _row_to_design(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "clientId": row.get("client_id") or "",
        "recipeId": row.get("recipe_id") or "",
        "sizeKey": row.get("size_key") or "",
        "widthMm": float(row.get("width_mm") or 100),
        "heightMm": float(row.get("height_mm") or 150),
        "dpi": int(row.get("dpi") or 203),
        "backgroundZpl": row.get("background_zpl") or "",
        "elements": row.get("elements") or [],
    }


def get_design(client_id: str, recipe_id: str) -> Dict[str, Any]:
    row = query_one(
        "SELECT * FROM zebra_label_designs WHERE client_id = ANY(%s) AND recipe_id=%s",
        (client_key_candidates(client_id), recipe_id),
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
                (id, client_id, recipe_id, size_key, width_mm, height_mm, dpi, background_zpl, elements, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb, now())
            ON CONFLICT (client_id, recipe_id) DO UPDATE SET
                size_key = EXCLUDED.size_key,
                width_mm = EXCLUDED.width_mm, height_mm = EXCLUDED.height_mm,
                dpi = EXCLUDED.dpi, background_zpl = EXCLUDED.background_zpl,
                elements = EXCLUDED.elements, updated_at = now()
            RETURNING id
            """,
            (cuid(), dto.get("client_id") or "", dto.get("recipe_id") or "", dto.get("size_key") or "",
             float(dto.get("width_mm") or 100), float(dto.get("height_mm") or 150),
             int(dto.get("dpi") or 203), dto.get("background_zpl") or "",
             json.dumps(dto.get("elements") or [])),
        )
    return {"ok": True}


def _design_dict_from_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "width_mm": float(row.get("width_mm") or 100),
        "height_mm": float(row.get("height_mm") or 150),
        "dpi": int(row.get("dpi") or 203),
        "background_zpl": row.get("background_zpl") or "",
        "elements": row.get("elements") or [],
    }


def render_units(client_id: str, recipe_id: str, plan_line_id: str) -> Dict[str, Any]:
    row = query_one(
        "SELECT * FROM zebra_label_designs WHERE client_id = ANY(%s) AND recipe_id=%s",
        (client_key_candidates(client_id), recipe_id),
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
