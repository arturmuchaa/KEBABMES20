from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_execute_returning, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.models.raw_batches import RawBatchCreate, RawBatchUpdate
from app.utils.batch_numbers import (
    format_reception_no,
    parse_reception_no,
)
from app.utils.body import body_get
from app.utils.ids import cuid, next_seq, now_iso
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)


def next_batch_number() -> Dict[str, Any]:
    row = query_one("SELECT value FROM sequences WHERE key='batch_seq'")
    next_val = (int(row["value"]) if row else 171) + 1
    no = format_reception_no(next_val)
    return {
        "nextNo": no,
        "seq": next_val,
        "suggestedBatchNo": no,
        "suggestedSeq": next_val,
        "note": "Numer zostanie potwierdzony przy zapisie",
    }


def list_all_batches() -> List[Dict]:
    return query_all("SELECT * FROM raw_batches ORDER BY internal_batch_seq ASC")


def list_batches(active_only: bool, limit: int) -> Dict[str, Any]:
    limit = max(1, min(int(limit), 1000))
    sql = (
        "SELECT b.*, s.display_name AS supplier_display_name "
        "FROM raw_batches b LEFT JOIN suppliers s ON s.id = b.supplier_id"
    )
    params: list = []
    if active_only:
        sql += " WHERE b.status = 'active'"
    sql += " ORDER BY b.internal_batch_seq ASC LIMIT %s"
    params.append(limit)
    return {"data": query_all(sql, params), "total": None}


def create_batch(dto: RawBatchCreate) -> Dict:
    """Tworzy nową partię surowca.

    Numer partii (`internal_batch_no`) — goły numer, bez litery:
      - jeżeli dto.internal_batch_no jest podane i jest liczbą (np. 344),
        używa tego numeru. `batch_seq` jest synchronizowane do max(seq, podana)
        żeby kolejne auto-numery były wyższe.
      - jeżeli brak — pobiera kolejny z `batch_seq` (N+1).
    """
    try:
        custom_seq = parse_reception_no(dto.internal_batch_no)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    custom_no = format_reception_no(custom_seq) if custom_seq is not None else ""

    with transaction() as conn:
        if custom_seq is not None:
            # sprawdź unikalność
            existing = cx_query_one(
                conn,
                "SELECT 1 FROM raw_batches WHERE internal_batch_no=%s",
                (custom_no,),
            )
            if existing:
                raise HTTPException(409, f"Partia {custom_no} już istnieje")
            seq = custom_seq
            internal_no = custom_no
            # zsynchronizuj sequences żeby kolejne auto-numery były wyższe
            cx_execute(
                conn,
                """
                INSERT INTO sequences (key, value) VALUES ('batch_seq', %s)
                ON CONFLICT (key) DO UPDATE SET value = GREATEST(sequences.value, EXCLUDED.value)
                """,
                (custom_seq,),
            )
        else:
            # auto-numerowanie: kolejny z batch_seq
            row = cx_query_one(
                conn,
                """
                INSERT INTO sequences (key, value) VALUES ('batch_seq', 1)
                ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1
                RETURNING value
                """,
            )
            seq = int(row["value"])
            internal_no = format_reception_no(seq)

        sup = cx_query_one(
            conn, "SELECT * FROM suppliers WHERE id = %s", (dto.supplier_id,)
        )
        # Rodzaj surowca — domyślnie ćwiartka (jedyny wymagający rozbioru)
        mat = None
        if dto.material_type_id:
            mat = cx_query_one(
                conn, "SELECT * FROM raw_material_types WHERE id=%s",
                (dto.material_type_id,),
            )
        if not mat:
            mat = cx_query_one(
                conn, "SELECT * FROM raw_material_types WHERE id='mat-cwiartka'"
            )
        mat_id = mat["id"] if mat else ""
        mat_name = mat["name"] if mat else ""
        requires_deboning = bool(mat["requires_deboning"]) if mat else True

        row = cx_execute_returning(
            conn,
            """
            INSERT INTO raw_batches
            (id, internal_batch_no, internal_batch_seq, supplier_id, supplier_name,
             supplier_batch_no, slaughter_date, received_date, kg_received,
             kg_available, price_per_kg, expiry_date, status, notes,
             invoice_no, material_type_id, material_name, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'active',%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                cuid(),
                internal_no,
                seq,
                dto.supplier_id,
                sup["name"] if sup else "",
                dto.supplier_batch_no,
                dto.slaughter_date or None,
                dto.received_date or None,
                dto.kg_received,
                dto.kg_received,
                dto.price_per_kg,
                dto.expiry_date or None,
                dto.notes,
                dto.invoice_no or None,
                mat_id,
                mat_name,
                now_iso(),
            ),
        )

        # Audit: każde przyjęcie surowca = IN movement (product_type="raw").
        if float(dto.kg_received or 0) > 0:
            create_stock_movement(
                conn,
                product_type="raw",
                batch_id=row["id"],
                qty=float(dto.kg_received),
                movement_type="IN",
                source_type="supplier",
                source_id=dto.supplier_id or row["id"],
            )

        # Surowiec bez rozbioru (filet, indyk…): od razu trafia na magazyn
        # mięsa jako lot do masowania — odpowiednik "natychmiastowego rozbioru
        # 1:1". Partia przyjęcia zostaje zapisem traceability (kg_available=0,
        # stan żyje w meat_stock pod tym samym numerem partii).
        if not requires_deboning and float(dto.kg_received or 0) > 0:
            kg = float(dto.kg_received)
            cx_execute(
                conn,
                "UPDATE raw_batches SET kg_available=0 WHERE id=%s",
                (row["id"],),
            )
            row["kg_available"] = 0
            cx_execute(
                conn,
                """
                INSERT INTO meat_stock
                    (id, lot_no, raw_batch_id, raw_batch_no, kg_initial,
                     kg_available, production_date, expiry_date, status,
                     material_type_id, material_name, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,COALESCE(%s::date, CURRENT_DATE),%s,'AVAILABLE',%s,%s,%s)
                """,
                (
                    cuid(),
                    internal_no,
                    row["id"],
                    internal_no,
                    kg,
                    kg,
                    dto.received_date or None,
                    dto.expiry_date or None,
                    mat_id,
                    mat_name,
                    now_iso(),
                ),
            )
            create_stock_movement(
                conn,
                product_type="raw",
                batch_id=row["id"],
                qty=kg,
                movement_type="OUT",
                source_type="reception_transfer",
                source_id=row["id"],
            )
            ms_row = cx_query_one(
                conn, "SELECT id FROM meat_stock WHERE lot_no=%s", (internal_no,)
            )
            create_stock_movement(
                conn,
                product_type="meat",
                batch_id=ms_row["id"] if ms_row else internal_no,
                qty=kg,
                movement_type="IN",
                source_type="reception",
                source_id=row["id"],
            )

    logger.info(
        "raw_batch.created",
        extra={
            "batch_id": row["id"],
            "internal_batch_no": row["internal_batch_no"],
            "kg_received": dto.kg_received,
            "supplier_id": dto.supplier_id,
        },
    )
    return row


def batch_history(batch_id: str) -> List[Dict]:
    return query_all(
        "SELECT * FROM raw_batch_history WHERE batch_id=%s ORDER BY created_at DESC",
        (batch_id,),
    )


def _batch_used_reason_cx(conn, batch_id: str) -> str | None:
    """Zwraca powód, dla którego partii NIE wolno edytować/usuwać (albo None).
    Partia „ruszona": status used/cancelled, albo są wpisy rozbioru / mięso /
    uboczne z tej partii. Chroni traceability przed edycją rozliczonej ćwiartki."""
    st = cx_query_one(conn, "SELECT status FROM raw_batches WHERE id=%s", (batch_id,))
    if not st:
        return "not_found"
    status = (st.get("status") or "").lower()
    if status in ("used", "cancelled"):
        return f"Partia ma status {status} — operacja niedozwolona"
    for table, label in (
        ("deboning_entries", "rozbiorze"),
        ("meat_stock", "magazynie mięsa"),
        ("batch_byproducts", "ważeniu ubocznych"),
    ):
        r = cx_query_one(conn, f"SELECT 1 FROM {table} WHERE raw_batch_id=%s LIMIT 1", (batch_id,))
        if r:
            return f"Partia jest już użyta w {label} — operacja niedozwolona"
    return None


def cancel_batch(batch_id: str) -> Dict:
    with transaction() as conn:
        reason = _batch_used_reason_cx(conn, batch_id)
        if reason == "not_found":
            raise HTTPException(404, "Partia nie znaleziona")
        if reason:
            raise HTTPException(409, reason)
        # Zerowanie stanu: anulowana dostawa nie może trzymać kg — duch 415
        # (2026-07-16) wisiał z 5010 kg na magazynie surowca i w pickerze WZ.
        #
        # Numer WRACA DO PULI (prod 2026-07-20: usunięto 423 i nie dało się
        # przyjąć pod tym numerem — „Partia 423 już istnieje"). Kolumna ma
        # UNIQUE, a numer jest w systemie kluczem ludzkim (traceability i WZ
        # szukają dostawy po nim), więc zamiast dopuszczać duplikaty
        # zwalniamy numer: wiersz zostaje do historii ze znacznikiem ANUL-<id>
        # (nigdy nie koliduje z gołym numerem), a pierwotny numer czyta się
        # z internal_batch_seq.
        # Ruch domykający księgę: bez niego anulowana partia miała w
        # stock_movements samo przyjęcie IN i kartoteka pokazywała ducha
        # (audyt 2026-07-22: ANUL-* z +5010/+7005 kg w księdze przy stanie 0).
        cur = cx_query_one(
            conn, "SELECT kg_available FROM raw_batches WHERE id=%s FOR UPDATE",
            (batch_id,),
        )
        kg_left = float((cur or {}).get("kg_available") or 0)
        if kg_left > 0:
            create_stock_movement(
                conn, product_type="raw", batch_id=batch_id, qty=kg_left,
                movement_type="OUT", source_type="cancellation", source_id=batch_id,
            )
        row = cx_execute_returning(
            conn,
            "UPDATE raw_batches SET status='cancelled', kg_available=0, "
            "internal_batch_no='ANUL-' || id WHERE id=%s RETURNING *",
            (batch_id,),
        )
    if not row:
        raise HTTPException(404, "Partia nie znaleziona")
    logger.info("raw_batch.cancelled", extra={"batch_id": batch_id})
    return row


def update_batch(batch_id: str, dto: RawBatchUpdate) -> Dict:
    with transaction() as conn:
        reason = _batch_used_reason_cx(conn, batch_id)
        if reason == "not_found":
            raise HTTPException(404, "Partia nie znaleziona")
        if reason:
            raise HTTPException(409, reason)
        kg_received = float(dto.kg_received)
        row = cx_execute_returning(
            conn,
            """
            UPDATE raw_batches
            SET supplier_batch_no=%s, slaughter_date=%s, received_date=%s,
                kg_received=%s, kg_available=%s, price_per_kg=%s,
                expiry_date=%s, notes=%s
            WHERE id=%s
            RETURNING *
            """,
            (
                dto.supplier_batch_no,
                dto.slaughter_date or None,
                dto.received_date or None,
                kg_received,
                kg_received,
                float(dto.price_per_kg),
                dto.expiry_date or None,
                dto.notes,
                batch_id,
            ),
        )
    if not row:
        raise HTTPException(404, "Partia nie znaleziona")
    logger.info("raw_batch.updated", extra={"batch_id": batch_id})
    return row


def list_meat_stock(include_reserved: bool = False) -> Dict[str, Any]:
    # include_reserved: planer dnia masowania potrzebuje TAKŻE partii w całości
    # zarezerwowanych (kg_free=0) — edycja planu oddaje własne rezerwacje do
    # puli (front liczy pulę dnia = kg_free + rezerwacje wczytanego planu).
    cond = (
        "((m.kg_available - COALESCE(m.kg_reserved, 0)) > 0 "
        "OR COALESCE(m.kg_reserved, 0) > 0)"
        if include_reserved
        else "(m.kg_available - COALESCE(m.kg_reserved, 0)) > 0"
    )
    return {
        "data": query_all(
            f"""
            SELECT m.*,
                   (m.kg_available - COALESCE(m.kg_reserved, 0)) AS kg_free,
                   b.internal_batch_no, b.supplier_name,
                   s.display_name AS supplier_display_name,
                   b.slaughter_date as batch_slaughter_date
            FROM meat_stock m
            LEFT JOIN raw_batches b ON b.id = m.raw_batch_id
            LEFT JOIN suppliers s ON s.id = b.supplier_id
            WHERE {cond}
            ORDER BY m.expiry_date ASC, m.lot_no ASC
            """
        )
    }
