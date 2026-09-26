"""Ten sam rozpis i dopasowanie tulei dla routingu, zapisu oraz licznika HMI."""
from app.utils.unit_codes import pallet_line_key


def line_accepts(unit, line):
    return (pallet_line_key(unit.get("product_type_id"), unit.get("recipe_id"), unit.get("weight_kg"))
            == pallet_line_key(line.get("product_type_id"), line.get("recipe_id"), line.get("kg_per_unit"))
            and (not line.get("packaging_name") or line["packaging_name"] == (unit.get("tuleja") or "")))


def counted_lines(lines, units):
    result = [{**line, "target_qty": int(line.get("target_qty", line.get("qty", 0)) or 0),
               "packed_qty": 0} for line in lines]
    for unit in units:
        candidates = sorted((l for l in result if line_accepts(unit, l)),
                            key=lambda l: not bool(l.get("packaging_name")))
        remaining = int(unit.get("n", 1))
        for line in candidates:
            take = min(remaining, max(0, line["target_qty"] - line["packed_qty"]))
            line["packed_qty"] += take
            remaining -= take
        if remaining and candidates:
            # Nie ukrywamy historycznej nadwyżki; nowy zapis jej nie dopuści.
            candidates[-1]["packed_qty"] += remaining
    return result
