"""finished_units — generacja z planu, skan produkcyjny, lookup."""
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso
from app.utils.unit_codes import next_produced_status, parse_unit_qr, unit_qr

logger = get_logger(__name__)


def batch_sequence(qty, batch_allocation, seasoned_batch_no=None,
                   seasoned_batch_nos=None) -> List[str]:
    """Numer partii dla każdej z `qty` sztuk, wg `batch_allocation` (rozbicie
    partii ustawione w planowaniu, np. 6 z 346 + 18 z 347).

    Gdy alokacja sumuje się do qty — rozdaj partie per sztuka. W innym wypadku
    (brak alokacji / niezgodna suma) cała linia idzie na jedną partię
    (`seasoned_batch_no`, a w razie braku pierwszy z `seasoned_batch_nos`).
    Spójne z HDI (`hdi_service.units_from_plan_lines`).
    """
    qty = int(qty or 0)
    ba = batch_allocation if isinstance(batch_allocation, dict) else {}
    alloc = {bno: int((info or {}).get("pieces") or 0) for bno, info in ba.items()}
    seq: List[str] = []
    if alloc and sum(alloc.values()) == qty:
        for bno, pieces in alloc.items():
            seq.extend([bno] * int(pieces))
        return seq
    sbn = seasoned_batch_no or ""
    if not sbn and seasoned_batch_nos:
        sbn = seasoned_batch_nos[0] if seasoned_batch_nos else ""
    return [sbn or ""] * qty


def resolve_unit_goods_id(unit_batch_no, candidates) -> "str | None":
    """Twardy link sztuka → wyrób gotowy (finished_goods.id).

    `candidates` to wiersze z junction `finished_goods_sessions` (przez
    plan_line_id sztuki), każdy: ``{"goods_id", "seasoned_batch_nos"}``.

    Zasada: NIGDY nie zgaduj.
      * 0 kandydatów → None (linia bez finished_goods — dzień niezamknięty)
      * dokładnie 1 wyrób → przypisz (nawet gdy batch_no nie pasuje)
      * >1 wyrobów → dezambiguuj po batch_no ∈ seasoned_batch_nos;
        jednoznaczne dopasowanie → przypisz, w przeciwnym razie None
        (sierota do ręcznej decyzji — błędny link gorszy niż brak).
    """
    ids = list({c.get("goods_id") for c in (candidates or []) if c.get("goods_id")})
    if not ids:
        return None
    if len(ids) == 1:
        return ids[0]
    bn = (unit_batch_no or "").strip()
    if not bn:
        return None
    matches = {
        c.get("goods_id")
        for c in candidates
        if c.get("goods_id") and bn in (c.get("seasoned_batch_nos") or [])
    }
    return next(iter(matches)) if len(matches) == 1 else None


def _goods_candidates(conn, plan_line_id: str) -> List[Dict[str, Any]]:
    """Wyroby gotowe powiązane z daną linią planu przez junction."""
    if not plan_line_id:
        return []
    return cx_query_all(
        conn,
        """
        SELECT fgs.goods_id, fg.seasoned_batch_nos
        FROM finished_goods_sessions fgs
        JOIN finished_goods fg ON fg.id = fgs.goods_id
        WHERE fgs.plan_line_id = %s
        """,
        (plan_line_id,),
    )


def link_units_for_plan_line(conn, plan_line_id: str) -> int:
    """Ustaw source_finished_goods_id dla sztuk jednej linii planu (w trwającej tx).

    Wywoływane przy finish_day (gdy powstaje finished_goods) oraz w backfillu.
    Zwraca liczbę zaktualizowanych sztuk.
    """
    if not plan_line_id:
        return 0
    candidates = _goods_candidates(conn, plan_line_id)
    if not candidates:
        return 0
    units = cx_query_all(
        conn,
        "SELECT id, batch_no, source_finished_goods_id FROM finished_units WHERE plan_line_id=%s",
        (plan_line_id,),
    )
    updated = 0
    for u in units:
        gid = resolve_unit_goods_id(u.get("batch_no"), candidates)
        if gid and gid != u.get("source_finished_goods_id"):
            cx_execute(
                conn,
                "UPDATE finished_units SET source_finished_goods_id=%s WHERE id=%s",
                (gid, u["id"]),
            )
            updated += 1
    return updated


def backfill_unit_goods_links() -> Dict[str, int]:
    """Migracja danych: podłącz istniejące sztuki do wyrobów gotowych.

    Idempotentne — pomija sztuki już podłączone. Sztuki, których linia planu
    nie ma jeszcze finished_goods (dzień niezamknięty) zostają NULL — to stan
    oczekujący, NIE sierota. Zwraca statystyki.
    """
    with transaction() as conn:
        plan_lines = cx_query_all(
            conn,
            """
            SELECT DISTINCT plan_line_id
            FROM finished_units
            WHERE plan_line_id IS NOT NULL AND plan_line_id <> ''
              AND source_finished_goods_id IS NULL
            """,
        )
        linked = 0
        for row in plan_lines:
            linked += link_units_for_plan_line(conn, row["plan_line_id"])
    logger.info("finished_units.backfill_goods_links", extra={"linked": linked})
    return {"linked": linked, "plan_lines_checked": len(plan_lines)}


def generate_units_from_plan_line(plan_line_id: str) -> Dict[str, Any]:
    """Tworzy `qty` rekordów finished_units (status 'planned') dla linii planu.

    Idempotentne per linia: jeśli sztuki już istnieją, zwraca istniejące.
    """
    with transaction() as conn:
        line = cx_query_one(
            conn,
            "SELECT * FROM production_plan_lines WHERE id=%s",
            (plan_line_id,),
        )
        if not line:
            raise HTTPException(404, "Linia planu nie znaleziona")

        existing = cx_query_all(
            conn,
            "SELECT id, qr_seq, status, batch_no FROM finished_units WHERE plan_line_id=%s ORDER BY qr_seq",
            (plan_line_id,),
        )
        if existing:
            # Sztuki już istnieją. Jeśli wszystkie są jeszcze 'planned' (nie
            # wyprodukowane/zeskanowane), zsynchronizuj numery partii z aktualnym
            # rozbiciem (batch_allocation) — naprawia wcześniejsze błędne etykiety,
            # gdzie wszystko szło na jedną partię. Wyprodukowanych NIE ruszamy.
            resynced = 0
            if all((u.get("status") == "planned") for u in existing):
                seq = batch_sequence(
                    len(existing),
                    line.get("batch_allocation"),
                    line.get("seasoned_batch_no"),
                    line.get("seasoned_batch_nos"),
                )
                for u in existing:
                    idx = int(u.get("qr_seq") or 0) - 1
                    want = seq[idx] if 0 <= idx < len(seq) else (seq[-1] if seq else "")
                    if want and want != (u.get("batch_no") or ""):
                        cx_execute(conn, "UPDATE finished_units SET batch_no=%s WHERE id=%s",
                                   (want, u["id"]))
                        resynced += 1
                if resynced:
                    logger.info("finished_units.batch_resynced",
                                extra={"plan_line_id": plan_line_id, "resynced_count": resynced})
            return {"planLineId": plan_line_id, "created": 0,
                    "existing": len(existing), "resynced": resynced}

        qty = int(line.get("qty") or 0)
        if qty <= 0:
            raise HTTPException(400, "Linia planu ma qty <= 0")

        # Numer partii per sztuka wg rozbicia z planowania (batch_allocation).
        seq = batch_sequence(
            qty,
            line.get("batch_allocation"),
            line.get("seasoned_batch_no"),
            line.get("seasoned_batch_nos"),
        )
        created = 0
        for i in range(qty):
            uid = cuid()
            batch_no = seq[i] if i < len(seq) else (seq[-1] if seq else "")
            cx_execute(
                conn,
                """
                INSERT INTO finished_units
                    (id, qr_code, qr_seq, plan_line_id, order_id, client_name,
                     product_type_id, recipe_id, tuleja, weight_kg, batch_no,
                     produced_date, status, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'planned',%s)
                """,
                (
                    uid,
                    unit_qr(uid),
                    i + 1,
                    plan_line_id,
                    line.get("client_order_id"),
                    line.get("client_name") or "",
                    line.get("product_type_id") or "",
                    line.get("recipe_id") or "",
                    line.get("tuleja") or "",
                    float(line.get("kg_per_unit") or 0),
                    batch_no,
                    line.get("produced_date") or "",
                    now_iso(),
                ),
            )
            created += 1

        logger.info("finished_units.generated", extra={"plan_line_id": plan_line_id, "created_count": created})
        return {"planLineId": plan_line_id, "created": created, "existing": 0}


def list_units_by_plan_line(plan_line_id: str) -> List[Dict[str, Any]]:
    """Lista sztuk danej linii planu (do druku etykiet)."""
    rows = query_all(
        "SELECT * FROM finished_units WHERE plan_line_id=%s ORDER BY qr_seq",
        (plan_line_id,),
    )
    return [
        {
            "id": r["id"], "qrCode": r["qr_code"], "status": r["status"],
            "clientName": r.get("client_name") or "", "recipeId": r.get("recipe_id") or "",
            "productTypeId": r.get("product_type_id") or "", "tuleja": r.get("tuleja") or "",
            "weightKg": float(r.get("weight_kg") or 0), "batchNo": r.get("batch_no") or "",
            "producedDate": r.get("produced_date") or "",
        }
        for r in rows
    ]


def scan_produced(code: str, trolley_id: str | None = None) -> Dict[str, Any]:
    """Skan produkcyjny: planned → produced (+ wózek). Dubel → 409."""
    unit_id = parse_unit_qr(code)
    if not unit_id:
        raise HTTPException(400, "Nieprawidłowy kod QR sztuki")

    with transaction() as conn:
        unit = cx_query_one(
            conn, "SELECT * FROM finished_units WHERE id=%s FOR UPDATE", (unit_id,)
        )
        if not unit:
            raise HTTPException(404, "Sztuka nie znaleziona")
        try:
            new_status = next_produced_status(unit["status"])
        except ValueError as exc:
            raise HTTPException(409, str(exc))

        cx_execute(
            conn,
            """
            UPDATE finished_units
            SET status=%s, produced_at=now(), trolley_id=%s
            WHERE id=%s
            """,
            (new_status, trolley_id, unit_id),
        )

        counts = cx_query_one(
            conn,
            """
            SELECT count(*) FILTER (WHERE status <> 'planned') AS done,
                   count(*) AS total
            FROM finished_units WHERE plan_line_id=%s
            """,
            (unit.get("plan_line_id"),),
        )
        return {
            "ok": True,
            "unitId": unit_id,
            "status": new_status,
            "clientName": unit.get("client_name") or "",
            "batchNo": unit.get("batch_no") or "",
            "weightKg": float(unit.get("weight_kg") or 0),
            "done": int((counts or {}).get("done") or 0),
            "total": int((counts or {}).get("total") or 0),
        }


def lookup_unit(code: str) -> Dict[str, Any]:
    """Pełna karta sztuki po QR (identyfikacja w dowolnym momencie)."""
    unit_id = parse_unit_qr(code)
    if not unit_id:
        raise HTTPException(400, "Nieprawidłowy kod QR sztuki")
    unit = query_one("SELECT * FROM finished_units WHERE id=%s", (unit_id,))
    if not unit:
        raise HTTPException(404, "Sztuka nie znaleziona")
    recipe = query_one("SELECT name FROM recipes WHERE id=%s", (unit.get("recipe_id"),)) or {}
    ptype = query_one("SELECT name FROM product_types WHERE id=%s", (unit.get("product_type_id"),)) or {}
    return {
        "id": unit["id"],
        "qrCode": unit["qr_code"],
        "status": unit["status"],
        "clientName": unit.get("client_name") or "",
        "productTypeId": unit.get("product_type_id") or "",
        "productTypeName": ptype.get("name") or "",
        "recipeId": unit.get("recipe_id") or "",
        "recipeName": recipe.get("name") or "",
        "tuleja": unit.get("tuleja") or "",
        "weightKg": float(unit.get("weight_kg") or 0),
        "batchNo": unit.get("batch_no") or "",
        "trolleyId": unit.get("trolley_id"),
        "cartonId": unit.get("carton_id"),
        "producedAt": str(unit.get("produced_at") or ""),
    }
