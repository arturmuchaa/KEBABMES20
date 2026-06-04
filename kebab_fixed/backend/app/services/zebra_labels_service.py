"""Etykiety Zebra (ZPL) — render placeholderów na danych sztuk."""
import re
from typing import Any, Dict

from app.db import query_all, query_one
from app.utils.unit_codes import best_before

_PLACEHOLDER_RE = re.compile(r"\[\[[A-Z_]+\]\]")


def _zpl_escape(s) -> str:
    """Usuń znaki sterujące ZPL (^ ~) z wartości, by nie rozbiły komend."""
    return (str(s) if s is not None else "").replace("^", " ").replace("~", " ")


def merge_zpl(zpl: str, values: Dict[str, str]) -> str:
    """Podstaw [[KLUCZ]] → wartość (escaped); pozostałe [[...]] usuń."""
    out = zpl or ""
    for key, val in values.items():
        out = out.replace(f"[[{key}]]", _zpl_escape(val))
    return _PLACEHOLDER_RE.sub("", out)


def _fmt_date(iso) -> str:
    s = (iso or "")[:10]
    if len(s) != 10 or s[4] != "-" or s[7] != "-":
        return ""
    return f"{s[8:10]}.{s[5:7]}.{s[0:4]}"


def _fmt_weight(kg) -> str:
    f = float(kg or 0)
    if f == int(f):
        return str(int(f))
    return f"{f:.1f}".replace(".", ",")


def unit_zpl_values(unit: Dict[str, Any], recipe: Dict[str, Any]) -> Dict[str, str]:
    """Słownik wartości placeholderów dla sztuki + receptury."""
    produced = (unit.get("produced_date") or "")
    shelf = int((recipe or {}).get("shelf_life_days") or 0)
    bb = best_before(produced, shelf) if produced else ""
    waga = _fmt_weight(unit.get("weight_kg"))
    return {
        "QR": unit.get("qr_code") or "",
        "PARTIA": unit.get("batch_no") or "",
        "DATA_PROD": _fmt_date(produced),
        "DATA_MROZ": _fmt_date(produced),
        "BEST_BEFORE": _fmt_date(bb),
        "WAGA": waga,
        "NETTO": waga,
        "KLIENT": unit.get("client_name") or "",
        "RECEPTURA": (recipe or {}).get("name") or "",
        "PRODUKT": (recipe or {}).get("product_type_name") or "",
    }


def render_zebra_labels(plan_line_id: str, client_id: str, recipe_id: str) -> Dict[str, Any]:
    """Zwróć sklejony ZPL dla wszystkich sztuk linii planu (szablon kind='zpl')."""
    tpl = query_one(
        "SELECT kind, zpl FROM label_templates WHERE client_id=%s AND recipe_id=%s",
        (client_id, recipe_id),
    )
    if not tpl or (tpl.get("kind") != "zpl") or not (tpl.get("zpl") or "").strip():
        return {"ok": False, "reason": "Brak szablonu Zebra dla klient+receptura"}

    recipe = query_one("SELECT * FROM recipes WHERE id=%s", (recipe_id,)) or {}
    units = query_all(
        """SELECT qr_code, batch_no, produced_date, weight_kg, client_name, product_type_id
           FROM finished_units WHERE plan_line_id=%s ORDER BY qr_seq""",
        (plan_line_id,),
    )
    if not units:
        return {"ok": False, "reason": "Brak sztuk do druku"}

    zpl_tpl = tpl["zpl"]
    blocks = [merge_zpl(zpl_tpl, unit_zpl_values(u, recipe)) for u in units]
    return {"ok": True, "zpl": "\n".join(blocks), "count": len(blocks)}
