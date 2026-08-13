"""Karta 2.5.1 — ZALECENIE PRODUKCYJNE (raport z realizacji produkcji).

Jedna karta = JEDNA RECEPTURA z jednego dnia produkcji. Dokument jest
składany z danych MES, więc jest dostępny od razu po zamknięciu dnia.

Łańcuch danych idzie OD WYROBU WSTECZ, nie od daty masowania:
    finished_goods (dzień + receptura)
      → source_seasoned_ids  → seasoned_meat (partie przyprawionego)
      → mixing_orders        → mixing_order_lots (wsady surowca + kg)
      → raw_batches          (numery porządkowe)
Dzięki temu karta jest poprawna także wtedy, gdy masowanie odbyło się dzień
wcześniej niż produkcja — a tak bywa (prod. 13.08.2026).

Weterynaria pyta przede wszystkim, SKĄD WZIĘŁA SIĘ PARTIA PP. Partia łączona
powstaje z resztek kilku wsadów, więc jej skład wypisujemy co do kilograma
(„440 — 60 kg, 441 — 58 kg") i pokazujemy DWA RAZY: przy surowcu i przy
partii w sekcji pakowania.
"""
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import query_all, query_one
from app.logging_config import get_logger

logger = get_logger(__name__)

# Numer karty: P/ddmmrr/N — N kolejno per receptura w dniu (jak P/030826/1).
# Wyprowadzany z danych, nie z licznika: dzień zamknięty już się nie zmienia,
# więc numer jest stabilny (ten sam chwyt co przy karcie sanitarnej).
CARD_PREFIX = "P"


def card_no(plan_date: str, seq: int) -> str:
    d = _as_date(plan_date)
    return f"{CARD_PREFIX}/{d.strftime('%d%m%y')}/{seq}"


def _as_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _kg(value: Any) -> float:
    return round(float(value or 0), 3)


def _fmt_kg(value: Any) -> str:
    """1318.0 → „1 318,0 kg" (zapis z karty papierowej)."""
    s = f"{_kg(value):,.1f}".replace(",", " ").replace(".", ",")
    return f"{s} kg"


# ── Sekcja: PAKOWANIE — opakowania „18 × 40 kg, 1 × 25 kg" ────────────

def format_packages(rows: List[Dict[str, Any]]) -> str:
    """Grupuje sztuki po masie i zapisuje tak, jak na karcie papierowej.

    Kolejność malejąco po masie — najcięższe szyszki najpierw, jak w Excelu.
    """
    by_kg: Dict[float, int] = {}
    for r in rows:
        kg_pu = _kg(r.get("kg_per_unit"))
        if kg_pu <= 0:
            continue
        by_kg[kg_pu] = by_kg.get(kg_pu, 0) + int(r.get("qty") or 0)
    parts = [
        f"{qty} × {kg:g} kg"
        for kg, qty in sorted(by_kg.items(), key=lambda kv: -kv[0])
        if qty > 0
    ]
    return ", ".join(parts)


# ── Sekcja: SUROWIEC — skład partii przyprawionego ────────────────────

def format_origin(lots: List[Dict[str, Any]]) -> str:
    """Skład partii łączonej: „440 — 60 kg, 441 — 58 kg".

    Dla jednego wsadu zwraca pusty łańcuch — numer porządkowy stoi wtedy
    we własnej kolumnie i powtarzanie go byłoby szumem.
    """
    real = [l for l in lots if _kg(l.get("kg")) > 0]
    if len(real) <= 1:
        return ""
    return ", ".join(
        f"{l.get('raw_no') or '—'} — {_kg(l['kg']):g} kg" for l in real
    )


def _ingredient_rows(
    recipe_id: str, meat_kg: float, on_date: date
) -> List[Dict[str, Any]]:
    """Składniki receptury przeliczone na pobrane mięso + numer przyjęcia.

    Ilość liczymy z receptury (qty_per_100kg), bo MES nie waży przypraw.
    Numeru partii przyprawy MES nie zapisuje przy masowaniu, więc
    podpowiadamy najstarszą dostępną w tym dniu (FEFO) i oznaczamy jako
    SUGESTIĘ — biuro potwierdza przy druku.
    """
    ing = query_all(
        """
        SELECT ri.ingredient_id, ri.ingredient_name, ri.unit,
               ri.qty_per_100kg, ri.seq
        FROM recipe_ingredients ri
        WHERE ri.recipe_id = %s
        ORDER BY ri.seq, ri.id
        """,
        (recipe_id,),
    )
    out: List[Dict[str, Any]] = []
    for i in ing:
        qty = _kg(float(i.get("qty_per_100kg") or 0) * meat_kg / 100.0)
        lot = query_one(
            """
            SELECT ist.batch_no, s.name AS supplier_name
            FROM ingredient_stock ist
            LEFT JOIN suppliers s ON s.id = ist.supplier_id
            WHERE ist.ingredient_id = %s
              AND (ist.received_date IS NULL OR ist.received_date <= %s)
            ORDER BY ist.expiry_date NULLS LAST, ist.received_date NULLS LAST
            LIMIT 1
            """,
            (i["ingredient_id"], on_date),
        )
        receipt = ""
        if lot:
            receipt = " ".join(
                x for x in [lot.get("batch_no") or "", lot.get("supplier_name") or ""] if x
            ).strip()
        out.append({
            "name": i.get("ingredient_name") or "",
            "qty": qty,
            "unit": i.get("unit") or "kg",
            "receiptNo": receipt,
            "receiptSuggested": bool(receipt),
        })
    return out


def _mixing_sources(seasoned_ids: List[str]) -> List[Dict[str, Any]]:
    """Wsady surowca per ZLECENIE masowania + partie, które z niego powstały.

    UWAGA — granulacja: ruch zużycia mięsa zapisuje `source_id = zlecenie`,
    a nie sesję, więc gdy jedno zlecenie rodzi kilka partii przyprawionego
    (np. 470, 472 i PP13), MES NIE WIE, ile kilogramów poszło do której.
    Rozbicie per partia jest liczone przy masowaniu, ale nie utrwalane.
    Dlatego karta pokazuje skład ZLECENIA i wymienia partie, które z niego
    wyszły — to zapis prawdziwy, choć grubszy niż na karcie papierowej.
    Zliczanie per partia dawałoby wielokrotność tego samego surowca.
    """
    if not seasoned_ids:
        return []
    batches = query_all(
        """
        SELECT sm.batch_no, sm.mixing_order_no, sm.kg_produced
        FROM seasoned_meat sm
        WHERE sm.id = ANY(%s)
        ORDER BY sm.mixing_order_no, sm.batch_no
        """,
        (seasoned_ids,),
    )
    by_order: Dict[str, List[Dict[str, Any]]] = {}
    for b in batches:
        by_order.setdefault(b.get("mixing_order_no") or "", []).append(b)

    out: List[Dict[str, Any]] = []
    for order_no, produced in by_order.items():
        lots = query_all(
            """
            SELECT rb.internal_batch_no AS raw_no,
                   ms.material_name,
                   COALESCE(mol.kg_actual, mol.kg_planned) AS kg
            FROM mixing_orders mo
            JOIN mixing_order_lots mol ON mol.order_id = mo.id
            LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
            LEFT JOIN raw_batches rb ON rb.id = ms.raw_batch_id
            WHERE mo.order_no = %s
            ORDER BY rb.internal_batch_seq
            """,
            (order_no,),
        )
        out.append({
            "mixingOrderNo": order_no,
            "batchNos": [b.get("batch_no") or "" for b in produced],
            "lots": [
                {"raw_no": l.get("raw_no") or "", "kg": _kg(l.get("kg")),
                 "material": l.get("material_name") or ""}
                for l in lots if _kg(l.get("kg")) > 0
            ],
        })
    return out


def list_report_days(limit: int = 60) -> List[Dict[str, Any]]:
    """Dni produkcji z recepturami — lista kart do druku."""
    rows = query_all(
        """
        SELECT fg.produced_date, fg.recipe_id, fg.recipe_name,
               SUM(fg.total_kg) AS kg, SUM(fg.qty) AS szt
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
        day = str(r["produced_date"])
        by_day.setdefault(day, []).append({
            "recipeId": r.get("recipe_id") or "",
            "recipeName": r.get("recipe_name") or "",
            "kg": _kg(r.get("kg")),
            "qty": int(r.get("szt") or 0),
        })
    out = []
    for day, recipes in by_day.items():
        for seq, rec in enumerate(recipes, start=1):
            rec["cardNo"] = card_no(day, seq)
        out.append({"planDate": day, "recipes": recipes})
    return out


def get_report(plan_date: str, recipe_id: str) -> Dict[str, Any]:
    """Pełna karta 2.5.1 dla dnia i receptury."""
    day = _as_date(plan_date)
    recipe = query_one(
        "SELECT id, name, shelf_life_days FROM recipes WHERE id=%s", (recipe_id,)
    )
    goods = query_all(
        """
        SELECT fg.id, fg.batch_no, fg.product_type_name, fg.recipe_name,
               fg.qty, fg.kg_per_unit, fg.total_kg, fg.produced_date,
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

    # Numer karty = kolejność receptury w dniu (stabilna: dzień jest zamknięty)
    order = query_all(
        """
        SELECT DISTINCT fg.recipe_id, fg.recipe_name
        FROM finished_goods fg
        WHERE fg.produced_date = %s
        ORDER BY fg.recipe_name
        """,
        (day,),
    )
    seq = next(
        (i for i, r in enumerate(order, start=1) if r["recipe_id"] == recipe_id), 1
    )

    # ── SUROWIEC: przez partie przyprawionego użyte w tej produkcji ──
    seasoned_ids: List[str] = []
    for g in goods:
        for sid in (g.get("source_seasoned_ids") or []):
            if sid and sid not in seasoned_ids:
                seasoned_ids.append(sid)
    sources = _mixing_sources(seasoned_ids)

    raw_rows: List[Dict[str, Any]] = []
    origin_by_batch: Dict[str, str] = {}
    for s in sources:
        lots = s["lots"]
        if not lots:
            continue
        origin = format_origin(lots)
        # Skład zlecenia dotyczy KAŻDEJ partii, która z niego wyszła —
        # przy partii łączonej to jedyna prawdziwa odpowiedź „skąd PP".
        for bno in s["batchNos"]:
            if origin:
                origin_by_batch[bno] = origin
        material = next((l["material"] for l in lots if l["material"]), "")
        raw_rows.append({
            "material": material,
            "kg": _kg(sum(l["kg"] for l in lots)),
            # Jeden wsad → numer w kolumnie; kilka → rozbicie co do kilograma
            "batchNo": lots[0]["raw_no"] if len(lots) == 1 else "",
            "origin": origin,
            "mixingOrderNo": s["mixingOrderNo"],
            "seasonedBatchNos": s["batchNos"],
        })
    raw_total = _kg(sum(r["kg"] for r in raw_rows))

    # ── MASOWANIE I MARYNOWANIE ──
    ingredients = _ingredient_rows(recipe_id, raw_total, day)
    mix_total = _kg(raw_total + sum(i["qty"] for i in ingredients))

    # ── PAKOWANIE I ETYKIETOWANIE ──
    shelf = int((recipe or {}).get("shelf_life_days") or 364)
    # RODZAJ KEBABU: wyroby gotowe nie niosą rodzaju, a receptura ma go pustego —
    # jedyne miejsce z „KEBAB UDO 100%" to pozycja planu produkcji.
    pt = query_one(
        """
        SELECT l.product_type_name
        FROM production_plan_lines l
        JOIN production_plans p ON p.id = l.plan_id
        WHERE p.plan_date = %s AND l.recipe_id = %s
          AND COALESCE(l.product_type_name,'') <> ''
        LIMIT 1
        """,
        (day, recipe_id),
    )
    fallback_type = (
        (pt or {}).get("product_type_name")
        or (recipe or {}).get("name")
        or ""
    )
    grouped: Dict[tuple, Dict[str, Any]] = {}
    for g in goods:
        key = (g.get("product_type_name") or fallback_type, g.get("batch_no") or "")
        row = grouped.setdefault(key, {
            "productType": key[0], "batchNo": key[1],
            "rows": [], "kg": 0.0,
            "producedDate": str(g.get("produced_date") or day),
        })
        row["rows"].append(g)
        row["kg"] = _kg(row["kg"] + _kg(g.get("total_kg")))

    packing = []
    for row in grouped.values():
        # „030826 PP1" → PP1: przy partii łączonej dopisujemy jej skład,
        # żeby kontrola nie musiała zestawiać tego z sekcją surowca.
        short = row["batchNo"].split(" ")[-1] if row["batchNo"] else ""
        packing.append({
            "productType": row["productType"],
            "batchNo": row["batchNo"],
            "packages": format_packages(row["rows"]),
            "frozenAt": row["producedDate"],
            "bestBefore": str(_as_date(row["producedDate"]) + timedelta(days=shelf)),
            "kg": row["kg"],
            "origin": origin_by_batch.get(short, ""),
        })
    packing.sort(key=lambda p: (p["productType"], p["batchNo"]))
    packing_total = _kg(sum(p["kg"] for p in packing))

    packagings = sorted({g.get("packaging_name") or "" for g in goods if g.get("packaging_name")})

    return {
        "cardNo": card_no(str(day), seq),
        "planDate": str(day),
        "recipeId": recipe_id,
        "recipeName": (recipe or {}).get("name") or (goods[0].get("recipe_name") or ""),
        # Nazwy produktów: na razie nazwa receptury — docelowo osobne pole
        # definiowane przy tworzeniu receptury.
        "productNames": (recipe or {}).get("name") or (goods[0].get("recipe_name") or ""),
        "rawMaterials": raw_rows,
        "rawTotalKg": raw_total,
        "ingredients": ingredients,
        "mixTotalKg": mix_total,
        "packagings": packagings,
        "packing": packing,
        "packingTotalKg": packing_total,
    }
