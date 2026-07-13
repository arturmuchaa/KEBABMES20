"""Production plans.

All kg reservations on seasoned_meat happen inside a single transaction
with FOR UPDATE row locks on every touched seasoned_meat row, so a
concurrent plan cannot double-book the same lot.
"""
import json
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import (
    cx_execute,
    cx_execute_returning,
    cx_execute_rowcount,
    cx_query_all,
    cx_query_one,
    query_all,
    query_one,
    transaction,
)
from app.logging_config import get_logger
from app.models.production import PlanLineCreate, ProductionPlanCreate
from app.utils.batch_numbers import production_mixed_batch_no
from app.utils.ids import cuid, next_dated_no, next_seq, now_iso

logger = get_logger(__name__)

# Tolerancja uzgodnienia teoria↔fizyka przy sprawdzaniu braków mięsa
# przyprawionego. kg_produced partii jest WYLICZONE z receptury, więc realnie
# potrafi brakować ~1 kg mimo że fizycznie mięso jest (np. 119 papierowo,
# 120 zważone). Do tego progu plan NIE blokuje — partia schodzi do 0. Większe
# różnice = biuro koryguje partię ręcznie (reconcile_seasoned_batch).
SEASONED_SHORTFALL_TOL_KG = 1.0


def _lock_seasoned_batches(conn, batch_ids: List[str]) -> Dict[str, Dict]:
    """Row-lock every requested seasoned_meat in a deterministic order."""
    locked: Dict[str, Dict] = {}
    for bid in sorted({b for b in batch_ids if b}):
        row = cx_query_one(
            conn,
            "SELECT * FROM seasoned_meat WHERE id=%s FOR UPDATE",
            (bid,),
        )
        if not row:
            raise HTTPException(404, f"Partia zamarynowana nie znaleziona: {bid}")
        locked[bid] = row
    return locked


# Klucz kubełka sztuk MIESZANYCH w batch_allocation. Sztuki składane z
# resztek kilku partii dostają jeden wspólny numer PM{n} — nadawany przy
# aktywacji planu (_assign_pm_numbers), do tego czasu trzymane pod sentinelem.
MIXED_KEY = "__MIXED__"


def _compute_allocation(
    conn, line: PlanLineCreate, line_kg: float, locked: Dict[str, Dict]
) -> tuple[list[str], dict, str | None, str]:
    """Rozbij sztuki linii na partie wsadowe.

    Najpierw CAŁE sztuki mieszczące się w jednej partii (każda sztuka jeden
    numer partii). Sztuki, na które żadna pojedyncza partia już nie ma kg,
    są składane z resztek kilku partii i trafiają do kubełka ``MIXED_KEY``
    z rozbiciem kg per partia w ``parts`` — z nich powstaje partia PM.

    Mutuje ``locked`` (podbija kg_reserved w snapshotcie), żeby kolejne
    linie tego samego planu liczyły się na pomniejszonej puli — DB i tak
    pilnuje tego w _apply_reservations, ale bez aktualizacji snapshotu
    dochodziło do fałszywych 409 przy wielu liniach z tej samej partii.
    """
    all_batch_ids = (
        list(line.seasoned_batch_ids)
        if line.seasoned_batch_ids
        else ([line.seasoned_batch_id] if line.seasoned_batch_id else [])
    )
    all_batch_nos: list[str] = []
    allocation: dict[str, dict] = {}
    primary_batch_id: str | None = all_batch_ids[0] if all_batch_ids else None
    primary_batch_no = ""

    if primary_batch_id:
        sb_row = locked.get(primary_batch_id) or cx_query_one(
            conn,
            "SELECT batch_no FROM seasoned_meat WHERE id=%s",
            (primary_batch_id,),
        )
        if sb_row:
            primary_batch_no = sb_row.get("batch_no") or ""

    if not all_batch_ids:
        return all_batch_nos, allocation, primary_batch_id, primary_batch_no

    # Pula wolnych kg per partia, w kolejności zaznaczenia (FEFO z planowania)
    pool: list[dict] = []
    for bid in all_batch_ids:
        sb_row = locked.get(bid) or cx_query_one(
            conn,
            "SELECT batch_no, kg_available, kg_reserved FROM seasoned_meat WHERE id=%s",
            (bid,),
        )
        if not sb_row:
            continue
        kg_free = max(
            0.0,
            float(sb_row.get("kg_available") or 0)
            - float(sb_row.get("kg_reserved") or 0),
        )
        pool.append({"bid": bid, "b_no": sb_row["batch_no"], "free": kg_free})

    kg_pu = float(line.kg_per_unit or 0)
    remaining_qty = int(line.qty)
    eps = 1e-6
    mixed_pieces = 0
    mixed_parts: dict[str, dict] = {}

    # Partia po partii (kolejność zaznaczenia = FEFO): najpierw całe sztuki
    # z partii, a jej RESZTKĘ od razu zużyj w sztuce mieszanej dopełnionej
    # z kolejnych partii. Dzięki temu resztka starszej partii (np. PP1)
    # jest fizycznie wykorzystana, nawet gdy następna partia sama
    # pokryłaby całą linię — planista dokłada partię właśnie po to.
    for i, b in enumerate(pool):
        # 1) Całe sztuki z tej partii
        if remaining_qty > 0:
            if kg_pu > 0:
                pcs = int(min(remaining_qty, b["free"] // kg_pu))
            else:
                pcs = remaining_qty
            pcs = max(0, min(pcs, remaining_qty))
        else:
            pcs = 0
        if pcs > 0 or b["b_no"] not in allocation:
            all_batch_nos.append(b["b_no"])
            allocation[b["b_no"]] = {
                "pieces": pcs,
                "kg": round(pcs * kg_pu, 3),
                "batch_id": b["bid"],
            }
            b["free"] -= pcs * kg_pu
            remaining_qty -= pcs

        # 2) Resztka tej partii → sztuka mieszana (dopełniona z kolejnych)
        while remaining_qty > 0 and kg_pu > 0 and b["free"] > eps:
            need = kg_pu
            taken: list[tuple[dict, float]] = []
            for b2 in pool[i:]:
                if need <= eps:
                    break
                take = min(need, b2["free"])
                if take <= eps:
                    continue
                taken.append((b2, take))
                need -= take
            if need > eps:
                # Nie da się złożyć całej sztuki — zostaw nieprzydzielone,
                # niedobór złapie walidacja (_check_plan_shortfalls / aktywacja).
                break
            for b2, take in taken:
                b2["free"] -= take
                part = mixed_parts.setdefault(
                    b2["b_no"], {"kg": 0.0, "batch_id": b2["bid"]}
                )
                part["kg"] = round(float(part["kg"]) + take, 3)
            mixed_pieces += 1
            remaining_qty -= 1

    if mixed_pieces > 0:
        allocation[MIXED_KEY] = {
            "pieces": mixed_pieces,
            "kg": round(mixed_pieces * kg_pu, 3),
            "parts": mixed_parts,
        }

    # Zaktualizuj snapshot locked o kg tej linii (kolejne linie planu
    # liczą się już na pomniejszonej puli).
    reserved_now: Dict[str, float] = {}
    for key, alloc in allocation.items():
        if key == MIXED_KEY:
            for p in alloc["parts"].values():
                bid = p.get("batch_id")
                if bid:
                    reserved_now[bid] = reserved_now.get(bid, 0.0) + float(p["kg"])
        else:
            bid = alloc.get("batch_id")
            kg = float(alloc.get("kg") or 0)
            if bid and kg > 0:
                reserved_now[bid] = reserved_now.get(bid, 0.0) + kg
    for bid, kg in reserved_now.items():
        row = locked.get(bid)
        if row is not None:
            row["kg_reserved"] = float(row.get("kg_reserved") or 0) + kg

    return all_batch_nos, allocation, primary_batch_id, primary_batch_no


# ── Kebab komponentowy (np. 70/30): skład produkcyjny z receptury ──────
# Komponent = rodzaj mięsa przyprawionego (material_type) + udział %.
# Sztuka jest składana CELOWO z kilku partii (po jednej na komponent) →
# partia wyrobu = "355/356" (numery partii komponentów po ukośniku).
# Resztkowe sztuki, w których udział komponentu trzeba dosztukować z dwóch
# partii, lądują w kubełku MIXED (numer PM przy aktywacji) — jak dotąd.

def _recipe_components(conn, recipe_id: str) -> list[dict]:
    if not recipe_id:
        return []
    row = cx_query_one(
        conn, "SELECT components FROM recipes WHERE id=%s", (recipe_id,)
    )
    if not row:
        return []
    comps = row.get("components") or []
    if isinstance(comps, str):
        try:
            comps = json.loads(comps)
        except Exception:
            comps = []
    return [
        c for c in comps
        if isinstance(c, dict) and float(c.get("pct") or 0) > 0
    ]


def _product_type_components(conn, product_type_id: str | None) -> list[dict]:
    """Skład produkcyjny z RODZAJU produktu (kanoniczne źródło 70/30).

    Komponent rodzaju = {materialTypeId, name, pct}. Zwraca tylko komponenty
    z dodatnim udziałem i powiązanym material_type — w formacie zgodnym z
    ``_compute_component_allocation`` (klucz ``materialTypeId``)."""
    if not product_type_id:
        return []
    row = cx_query_one(
        conn, "SELECT components FROM product_types WHERE id=%s", (product_type_id,)
    )
    if not row:
        return []
    comps = row.get("components") or []
    if isinstance(comps, str):
        try:
            comps = json.loads(comps)
        except Exception:
            comps = []
    out: list[dict] = []
    for c in comps:
        if not isinstance(c, dict) or float(c.get("pct") or 0) <= 0:
            continue
        mat = c.get("materialTypeId") or c.get("material_type_id") or ""
        if not mat:
            continue
        out.append({
            "materialTypeId": mat,
            "materialName": c.get("name") or c.get("materialName") or "",
            "pct": float(c.get("pct") or 0),
        })
    return out


def _line_components(conn, line: PlanLineCreate) -> list[dict]:
    """Skład produkcyjny linii. Pierwszeństwo ma RODZAJ produktu, gdy ma ≥2
    komponenty z material_type (np. 70/30 udo/filet). W przeciwnym razie
    fallback na komponenty receptury (pełna zgodność wstecz)."""
    pt_comps = _product_type_components(conn, getattr(line, "product_type_id", None))
    if len(pt_comps) >= 2:
        return pt_comps
    return _recipe_components(conn, line.recipe_id)


def _allocate_components(
    qty: int, kg_pu: float, components: list[dict],
    pools: list[list[dict]],
) -> dict:
    """Czysta alokacja sztuk komponentowych.

    ``pools[i]`` = lista partii i-tego komponentu (FEFO):
    ``{"bid", "b_no", "free"}`` — mutowana (free maleje).

    Zwraca allocation: {"355/356": {pieces, kg, parts}, MIXED_KEY: {...}}.
    Sztuki nieprzydzielone (brak kg któregoś komponentu) zostają poza
    alokacją — niedobór łapie walidacja aktywacji.
    """
    eps = 1e-6
    comp_kg = [kg_pu * float(c.get("pct") or 0) / 100.0 for c in components]
    allocation: dict[str, dict] = {}
    mixed_pieces = 0
    mixed_parts: dict[str, dict] = {}

    for _ in range(int(qty)):
        taken_per_comp: list[list[tuple[dict, float]]] = []
        ok = True
        for ci in range(len(components)):
            need = comp_kg[ci]
            taken: list[tuple[dict, float]] = []
            for b in pools[ci]:
                if need <= eps:
                    break
                take = min(need, b["free"])
                if take <= eps:
                    continue
                taken.append((b, take))
                need -= take
            if need > eps:
                ok = False
                break
            taken_per_comp.append(taken)
        if not ok:
            break  # niedobór — reszta sztuk nieprzydzielona

        for taken in taken_per_comp:
            for b, take in taken:
                b["free"] -= take

        boundary = any(len(t) > 1 for t in taken_per_comp)
        if boundary:
            # Udział komponentu dosztukowany z >1 partii → sztuka MIESZANA (PM)
            mixed_pieces += 1
            for taken in taken_per_comp:
                for b, take in taken:
                    p = mixed_parts.setdefault(
                        b["b_no"], {"kg": 0.0, "batch_id": b["bid"]}
                    )
                    p["kg"] = round(float(p["kg"]) + take, 3)
        else:
            label = "/".join(t[0][0]["b_no"] for t in taken_per_comp)
            g = allocation.setdefault(
                label, {"pieces": 0, "kg": 0.0, "parts": {}}
            )
            g["pieces"] += 1
            g["kg"] = round(g["pieces"] * kg_pu, 3)
            for taken in taken_per_comp:
                for b, take in taken:
                    p = g["parts"].setdefault(
                        b["b_no"], {"kg": 0.0, "batch_id": b["bid"]}
                    )
                    p["kg"] = round(float(p["kg"]) + take, 3)

    if mixed_pieces > 0:
        allocation[MIXED_KEY] = {
            "pieces": mixed_pieces,
            "kg": round(mixed_pieces * kg_pu, 3),
            "parts": mixed_parts,
        }
    return allocation


def _compute_component_allocation(
    conn, line: PlanLineCreate, components: list[dict]
) -> tuple[list[str], dict, str | None, str]:
    """Alokacja dla receptury komponentowej — partie wybierane automatycznie
    (FEFO) per rodzaj mięsa, bez ręcznego zaznaczania w planowaniu."""
    kg_pu = float(line.kg_per_unit or 0)
    pools: list[list[dict]] = []
    all_ids: list[str] = []
    rows_by_comp: list[list[str]] = []
    for c in components:
        rows = cx_query_all(
            conn,
            """
            SELECT id FROM seasoned_meat
            WHERE COALESCE(material_type_id,'') = %s
              AND status = 'available'
              AND (kg_available - COALESCE(kg_reserved,0)) > 0.01
            """,
            (c.get("materialTypeId") or "",),
        )
        ids = [r["id"] for r in rows]
        rows_by_comp.append(ids)
        all_ids.extend(ids)

    # Lock deterministycznie (sorted) — potem pule w kolejności FEFO
    locked_rows: Dict[str, Dict] = {}
    for bid in sorted(set(all_ids)):
        r = cx_query_one(
            conn, "SELECT * FROM seasoned_meat WHERE id=%s FOR UPDATE", (bid,)
        )
        if r:
            locked_rows[bid] = r

    for ids in rows_by_comp:
        pool = []
        for bid in ids:
            r = locked_rows.get(bid)
            if not r:
                continue
            free = max(
                0.0,
                float(r.get("kg_available") or 0)
                - float(r.get("kg_reserved") or 0),
            )
            if free <= 0.01:
                continue
            pool.append({
                "bid": bid,
                "b_no": r.get("batch_no") or "",
                "free": free,
                "expiry": str(r.get("expiry_date") or ""),
            })
        pool.sort(key=lambda b: (b["expiry"], b["b_no"]))
        pools.append(pool)

    allocation = _allocate_components(int(line.qty), kg_pu, components, pools)

    # Partie źródłowe (lineage / seasoned_batch_nos)
    src_nos: list[str] = []
    src_ids: list[str] = []
    for alloc in allocation.values():
        for bno, p in (alloc.get("parts") or {}).items():
            if bno not in src_nos:
                src_nos.append(bno)
            if p.get("batch_id") and p["batch_id"] not in src_ids:
                src_ids.append(p["batch_id"])
    primary_id = src_ids[0] if src_ids else None
    primary_no = src_nos[0] if src_nos else ""
    return src_nos, allocation, primary_id, primary_no


def _allocation_kg_per_batch(allocation: dict) -> Dict[str, float]:
    """Sumaryczne kg per batch_id z alokacji — wliczając kubełek sztuk
    mieszanych (MIXED/PM), którego kg siedzą w ``parts``."""
    out: Dict[str, float] = {}
    for key, alloc in (allocation.items() if isinstance(allocation, dict) else []):
        if not isinstance(alloc, dict):
            continue
        parts = alloc.get("parts")
        if isinstance(parts, dict):
            for p in parts.values():
                if not isinstance(p, dict):
                    continue
                bid = p.get("batch_id")
                kg = float(p.get("kg") or 0)
                if bid and kg > 0:
                    out[bid] = out.get(bid, 0.0) + kg
        else:
            bid = alloc.get("batch_id")
            kg = float(alloc.get("kg") or 0)
            if bid and kg > 0:
                out[bid] = out.get(bid, 0.0) + kg
    return out


def _apply_reservations(conn, allocation: dict) -> None:
    """Rezerwuj kg na seasoned_meat poprzez kg_reserved.

    Nie dotyka kg_available ani kg_used. Realna konsumpcja (zdjęcie z
    available + przeniesienie do used) dzieje się dopiero w finish_day
    razem z emisją OUT-movement. Sztuki mieszane (kubełek parts) rezerwują
    faktyczne kg w każdej partii źródłowej.
    """
    for bid, kg in _allocation_kg_per_batch(allocation).items():
        rowcount = cx_execute_rowcount(
            conn,
            """
            UPDATE seasoned_meat
            SET kg_reserved = COALESCE(kg_reserved, 0) + %s
            WHERE id = %s
              AND (kg_available - COALESCE(kg_reserved, 0)) >= %s
            """,
            (kg, bid, kg),
        )
        if rowcount == 0:
            raise HTTPException(
                409,
                f"Konflikt rezerwacji — partia {bid} nie ma już wymaganych kg "
                f"(równoczesna modyfikacja). Spróbuj ponownie.",
            )


def _check_plan_shortfalls(
    conn, valid_lines: List[PlanLineCreate], locked: Dict[str, Dict]
) -> List[str]:
    """Sekwencyjnie symulujemy alokację mięsa między liniami planu.
    Zwraca listę komunikatów o niedoborach (puste = OK).

    Linie bez przydzielonych partii pomijamy — są dozwolone w szkicach;
    aktywacja planu (update_plan_status='active') zablokuje je później.

    Wolne kg = kg_available - kg_reserved (rezerwacje innych aktywnych
    planów są odejmowane razem z naszymi nowymi liniami w trakcie symulacji).
    """
    remaining: Dict[str, float] = {
        bid: max(
            0.0,
            float(row.get("kg_available") or 0) - float(row.get("kg_reserved") or 0),
        )
        for bid, row in locked.items()
    }
    shortfalls: List[str] = []
    for line in valid_lines:
        line_kg = round(line.qty * line.kg_per_unit, 3)
        if line_kg <= 0:
            continue
        ids = (
            list(line.seasoned_batch_ids)
            if line.seasoned_batch_ids
            else ([line.seasoned_batch_id] if line.seasoned_batch_id else [])
        )
        ids = [b for b in ids if b]
        if not ids:
            continue
        still_needed = line_kg
        allocated = 0.0
        for bid in ids:
            if still_needed <= 0:
                break
            free = remaining.get(bid, 0.0)
            if free <= 0:
                continue
            take = min(still_needed, free)
            allocated += take
            remaining[bid] = free - take
            still_needed -= take
        if allocated < line_kg - SEASONED_SHORTFALL_TOL_KG:
            recipe_name, _, _ = _resolve_line_names(conn, line)
            recipe_name = recipe_name or line.recipe_id or "pozycja"
            shortage = round(line_kg - allocated, 3)
            shortfalls.append(
                f'"{recipe_name}": potrzeba {line_kg:.0f} kg, '
                f"dostępne {allocated:.0f} kg — brakuje {shortage:.0f} kg"
            )
    return shortfalls


def validate_plan_edit(existing: list[dict], incoming: list[dict]) -> list[str]:
    """Reguły nietykalności wyprodukowanych pozycji przy edycji planu.

    Pozycja z qty_done>0 (część spakowana): nie można jej usunąć z planu,
    zejść qty poniżej qty_done, ani zmienić receptury. Pozycje bez produkcji
    (qty_done=0) są w pełni edytowalne/usuwalne. Nowe pozycje (id puste)
    zawsze OK. Czysta funkcja — bez DB.

    ``existing``: [{id, qty_done, recipe_id}] (żywy stan z bazy).
    ``incoming``: [{id, qty, recipe_id}] (payload edycji; id puste = nowa).
    """
    incoming_by_id = {str(l.get("id") or ""): l for l in incoming if l.get("id")}
    errors: list[str] = []
    for ex in existing:
        qd = int(ex.get("qty_done") or 0)
        if qd <= 0:
            continue
        lid = str(ex.get("id") or "")
        nl = incoming_by_id.get(lid)
        if nl is None:
            errors.append(
                f"Pozycja częściowo/w całości wyprodukowana ({qd} szt.) — "
                f"nie można jej usunąć z planu."
            )
            continue
        if int(nl.get("qty") or 0) < qd:
            errors.append(
                f"Nie można zejść z ilości poniżej już wyprodukowanych {qd} szt."
            )
        if str(nl.get("recipe_id") or "") != str(ex.get("recipe_id") or ""):
            errors.append(
                "Nie można zmienić receptury pozycji, która jest już "
                "częściowo wyprodukowana."
            )
    return errors


def _restore_reservations(conn, plan_id: str) -> None:
    old_lines = cx_query_all(
        conn, "SELECT * FROM production_plan_lines WHERE plan_id=%s", (plan_id,)
    )
    per_line_kg: list[Dict[str, float]] = []
    touched_ids: set[str] = set()
    for old in old_lines:
        ba = old.get("batch_allocation") or {}
        if isinstance(ba, str):
            try:
                ba = json.loads(ba)
            except Exception:
                ba = {}
        kg_map = _allocation_kg_per_batch(ba if isinstance(ba, dict) else {})
        per_line_kg.append(kg_map)
        touched_ids.update(kg_map.keys())
    # Lock all touched rows in deterministic order first
    for bid in sorted(touched_ids):
        cx_query_one(
            conn, "SELECT id FROM seasoned_meat WHERE id=%s FOR UPDATE", (bid,)
        )
    for kg_map in per_line_kg:
        for bid, kg_back in kg_map.items():
            if kg_back > 0:
                # Plan był rezerwacją — zwracamy kg_reserved bez ruszania
                # kg_available/kg_used (konsumpcja dzieje się dopiero w
                # finish_day).
                cx_execute(
                    conn,
                    """
                    UPDATE seasoned_meat
                    SET kg_reserved = GREATEST(0, COALESCE(kg_reserved, 0) - %s)
                    WHERE id = %s
                    """,
                    (kg_back, bid),
                )


def list_plans() -> List[Dict]:
    plans = query_all("SELECT * FROM production_plans ORDER BY created_at DESC")
    for p in plans:
        p["lines"] = query_all(
            "SELECT * FROM production_plan_lines WHERE plan_id = %s", (p["id"],)
        )
    return plans


def _insert_line(
    conn,
    plan_id: str,
    line: PlanLineCreate,
    line_kg: float,
    recipe_name: str,
    product_type_name: str,
    packaging_name: str,
    primary_batch_id: str | None,
    primary_batch_no: str,
    all_batch_nos: list[str],
    allocation: dict,
) -> None:
    cx_execute(
        conn,
        """
        INSERT INTO production_plan_lines
            (id, plan_id, qty, kg_per_unit, total_kg,
             product_type_id, product_type_name, recipe_id, recipe_name,
             packaging_id, packaging_name, seasoned_batch_id, seasoned_batch_no,
             seasoned_batch_nos, batch_allocation,
             client_order_id, client_order_no, client_order_line_id, client_name,
             kg_assigned, status)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s,%s)
        """,
        (
            # Zachowaj id pozycji z DTO (edycja planu — dopasowanie i qty_done);
            # brak = nowa pozycja → nowy cuid.
            str(getattr(line, "id", "") or "") or cuid(),
            plan_id,
            line.qty,
            line.kg_per_unit,
            line_kg,
            line.product_type_id or None,
            product_type_name or None,
            line.recipe_id,
            recipe_name,
            line.packaging_id or None,
            packaging_name or None,
            primary_batch_id,
            primary_batch_no or None,
            all_batch_nos,
            json.dumps(allocation),
            line.client_order_id or None,
            line.client_order_no or None,
            line.client_order_line_id or None,
            line.client_name or None,
            line_kg if primary_batch_id else 0,
            "assigned" if primary_batch_id else "pending",
        ),
    )


def _resolve_line_names(conn, line: PlanLineCreate) -> tuple[str, str, str]:
    recipe_name = line.recipe_name
    product_type_name = line.product_type_name
    packaging_name = line.packaging_name
    if not recipe_name and line.recipe_id:
        r = cx_query_one(
            conn,
            "SELECT name, product_type_name FROM recipes WHERE id=%s",
            (line.recipe_id,),
        )
        if r:
            recipe_name = r["name"] or ""
            if not product_type_name:
                product_type_name = r.get("product_type_name") or ""
    if not packaging_name and line.packaging_id:
        pkg = cx_query_one(
            conn, "SELECT name FROM packaging WHERE id=%s", (line.packaging_id,)
        )
        if pkg:
            packaging_name = pkg["name"] or ""
    return recipe_name, product_type_name, packaging_name


def create_plan(dto: ProductionPlanCreate) -> Dict:
    if not dto.plan_date:
        raise HTTPException(400, "Brak daty planu (planDate)")
    valid_lines = [
        l for l in dto.lines if l.recipe_id and l.qty > 0 and l.kg_per_unit > 0
    ]
    if not valid_lines:
        raise HTTPException(400, "Brak poprawnych pozycji")

    total_kg = sum(l.qty * l.kg_per_unit for l in valid_lines)
    total_units = sum(l.qty for l in valid_lines)

    with transaction() as conn:
        # Lock every seasoned_meat row required by the plan up-front,
        # in deterministic order, to avoid deadlocks between concurrent
        # plan creates.
        all_ids = {
            bid
            for line in valid_lines
            for bid in (
                line.seasoned_batch_ids
                or ([line.seasoned_batch_id] if line.seasoned_batch_id else [])
            )
            if bid
        }
        locked = _lock_seasoned_batches(conn, sorted(all_ids))

        # Walidacja: czy zaznaczone partie mają wystarczająco kg na wszystkie linie?
        # Jeśli nie — rzuć 400 PRZED nadaniem numeru planu i utworzeniem rekordu.
        shortfalls = _check_plan_shortfalls(conn, valid_lines, locked)
        if shortfalls:
            raise HTTPException(
                400,
                "Niewystarczająca ilość mięsa — plan nie został utworzony:\n"
                + "\n".join("• " + s for s in shortfalls),
            )

        # Spójna numeracja procesu: ROZ/dd/mm/rr (rozbiór), MAS/… (masowanie),
        # PROD/… (produkcja). Stare plany zostają z prefiksem PP.
        plan_no = next_dated_no(conn, "PROD", dto.plan_date)

        plan = cx_execute_returning(
            conn,
            """
            INSERT INTO production_plans
                (id, plan_no, plan_date, total_kg, total_units,
                 status, notes, created_at)
            VALUES (%s,%s,%s,%s,%s,'draft',%s,%s)
            RETURNING *
            """,
            (
                cuid(),
                plan_no,
                dto.plan_date,
                round(total_kg, 3),
                total_units,
                dto.notes or None,
                now_iso(),
            ),
        )
        assert plan is not None

        for line in valid_lines:
            line_kg = round(line.qty * line.kg_per_unit, 3)
            recipe_name, product_type_name, packaging_name = _resolve_line_names(
                conn, line
            )
            comps = _line_components(conn, line)
            if comps:
                # Receptura komponentowa (np. 70/30) — partie per komponent
                # dobierane automatycznie FEFO po rodzaju mięsa
                nos, allocation, primary_id, primary_no = (
                    _compute_component_allocation(conn, line, comps)
                )
            else:
                nos, allocation, primary_id, primary_no = _compute_allocation(
                    conn, line, line_kg, locked
                )
            _insert_line(
                conn,
                plan["id"],
                line,
                line_kg,
                recipe_name,
                product_type_name,
                packaging_name,
                primary_id,
                primary_no,
                nos,
                allocation,
            )
            _apply_reservations(conn, allocation)

        plan["lines"] = cx_query_all(
            conn,
            "SELECT * FROM production_plan_lines WHERE plan_id = %s",
            (plan["id"],),
        )
    logger.info("plan.created", extra={"plan_id": plan["id"], "total_kg": total_kg})
    return plan


def update_plan(plan_id: str, dto: ProductionPlanCreate) -> Dict:
    valid_lines = [
        l for l in dto.lines if l.recipe_id and l.qty > 0 and l.kg_per_unit > 0
    ]
    total_kg = sum(l.qty * l.kg_per_unit for l in valid_lines)
    total_units = sum(l.qty for l in valid_lines)

    with transaction() as conn:
        plan = cx_query_one(
            conn, "SELECT * FROM production_plans WHERE id=%s FOR UPDATE", (plan_id,)
        )
        if not plan:
            raise HTTPException(404, "Plan nie znaleziony")
        if plan["status"] not in ("draft", "active"):
            raise HTTPException(
                400, "Edytować można tylko plan w statusie Szkic lub Aktywny."
            )

        # Żywy stan pozycji (FOR UPDATE) — blokady liczymy od realnego qty_done,
        # nie z payloadu (tablet mógł spakować więcej między załadowaniem a zapisem).
        old_lines = cx_query_all(
            conn,
            "SELECT id, qty_done, recipe_id, worker_entries, line_status "
            "FROM production_plan_lines WHERE plan_id=%s FOR UPDATE",
            (plan_id,),
        )
        old_by_id = {r["id"]: r for r in old_lines}
        edit_errs = validate_plan_edit(
            [dict(r) for r in old_lines],
            [{"id": l.id, "qty": l.qty, "recipe_id": l.recipe_id} for l in valid_lines],
        )
        if edit_errs:
            raise HTTPException(
                400, "Nie można zapisać zmian:\n• " + "\n• ".join(edit_errs)
            )

        _restore_reservations(conn, plan_id)
        cx_execute(
            conn, "DELETE FROM production_plan_lines WHERE plan_id=%s", (plan_id,)
        )

        cx_execute(
            conn,
            """
            UPDATE production_plans
            SET plan_date=%s, total_kg=%s, total_units=%s, notes=%s
            WHERE id=%s
            """,
            (dto.plan_date, round(total_kg, 3), total_units, dto.notes or None, plan_id),
        )

        new_ids = {
            bid
            for line in valid_lines
            for bid in (
                line.seasoned_batch_ids
                or ([line.seasoned_batch_id] if line.seasoned_batch_id else [])
            )
            if bid
        }
        locked = _lock_seasoned_batches(conn, sorted(new_ids))

        # Walidacja: czy zaznaczone partie mają wystarczająco kg?
        shortfalls = _check_plan_shortfalls(conn, valid_lines, locked)
        if shortfalls:
            raise HTTPException(
                400,
                "Niewystarczająca ilość mięsa — plan nie został zaktualizowany:\n"
                + "\n".join("• " + s for s in shortfalls),
            )

        for line in valid_lines:
            line_kg = round(line.qty * line.kg_per_unit, 3)
            recipe_name, product_type_name, packaging_name = _resolve_line_names(
                conn, line
            )
            comps = _line_components(conn, line)
            if comps:
                nos, allocation, primary_id, primary_no = (
                    _compute_component_allocation(conn, line, comps)
                )
            else:
                nos, allocation, primary_id, primary_no = _compute_allocation(
                    conn, line, line_kg, locked
                )
            _insert_line(
                conn,
                plan_id,
                line,
                line_kg,
                recipe_name,
                product_type_name,
                packaging_name,
                primary_id,
                primary_no,
                nos,
                allocation,
            )
            _apply_reservations(conn, allocation)

        # Przywróć postęp produkcji dla pozycji dopasowanych po id (edycja
        # aktywnego planu nie może zgubić już spakowanych sztuk).
        for line in valid_lines:
            lid = str(line.id or "")
            old = old_by_id.get(lid)
            if not old:
                continue
            qd = int(old.get("qty_done") or 0)
            if qd <= 0:
                continue
            new_qty = int(line.qty or 0)
            ls = "done" if (new_qty > 0 and qd >= new_qty) else "in_progress"
            we = old.get("worker_entries")
            we_json = we if isinstance(we, str) else json.dumps(we or [])
            cx_execute(
                conn,
                "UPDATE production_plan_lines SET qty_done=%s, worker_entries=%s::jsonb, "
                "line_status=%s WHERE id=%s",
                (qd, we_json, ls, lid),
            )

        updated = cx_query_one(
            conn, "SELECT * FROM production_plans WHERE id=%s", (plan_id,)
        )
        assert updated is not None
        updated["lines"] = cx_query_all(
            conn,
            "SELECT * FROM production_plan_lines WHERE plan_id=%s",
            (plan_id,),
        )
    logger.info("plan.updated", extra={"plan_id": plan_id})
    return updated


def ensure_pm_assigned(conn, line_row: Dict) -> dict:
    """Zwróć batch_allocation linii z realnym numerem PM zamiast sentinela
    MIXED_KEY (jeśli trzeba — nadaje numer i zapisuje linię).

    Wołane przy aktywacji planu (wtedy etykiety i magazyn widzą już PM)
    oraz defensywnie z finished_units / finish_day, na wypadek linii
    aktywowanych starszym kodem.
    """
    ba = line_row.get("batch_allocation") or {}
    if isinstance(ba, str):
        try:
            ba = json.loads(ba)
        except Exception:
            ba = {}
    if not isinstance(ba, dict):
        return {}
    if MIXED_KEY not in ba:
        return ba
    pm_no = production_mixed_batch_no(next_seq("pm_seq"))
    ba[pm_no] = ba.pop(MIXED_KEY)
    cx_execute(
        conn,
        "UPDATE production_plan_lines SET batch_allocation=%s WHERE id=%s",
        (json.dumps(ba), line_row["id"]),
    )
    logger.info(
        "plan.pm_assigned",
        extra={"plan_line_id": line_row.get("id"), "pm_no": pm_no},
    )
    return ba


def _assign_pm_numbers(conn, plan_id: str) -> None:
    """Nadaj numery PM wszystkim liniom planu z kubełkiem sztuk mieszanych."""
    lines = cx_query_all(
        conn,
        "SELECT id, batch_allocation FROM production_plan_lines WHERE plan_id=%s",
        (plan_id,),
    )
    for ln in lines:
        ensure_pm_assigned(conn, ln)


def update_plan_status(plan_id: str, status: str) -> Dict[str, bool]:
    with transaction() as conn:
        if status == "active":
            lines = cx_query_all(
                conn,
                "SELECT * FROM production_plan_lines WHERE plan_id = %s",
                (plan_id,),
            )
            errors = []
            for line in lines:
                total_kg = float(line.get("total_kg") or 0)
                if total_kg <= 0:
                    continue
                ba = line.get("batch_allocation") or {}
                if isinstance(ba, str):
                    try:
                        ba = json.loads(ba)
                    except Exception:
                        ba = {}
                allocated_kg = (
                    sum(float(v.get("kg", 0) or 0) for v in ba.values())
                    if isinstance(ba, dict)
                    else 0
                )
                if allocated_kg < total_kg - SEASONED_SHORTFALL_TOL_KG:
                    name = (
                        line.get("recipe_name")
                        or line.get("product_type_name")
                        or "pozycja"
                    )
                    shortfall = round(total_kg - allocated_kg, 3)
                    errors.append(f'"{name}" brakuje {shortfall} kg mięsa')
            if errors:
                raise HTTPException(
                    400,
                    "Niewystarczająca ilość mięsa — dostosuj plan przed aktywacją:\n"
                    + "; ".join(errors),
                )
            # Sztuki mieszane dostają realny numer PM dopiero teraz —
            # od aktywacji etykiety i magazyn widzą ten sam numer.
            _assign_pm_numbers(conn, plan_id)
        # Zamknięcie planu (done/cancelled/draft) musi zwolnić rezerwacje
        # na seasoned_meat. finish_day robi to samodzielnie; ale gdy biuro
        # ręcznie ustawi status na 'done' / 'cancelled' / cofnie do 'draft',
        # rezerwacje muszą wrócić do puli.
        if status in ("done", "cancelled", "draft"):
            _restore_reservations(conn, plan_id)
        cx_execute(
            conn,
            "UPDATE production_plans SET status=%s WHERE id=%s",
            (status, plan_id),
        )
    logger.info("plan.status_updated", extra={"plan_id": plan_id, "status": status})
    return {"ok": True}


def update_line_progress(
    plan_id: str,
    line_id: str,
    qty_done: int,
    line_status: str,
    worker_entries: list[dict],
) -> Dict:
    """Zapisz postęp linii produkcji — wywoływane z tabletu po każdym wpisie."""
    line = query_one(
        "SELECT id, plan_id, qty FROM production_plan_lines WHERE id=%s AND plan_id=%s",
        (line_id, plan_id),
    )
    if not line:
        raise HTTPException(404, "Linia planu nie znaleziona")

    max_qty = int(line["qty"] or 0)
    qty_done = max(0, min(int(qty_done or 0), max_qty))
    status = (line_status or "PLANNED").upper()
    if status not in ("PLANNED", "IN_PROGRESS", "DONE"):
        status = "PLANNED"
    # Dopasuj status do qty_done (samo-korygujący)
    if qty_done >= max_qty and max_qty > 0:
        status = "DONE"
    elif qty_done > 0:
        status = "IN_PROGRESS"
    else:
        status = "PLANNED"

    with transaction() as conn:
        cx_execute(
            conn,
            """
            UPDATE production_plan_lines
            SET qty_done = %s,
                line_status = %s,
                worker_entries = %s::jsonb,
                progress_updated_at = now()
            WHERE id = %s
            """,
            (qty_done, status, json.dumps(worker_entries or []), line_id),
        )
    logger.info(
        "plan.line_progress",
        extra={"plan_id": plan_id, "line_id": line_id, "qty_done": qty_done, "status": status},
    )
    return {
        "ok": True,
        "line_id": line_id,
        "qty_done": qty_done,
        "line_status": status,
    }


def tablet_finish(plan_id: str, entries: list[dict]) -> Dict[str, Any]:
    """Tablet zakończył produkcję — wpisuje pending entries i stempluje czas.

    Nie tworzy finished_goods, nie zwalnia rezerwacji, nie zmienia statusu
    planu. Biuro musi zatwierdzić: POST /office-confirm wywoła finish_day
    z entries z tablet_pending_entries.
    """
    with transaction() as conn:
        plan = cx_query_one(
            conn,
            "SELECT id, status, office_confirmed_at FROM production_plans "
            "WHERE id=%s FOR UPDATE",
            (plan_id,),
        )
        if not plan:
            raise HTTPException(404, "Plan nie znaleziony")
        if plan.get("status") == "done" or plan.get("office_confirmed_at"):
            raise HTTPException(400, "Plan już potwierdzony przez biuro")
        cx_execute(
            conn,
            """
            UPDATE production_plans
            SET tablet_finished_at = now(),
                tablet_pending_entries = %s::jsonb
            WHERE id = %s
            """,
            (json.dumps(entries or []), plan_id),
        )
    logger.info(
        "plan.tablet_finished",
        extra={"plan_id": plan_id, "entries": len(entries or [])},
    )
    return {"ok": True, "plan_id": plan_id, "pending_entries": len(entries or [])}


def tablet_reopen(plan_id: str) -> Dict[str, Any]:
    """Cofa stan 'tablet zakończył' — operator chce dodać jeszcze wpisy.

    Dozwolone tylko gdy biuro jeszcze nie potwierdziło.
    """
    with transaction() as conn:
        plan = cx_query_one(
            conn,
            "SELECT id, office_confirmed_at FROM production_plans "
            "WHERE id=%s FOR UPDATE",
            (plan_id,),
        )
        if not plan:
            raise HTTPException(404, "Plan nie znaleziony")
        if plan.get("office_confirmed_at"):
            raise HTTPException(400, "Plan już potwierdzony przez biuro — nie można cofnąć")
        cx_execute(
            conn,
            """
            UPDATE production_plans
            SET tablet_finished_at = NULL,
                tablet_pending_entries = NULL
            WHERE id = %s
            """,
            (plan_id,),
        )
    logger.info("plan.tablet_reopened", extra={"plan_id": plan_id})
    return {"ok": True, "plan_id": plan_id}


def office_confirm(plan_id: str) -> Dict[str, Any]:
    """Biuro potwierdza zakończenie planu — uruchamia finish_day.

    Czyta tablet_pending_entries, składa FinishDayDto i wywołuje
    finish_day (która stworzy finished_goods, zwolni rezerwacje
    i ustawi status='done'). Następnie stempluje office_confirmed_at
    i czyści pending entries.
    """
    from app.models.production import FinishDayDto, FinishDayEntry
    from app.services.finished_goods_service import finish_day

    plan = query_one(
        "SELECT id, status, tablet_pending_entries, tablet_finished_at, office_confirmed_at "
        "FROM production_plans WHERE id=%s",
        (plan_id,),
    )
    if not plan:
        raise HTTPException(404, "Plan nie znaleziony")
    if plan.get("office_confirmed_at") or plan.get("status") == "done":
        raise HTTPException(400, "Plan już potwierdzony")
    if not plan.get("tablet_finished_at"):
        raise HTTPException(400, "Tablet jeszcze nie zakończył produkcji")

    raw = plan.get("tablet_pending_entries") or []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            raw = []
    if not isinstance(raw, list) or not raw:
        raise HTTPException(400, "Brak wpisów do zatwierdzenia — operator nie wprowadził produkcji")

    entries: list[FinishDayEntry] = []
    for e in raw:
        try:
            entries.append(FinishDayEntry(**e))
        except Exception as exc:
            raise HTTPException(
                400, f"Niepoprawny wpis z tabletu: {exc}"
            ) from exc

    dto = FinishDayDto(plan_id=plan_id, entries=entries)
    result = finish_day(dto)

    # finish_day już ustawił status='done'. Dopisz znacznik biura
    # i wyczyść tablet_pending_entries.
    with transaction() as conn:
        cx_execute(
            conn,
            """
            UPDATE production_plans
            SET office_confirmed_at = now(),
                tablet_pending_entries = NULL
            WHERE id = %s
            """,
            (plan_id,),
        )
    logger.info(
        "plan.office_confirmed",
        extra={"plan_id": plan_id, "items_created": result.get("created", 0)},
    )
    return {"ok": True, "plan_id": plan_id, **result}
