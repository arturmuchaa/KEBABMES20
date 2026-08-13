"""Karta realizacji produkcji — formularz 2.5.1 oPRP (instrukcja 2.5).

Odwzorowuje AKTUALNĄ księgę HACCP (2026.01.525), nie poprzedni wzór
„Zalecenie produkcyjne". Stąd:

  • numer karty ``PK/N/MM/RR`` — „PK — produkcja kebabu, numer kolejny,
    miesiąc, rok" (instrukcja 2.5). Numer NADAJEMY RAZ i przechowujemy,
    bo instrukcja czyni z niego spinacz całej identyfikowalności:
    „numery przyjęcia surowców pochodzenia zwierzęcego, dodatków, przypraw,
    materiałów pomocniczych oraz materiałów opakowaniowych są powiązane
    z numerem produkcji PK poprzez kartę";
  • JEDNA tabela SKŁADNIKI (mięso + dodatki + opakowania), każdy wiersz
    z własnym NUMEREM DOSTAWY — zamiast dawnych trzech osobnych sekcji;
  • dalej: mrożenie, terminy przydatności (data + numer partii), strata
    produkcyjna, uwagi.

Jedna karta = jedna receptura z jednego dnia produkcji.

Łańcuch danych idzie OD WYROBU WSTECZ:
    finished_goods → source_seasoned_ids → seasoned_meat → mixing_orders
      → mixing_session_lots (rozbicie wsadów NA PARTIĘ) → raw_batches
      → receptions (numer przyjęcia)
Dzięki temu karta jest poprawna także wtedy, gdy masowanie odbyło się dzień
przed produkcją.

Skład partii PP wypisujemy co do kilograma — to pytanie, które przy kontroli
pada najczęściej.
"""
from datetime import date, timedelta
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.logging_config import get_logger
from app.utils.ids import cuid, next_seq

logger = get_logger(__name__)


def _as_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _kg(value: Any) -> float:
    return round(float(value or 0), 3)


# ── Numer karty PK/N/MM/RR ────────────────────────────────────────────

def build_card_no(seq: int, plan_date: str) -> str:
    """„PK/3/08/26" — numer kolejny w miesiącu, miesiąc, rok (instrukcja 2.5)."""
    d = _as_date(plan_date)
    return f"PK/{seq}/{d.strftime('%m')}/{d.strftime('%y')}"


def card_no_for(plan_date: str, recipe_id: str) -> str:
    """Numer karty — nadany RAZ, potem tylko odczytywany.

    Licznik jest miesięczny. Numer trzymamy w bazie, bo to numer dokumentu
    HACCP: nie może się przesunąć, gdy w minionym dniu dojdzie kolejna
    receptura albo gdy ktoś tylko przegląda listę.
    """
    day = _as_date(plan_date)
    row = query_one(
        "SELECT card_no FROM production_cards WHERE plan_date=%s AND recipe_id=%s",
        (day, recipe_id),
    )
    if row:
        return row["card_no"]
    no = build_card_no(next_seq(f"pk_{day.strftime('%Y%m')}"), str(day))
    execute(
        "INSERT INTO production_cards (id, plan_date, recipe_id, card_no) "
        "VALUES (%s,%s,%s,%s) ON CONFLICT (plan_date, recipe_id) DO NOTHING",
        (cuid(), day, recipe_id, no),
    )
    row = query_one(
        "SELECT card_no FROM production_cards WHERE plan_date=%s AND recipe_id=%s",
        (day, recipe_id),
    )
    return (row or {}).get("card_no") or no


# ── Skład partii przyprawionego („440 — 60 kg, 441 — 58 kg") ──────────

def format_origin(lots: List[Dict[str, Any]]) -> str:
    """Skład partii łączonej. Jeden wsad → pusto (numer stoi w swojej kolumnie)."""
    real = [l for l in lots if _kg(l.get("kg")) > 0]
    if len(real) <= 1:
        return ""
    return ", ".join(
        f"{l.get('raw_no') or '—'} — {_kg(l['kg']):g} kg" for l in real
    )


def format_packages(rows: List[Dict[str, Any]]) -> str:
    """„18 × 40 kg, 1 × 25 kg" — grupowanie po masie, najcięższe pierwsze."""
    by_kg: Dict[float, int] = {}
    for r in rows:
        kg_pu = _kg(r.get("kg_per_unit"))
        if kg_pu <= 0:
            continue
        by_kg[kg_pu] = by_kg.get(kg_pu, 0) + int(r.get("qty") or 0)
    return ", ".join(
        f"{qty} × {kg:g} kg"
        for kg, qty in sorted(by_kg.items(), key=lambda kv: -kv[0]) if qty > 0
    )


def _meat_components(seasoned_ids: List[str]) -> List[Dict[str, Any]]:
    """Mięso — jeden wiersz na partię przyprawionego (jeden wsad masownicy).

    Rozbicie wsadów bierzemy z `mixing_session_lots`. Sesje sprzed tego zapisu
    go nie mają — schodzimy wtedy na skład całego zlecenia i oznaczamy wiersz
    jako przybliżony, zamiast udawać precyzję, której w danych nie ma.
    """
    if not seasoned_ids:
        return []
    batches = query_all(
        """
        SELECT sm.batch_no, sm.mixing_order_no
        FROM seasoned_meat sm WHERE sm.id = ANY(%s)
        ORDER BY sm.batch_no
        """,
        (seasoned_ids,),
    )
    out: List[Dict[str, Any]] = []
    for b in batches:
        batch_no = b.get("batch_no") or ""
        order_no = b.get("mixing_order_no") or ""
        lots = query_all(
            """
            SELECT msl.raw_batch_no AS raw_no, msl.kg, ms.material_name,
                   r.reception_no
            FROM mixing_sessions s
            JOIN mixing_orders mo ON mo.id = s.order_id
            JOIN mixing_session_lots msl ON msl.session_id = s.id
            LEFT JOIN meat_stock ms ON ms.id = msl.meat_stock_id
            LEFT JOIN raw_batches rb ON rb.id = ms.raw_batch_id
            LEFT JOIN receptions r ON r.id = rb.reception_id
            WHERE mo.order_no = %s AND s.batch_no = %s
            ORDER BY msl.raw_batch_no
            """,
            (order_no, batch_no),
        )
        approx = False
        if not lots:
            approx = True
            lots = query_all(
                """
                SELECT rb.internal_batch_no AS raw_no,
                       COALESCE(mol.kg_actual, mol.kg_planned) AS kg,
                       ms.material_name, r.reception_no
                FROM mixing_orders mo
                JOIN mixing_order_lots mol ON mol.order_id = mo.id
                LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
                LEFT JOIN raw_batches rb ON rb.id = ms.raw_batch_id
                LEFT JOIN receptions r ON r.id = rb.reception_id
                WHERE mo.order_no = %s
                ORDER BY rb.internal_batch_seq
                """,
                (order_no,),
            )
        lots = [
            {"raw_no": l.get("raw_no") or "", "kg": _kg(l.get("kg")),
             "material": l.get("material_name") or "",
             "reception_no": l.get("reception_no") or ""}
            for l in lots if _kg(l.get("kg")) > 0
        ]
        if not lots:
            continue
        origin = format_origin(lots)
        uwagi = f"partia {batch_no}"
        if origin:
            uwagi += f" — z wsadu: {origin}"
        if approx:
            uwagi += " (skład zlecenia — sesja sprzed zapisu rozbicia)"
        out.append({
            "kind": "mięso",
            "name": next((l["material"] for l in lots if l["material"]), "Mięso"),
            "deliveryNo": ", ".join(
                sorted({l["reception_no"] for l in lots if l["reception_no"]})
            ),
            "kg": _kg(sum(l["kg"] for l in lots)),
            "unit": "kg",
            "note": uwagi,
            "batchNo": batch_no,
            "origin": origin,
        })
    return out


def _ingredient_components(
    recipe_id: str, meat_kg: float, on_date: date
) -> List[Dict[str, Any]]:
    """Przyprawy i dodatki — ilość z receptury, numer dostawy z magazynu.

    Numer dostawy (DF/N/MM wg instrukcji 1.3) powstaje przy PRZYJĘCIU
    przyprawy. Dopóki magazyn przypraw go nie zbiera, kolumna zostaje pusta
    i drukuje się jako pole do wypełnienia — karta nie zgaduje numeru partii.
    """
    ing = query_all(
        """
        SELECT ri.ingredient_id, ri.ingredient_name, ri.unit, ri.qty_per_100kg
        FROM recipe_ingredients ri WHERE ri.recipe_id = %s
        ORDER BY ri.seq, ri.id
        """,
        (recipe_id,),
    )
    out: List[Dict[str, Any]] = []
    for i in ing:
        lot = query_one(
            """
            SELECT ist.batch_no
            FROM ingredient_stock ist
            WHERE ist.ingredient_id = %s
              AND COALESCE(ist.batch_no,'') <> ''
              AND (ist.received_date IS NULL OR ist.received_date <= %s)
            ORDER BY ist.expiry_date NULLS LAST, ist.received_date NULLS LAST
            LIMIT 1
            """,
            (i["ingredient_id"], on_date),
        )
        out.append({
            "kind": "dodatek",
            "name": i.get("ingredient_name") or "",
            "deliveryNo": (lot or {}).get("batch_no") or "",
            "kg": _kg(float(i.get("qty_per_100kg") or 0) * meat_kg / 100.0),
            "unit": i.get("unit") or "kg",
            "note": "",
        })
    return out


def list_report_days(limit: int = 60) -> List[Dict[str, Any]]:
    """Dni produkcji × receptury. Numer karty pokazujemy tylko, jeśli już
    nadany — samo przeglądanie listy nie ma zużywać numerów z serii."""
    rows = query_all(
        """
        SELECT fg.produced_date, fg.recipe_id, fg.recipe_name,
               SUM(fg.total_kg) AS kg, SUM(fg.qty) AS szt,
               (SELECT pc.card_no FROM production_cards pc
                 WHERE pc.plan_date = fg.produced_date
                   AND pc.recipe_id = fg.recipe_id) AS card_no
        FROM finished_goods fg
        WHERE fg.produced_date IS NOT NULL
        GROUP BY fg.produced_date, fg.recipe_id, fg.recipe_name
        ORDER BY fg.produced_date DESC, fg.recipe_name
        LIMIT %s
        """,
        (limit,),
    )
    by_day: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        by_day.setdefault(str(r["produced_date"]), []).append({
            "recipeId": r.get("recipe_id") or "",
            "recipeName": r.get("recipe_name") or "",
            "kg": _kg(r.get("kg")),
            "qty": int(r.get("szt") or 0),
            "cardNo": r.get("card_no") or "",
        })
    return [{"planDate": d, "recipes": recs} for d, recs in by_day.items()]


def get_report(plan_date: str, recipe_id: str) -> Dict[str, Any]:
    day = _as_date(plan_date)
    recipe = query_one(
        "SELECT id, name, shelf_life_days FROM recipes WHERE id=%s", (recipe_id,)
    )
    goods = query_all(
        """
        SELECT fg.batch_no, fg.product_type_name, fg.recipe_name, fg.qty,
               fg.kg_per_unit, fg.total_kg, fg.produced_date,
               fg.source_seasoned_ids, fg.packaging_name
        FROM finished_goods fg
        WHERE fg.produced_date = %s AND fg.recipe_id = %s
        ORDER BY fg.batch_no, fg.kg_per_unit DESC
        """,
        (day, recipe_id),
    )
    if not goods:
        raise HTTPException(
            404, "Brak produkcji tej receptury w tym dniu — nie ma z czego złożyć karty."
        )

    seasoned_ids: List[str] = []
    for g in goods:
        for sid in (g.get("source_seasoned_ids") or []):
            if sid and sid not in seasoned_ids:
                seasoned_ids.append(sid)

    meat = _meat_components(seasoned_ids)
    meat_kg = _kg(sum(m["kg"] for m in meat))
    dodatki = _ingredient_components(recipe_id, meat_kg, day)
    # Instrukcja 2.5 każe wiązać z numerem PK także materiały opakowaniowe.
    opak = [
        {"kind": "opakowanie", "name": nazwa, "deliveryNo": "",
         "kg": None, "unit": "", "note": ""}
        for nazwa in sorted({
            g.get("packaging_name") or "" for g in goods if g.get("packaging_name")
        })
    ]

    shelf = int((recipe or {}).get("shelf_life_days") or 364)
    pt = query_one(
        """
        SELECT l.product_type_name
        FROM production_plan_lines l JOIN production_plans p ON p.id = l.plan_id
        WHERE p.plan_date = %s AND l.recipe_id = %s
          AND COALESCE(l.product_type_name,'') <> ''
        LIMIT 1
        """,
        (day, recipe_id),
    )

    grouped: Dict[str, Dict[str, Any]] = {}
    for g in goods:
        key = g.get("batch_no") or ""
        row = grouped.setdefault(key, {
            "batchNo": key, "rows": [], "kg": 0.0,
            "producedDate": str(g.get("produced_date") or day),
        })
        row["rows"].append(g)
        row["kg"] = _kg(row["kg"] + _kg(g.get("total_kg")))

    origin_by_batch = {m["batchNo"]: m["origin"] for m in meat if m.get("origin")}
    batches = []
    for row in grouped.values():
        short = row["batchNo"].split(" ")[-1] if row["batchNo"] else ""
        batches.append({
            "batchNo": row["batchNo"],
            "packages": format_packages(row["rows"]),
            "producedDate": row["producedDate"],
            "bestBefore": str(_as_date(row["producedDate"]) + timedelta(days=shelf)),
            "kg": row["kg"],
            "origin": origin_by_batch.get(short, ""),
            "storage": "Mrożony",
        })
    batches.sort(key=lambda b: b["batchNo"])

    return {
        "cardNo": card_no_for(str(day), recipe_id),
        "planDate": str(day),
        "recipeId": recipe_id,
        "recipeName": (recipe or {}).get("name") or (goods[0].get("recipe_name") or ""),
        "productName": (
            (pt or {}).get("product_type_name")
            or (recipe or {}).get("name")
            or (goods[0].get("recipe_name") or "")
        ),
        "producedKg": _kg(sum(b["kg"] for b in batches)),
        "components": meat + dodatki + opak,
        "componentsTotalKg": _kg(meat_kg + sum(d["kg"] for d in dodatki)),
        "meatKg": meat_kg,
        "batches": batches,
    }
