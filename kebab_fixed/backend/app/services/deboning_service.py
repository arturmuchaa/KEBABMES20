"""Deboning: raw_batch → meat_stock.

Safety guarantees:
  * Single transaction for: raw_batches row lock → raw_batches update →
    meat_stock upsert → stock_movements IN entry.
  * SELECT ... FOR UPDATE on the raw_batches row before deduction
    prevents two concurrent entries from overdrawing the batch.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import (
    cx_execute,
    cx_execute_returning,
    cx_query_all,
    cx_query_one,
    query_all,
    transaction,
)
from app.logging_config import get_logger
from app.models.deboning import DeboningEntryCreate, DeboningEntryUpdate
from app.utils.ids import cuid, next_dated_no, now_iso
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)


def _map_deboning_entry(row: Dict) -> Dict:
    if not row:
        return row
    kg_taken = float(row.get("kg_quarter") or 0)
    kg_meat = float(row.get("kg_meat") or 0)
    yield_pct = (kg_meat / kg_taken * 100) if kg_taken > 0 else 0
    return {
        "id": row["id"],
        "sessionId": row.get("session_id", ""),
        "sessionDate": str(row.get("session_date") or ""),
        "sessionNo": row.get("session_no", ""),
        "rawBatchId": row.get("raw_batch_id", ""),
        "rawBatchNo": row.get("raw_batch_no", ""),
        "workerId": row.get("worker_id", ""),
        "workerName": row.get("worker_name", ""),
        "kgTaken": kg_taken,
        "kgMeat": kg_meat,
        "kgBacks": float(row.get("kg_backs") or 0),
        "kgBones": float(row.get("kg_bones") or 0),
        "kgRemainder": float(row.get("kg_remainder") or 0),
        "yieldPct": round(yield_pct, 2),
        "meatLotNo": row.get("meat_lot_no"),
        "kgGross": float(row["kg_gross"]) if row.get("kg_gross") is not None else None,
        "tareCartKg": float(row["tare_cart_kg"]) if row.get("tare_cart_kg") is not None else None,
        "tareE2Kg": float(row["tare_e2_kg"]) if row.get("tare_e2_kg") is not None else None,
        "e2Count": row.get("e2_count"),
        "weighMode": row.get("weigh_mode"),
        "createdAt": str(row.get("created_at") or ""),
    }


def list_deboning_entries(session_id: str | None) -> List[Dict]:
    if session_id:
        rows = query_all(
            "SELECT * FROM deboning_entries WHERE session_id=%s ORDER BY created_at DESC",
            (session_id,),
        )
    else:
        rows = query_all("SELECT * FROM deboning_entries ORDER BY created_at DESC")
    return [_map_deboning_entry(r) for r in rows]


def list_deboning_sessions() -> Dict[str, List[Dict]]:
    rows = query_all("SELECT * FROM deboning_entries ORDER BY created_at DESC")
    return {"data": [_map_deboning_entry(r) for r in rows]}


def deboning_trace(batch_id: str) -> Dict[str, List[Dict]]:
    entries = query_all(
        "SELECT * FROM deboning_entries WHERE raw_batch_id=%s ORDER BY created_at DESC",
        (batch_id,),
    )
    return {"data": [_map_deboning_entry(e) for e in entries]}


def validate_weighing_consistency(
    kg_gross, tare_cart_kg, tare_e2_kg, kg_meat, tolerance: float = 0.5
):
    """Ważenie auto: netto z wagi (brutto − tary) musi zgadzać się z kg_meat.

    Zwraca komunikat błędu albo None. Czysta funkcja — testowana bez DB.
    Brak kg_gross → brak walidacji (wpis ręczny / stara wersja HMI).
    """
    if kg_gross is None:
        return None
    net = float(kg_gross) - float(tare_cart_kg or 0) - float(tare_e2_kg or 0)
    if abs(net - float(kg_meat)) > tolerance:
        return (
            f"Niespójne ważenie: brutto {kg_gross} kg − tara "
            f"{float(tare_cart_kg or 0) + float(tare_e2_kg or 0):g} kg = {net:g} kg, "
            f"a wysłano {kg_meat} kg mięsa"
        )
    return None


# ── Twarde walidacje serwerowe (frontend to tylko pierwsza linia) ─────────


def validate_batch_expiry(expiry_date, today: date | None = None):
    """HACCP: partia przeterminowana (termin < dziś) nie wchodzi do rozbioru.

    Termin upływający DZIŚ jeszcze przechodzi (spójne z kafelkami HMI,
    które blokują dopiero daysLeft < 0). Czysta funkcja — testy bez DB.
    """
    if not expiry_date:
        return None
    today = today or date.today()
    if str(expiry_date)[:10] < today.isoformat():
        return (
            f"Partia przeterminowana ({str(expiry_date)[:10]}) — "
            "użycie zabronione (HACCP)"
        )
    return None


def validate_session_writable(session_row):
    """Wpisy tylko do istniejącej, OTWARTEJ sesji."""
    if not session_row:
        return "Sesja produkcyjna nie istnieje"
    status = session_row.get("status")
    if status == "closed":
        return "Sesja zamknięta — nie można dodawać wpisów"
    if status == "approved":
        return "Sesja zatwierdzona — dane zablokowane"
    if status != "open":
        return f"Sesja w stanie '{status}' — zapis niemożliwy"
    return None


# Okno cofnięcia wpisu z HMI: frontend pokazuje przycisk 60 s, backend
# przyjmuje trochę dłużej (opóźnienia sieci / zawahanie operatora).
UNDO_MAX_AGE_MIN = 15


def validate_entry_undo(entry, meat_available, now: datetime | None = None):
    """Czy wpis rozbioru można bezpiecznie cofnąć (storno z HMI).

    Blokady: wpis rozliczony (grzbiety/kości), mięso z lotu już zużyte
    dalej (masowanie), wpis starszy niż UNDO_MAX_AGE_MIN.
    meat_available=None → lot nie istnieje (stare dane) — nie blokuje.
    """
    if float(entry.get("kg_backs") or 0) > 0 or float(entry.get("kg_bones") or 0) > 0:
        return "Wpis już rozliczony (grzbiety/kości) — cofnięcie niemożliwe"
    kg_meat = float(entry.get("kg_meat") or 0)
    if meat_available is not None and float(meat_available) < kg_meat - 0.001:
        return "Mięso z tego wpisu zostało już zużyte — cofnięcie niemożliwe"
    created = entry.get("created_at")
    if created:
        try:
            created_dt = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
            now = now or datetime.now(timezone.utc)
            if created_dt.tzinfo is None:
                created_dt = created_dt.replace(tzinfo=timezone.utc)
            if (now - created_dt) > timedelta(minutes=UNDO_MAX_AGE_MIN):
                return f"Wpis starszy niż {UNDO_MAX_AGE_MIN} minut — cofnij przez biuro"
        except ValueError:
            pass
    return None


def create_deboning_entry(dto: DeboningEntryCreate) -> Dict:
    raw_batch_id = dto.raw_batch_id
    worker_id = dto.worker_id
    worker_name = dto.worker_name
    kg_taken = float(dto.kg_taken or dto.kg_quarter or 0)
    kg_meat = float(dto.kg_meat)
    session_id = dto.session_id

    if dto.weigh_mode == "auto":
        weighing_err = validate_weighing_consistency(
            dto.kg_gross, dto.tare_cart_kg, dto.tare_e2_kg, kg_meat
        )
        if weighing_err:
            raise HTTPException(400, weighing_err)

    if kg_taken <= 0:
        raise HTTPException(400, "Ilość pobranej ćwiartki musi być > 0")
    if kg_meat <= 0:
        raise HTTPException(400, "Ilość mięsa musi być > 0")
    if kg_meat > kg_taken:
        raise HTTPException(
            400,
            f"Mięso ({kg_meat} kg) nie może przekraczać pobranej "
            f"ćwiartki ({kg_taken} kg)",
        )
    yield_pct_val = (kg_meat / kg_taken) * 100
    if yield_pct_val > 95:
        raise HTTPException(
            400, f"Wydajność {round(yield_pct_val,1)}% jest nierealna — sprawdź dane"
        )
    if yield_pct_val < 30:
        raise HTTPException(
            400,
            f"Wydajność {round(yield_pct_val,1)}% jest bardzo niska — sprawdź dane",
        )

    entry_id = cuid()

    with transaction() as conn:
        # Twarda walidacja sesji — frontend blokuje, ale API mogą wołać też
        # inne klienty (biuro, stare wersje HMI). Bez session_id przepuszczamy
        # (legacy ścieżka POST /api/deboning bez sesji).
        if session_id:
            session_row = cx_query_one(
                conn, "SELECT status FROM production_sessions WHERE id=%s", (session_id,)
            )
            session_err = validate_session_writable(session_row)
            if session_err:
                raise HTTPException(400, session_err)

        # Numer zlecenia rozbioru = ROZ/dd/mm/rr (wspólny helper, jak produkcja PP).
        session_no = next_dated_no(conn, "ROZ")
        # Row lock the raw batch so two concurrent deboning entries
        # cannot each pass the availability check on the same batch.
        batch = cx_query_one(
            conn,
            "SELECT * FROM raw_batches WHERE id=%s FOR UPDATE",
            (raw_batch_id,),
        )
        if not batch:
            batch = cx_query_one(
                conn,
                "SELECT * FROM raw_batches WHERE internal_batch_no=%s FOR UPDATE",
                (raw_batch_id,),
            )
        if not batch:
            raise HTTPException(
                404, f"Partia nie znaleziona (raw_batch_id={raw_batch_id!r})"
            )
        if batch.get("status") != "active":
            raise HTTPException(
                400,
                f"Partia {batch.get('internal_batch_no')} ma status "
                f"{batch.get('status')} — rozbiór niemożliwy",
            )

        expiry_err = validate_batch_expiry(batch.get("expiry_date"))
        if expiry_err:
            raise HTTPException(400, expiry_err)

        kg_available = float(batch.get("kg_available") or batch.get("kg_received") or 0)
        if kg_taken > kg_available + 0.01:
            raise HTTPException(
                400,
                f"Nie można pobrać {kg_taken} kg — dostępne tylko "
                f"{round(kg_available, 2)} kg w partii "
                f"{batch.get('internal_batch_no', '')}",
            )

        if worker_id and not worker_name:
            worker = cx_query_one(
                conn, "SELECT name FROM workers WHERE id=%s", (worker_id,)
            )
            if worker:
                worker_name = worker["name"]

        kg_remainder = max(0, kg_taken - kg_meat)
        yield_pct = round(yield_pct_val, 2)
        # Numer mięsa po rozbiorze = ten sam numer co partia surowca (bez litery).
        meat_lot_no = batch["internal_batch_no"]

        entry = cx_execute_returning(
            conn,
            """
            INSERT INTO deboning_entries
                (id, raw_batch_id, raw_batch_no, session_id, session_no,
                 kg_quarter, kg_meat, kg_remainder, yield_pct,
                 worker_id, worker_name,
                 kg_gross, tare_cart_kg, tare_e2_kg, e2_count, weigh_mode,
                 created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                entry_id,
                batch["id"],
                batch["internal_batch_no"],
                session_id,
                session_no,
                kg_taken,
                kg_meat,
                kg_remainder,
                yield_pct,
                worker_id,
                worker_name,
                dto.kg_gross,
                dto.tare_cart_kg,
                dto.tare_e2_kg,
                dto.e2_count,
                dto.weigh_mode,
                now_iso(),
            ),
        )

        # Produkty uboczne (ABP) — część niemięsna jako śledzony lot do utylizacji.
        from app.services.byproducts_service import create_byproduct_lots_for_entry

        create_byproduct_lots_for_entry(conn, entry)

        cx_execute(
            conn,
            """
            UPDATE raw_batches
            SET kg_available = GREATEST(0, COALESCE(kg_available, kg_received) - %s)
            WHERE id = %s
            """,
            (kg_taken, batch["id"]),
        )

        # Audit: rozbiór zdejmuje kg_taken z raw_batches → OUT movement.
        # Konsekwentne sumowanie ruchów po product_type="raw" daje rzeczywisty
        # stan partii surowca bez konieczności łączenia z deboning_entries.
        create_stock_movement(
            conn,
            product_type="raw",
            batch_id=batch["id"],
            qty=kg_taken,
            movement_type="OUT",
            source_type="deboning",
            source_id=entry_id,
        )

        # Compute meat_stock expiry
        recv = batch.get("received_date")
        if recv:
            try:
                exp = (
                    datetime.fromisoformat(str(recv)) + timedelta(days=7)
                ).date().isoformat()
            except Exception:
                exp = batch.get("expiry_date")
        else:
            exp = batch.get("expiry_date")

        meat_stock_id = cuid()
        cx_execute(
            conn,
            """
            INSERT INTO meat_stock
                (id, lot_no, deboning_session_id, session_no,
                 raw_batch_id, raw_batch_no, kg_initial, kg_available,
                 production_date, expiry_date, status,
                 material_type_id, material_name, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_DATE,%s,'AVAILABLE',%s,%s,%s)
            ON CONFLICT (lot_no) DO UPDATE
            SET kg_initial  = meat_stock.kg_initial  + EXCLUDED.kg_initial,
                kg_available = meat_stock.kg_available + EXCLUDED.kg_available
            """,
            (
                meat_stock_id,
                meat_lot_no,
                entry_id,
                session_no,
                batch["id"],
                batch["internal_batch_no"],
                kg_meat,
                kg_meat,
                exp,
                # Rozbiór wytwarza NOWY surowiec — „Mięso z/s" — odrębny od
                # ćwiartki (surowca wejściowego). Dzięki temu w całym dalszym
                # łańcuchu (masowanie, planowanie, etykieta) mięso z rozbioru
                # jest czytelnie odróżnialne od fileta i nie myli się z surowcem.
                "mat-mieso-zs",
                "Mięso z/s",
                now_iso(),
            ),
        )

        # Re-fetch the real meat_stock id (in case of ON CONFLICT)
        ms_row = cx_query_one(
            conn, "SELECT id FROM meat_stock WHERE lot_no=%s", (meat_lot_no,)
        )
        real_ms_id = ms_row["id"] if ms_row else meat_stock_id

        create_stock_movement(
            conn,
            product_type="meat",
            batch_id=real_ms_id,
            qty=kg_meat,
            movement_type="IN",
            source_type="deboning",
            source_id=entry_id,
        )

    logger.info(
        "deboning.entry.created",
        extra={
            "entry_id": entry_id,
            "raw_batch_id": batch["id"],
            "kg_taken": kg_taken,
            "kg_meat": kg_meat,
            "yield_pct": yield_pct,
        },
    )
    return _map_deboning_entry(entry)  # type: ignore[arg-type]


def update_deboning_entry(entry_id: str, dto: DeboningEntryUpdate) -> Dict:
    with transaction() as conn:
        existing = cx_query_one(
            conn, "SELECT * FROM deboning_entries WHERE id=%s FOR UPDATE", (entry_id,)
        )
        if not existing:
            raise HTTPException(404, "Wpis rozbioru nie znaleziony")
        kg_taken = float(
            dto.kg_taken
            if dto.kg_taken is not None
            else (dto.kg_quarter if dto.kg_quarter is not None else (existing.get("kg_quarter") or 0))
        )
        kg_meat = float(
            dto.kg_meat if dto.kg_meat is not None else (existing.get("kg_meat") or 0)
        )
        kg_backs = float(
            dto.kg_backs if dto.kg_backs is not None else (existing.get("kg_backs") or 0)
        )
        kg_bones = float(
            dto.kg_bones if dto.kg_bones is not None else (existing.get("kg_bones") or 0)
        )
        if kg_meat > kg_taken:
            raise HTTPException(400, "kg mięsa nie może przekraczać pobranej ćwiartki")
        kg_remainder = max(0, kg_taken - kg_meat)
        yield_pct = round((kg_meat / kg_taken * 100) if kg_taken > 0 else 0, 2)

        row = cx_execute_returning(
            conn,
            """
            UPDATE deboning_entries
            SET kg_quarter=%s, kg_meat=%s, kg_backs=%s, kg_bones=%s,
                kg_remainder=%s, yield_pct=%s
            WHERE id=%s
            RETURNING *
            """,
            (kg_taken, kg_meat, kg_backs, kg_bones, kg_remainder, yield_pct, entry_id),
        )
    if not row:
        raise HTTPException(404, "Wpis rozbioru nie znaleziony")
    logger.info("deboning.entry.updated", extra={"entry_id": entry_id})
    return _map_deboning_entry(row)


def delete_deboning_entry(entry_id: str) -> Dict:
    """Cofnięcie wpisu rozbioru (przycisk „Cofnij" na HMI).

    Odwraca w JEDNEJ transakcji wszystko, co utworzył create_deboning_entry:
    oddaje kg_taken do partii surowca, zdejmuje kg_meat z lotu mięsa
    (lot współdzielony między wpisami tej samej partii — tylko odejmujemy;
    pusty lot kasujemy), usuwa loty ABP i ruchy magazynowe wpisu.
    Warunki bezpieczeństwa w validate_entry_undo (czysta funkcja).
    """
    with transaction() as conn:
        entry = cx_query_one(
            conn, "SELECT * FROM deboning_entries WHERE id=%s FOR UPDATE", (entry_id,)
        )
        if not entry:
            raise HTTPException(404, "Wpis rozbioru nie znaleziony")

        if entry.get("session_id"):
            session_row = cx_query_one(
                conn,
                "SELECT status FROM production_sessions WHERE id=%s",
                (entry["session_id"],),
            )
            session_err = validate_session_writable(session_row)
            if session_err:
                raise HTTPException(400, session_err)

        meat_lot = cx_query_one(
            conn,
            "SELECT id, kg_initial, kg_available FROM meat_stock WHERE lot_no=%s FOR UPDATE",
            (entry.get("raw_batch_no"),),
        )
        undo_err = validate_entry_undo(
            entry,
            float(meat_lot["kg_available"]) if meat_lot else None,
        )
        if undo_err:
            raise HTTPException(400, undo_err)

        processed_abp = cx_query_one(
            conn,
            "SELECT id FROM byproduct_lots WHERE deboning_entry_id=%s AND status <> 'open'",
            (entry_id,),
        )
        if processed_abp:
            raise HTTPException(
                400, "Produkty uboczne wpisu już przetworzone — cofnięcie niemożliwe"
            )
        cx_execute(
            conn, "DELETE FROM byproduct_lots WHERE deboning_entry_id=%s", (entry_id,)
        )

        kg_meat = float(entry.get("kg_meat") or 0)
        if meat_lot:
            if float(meat_lot["kg_initial"]) - kg_meat <= 0.001:
                cx_execute(conn, "DELETE FROM meat_stock WHERE id=%s", (meat_lot["id"],))
            else:
                cx_execute(
                    conn,
                    """
                    UPDATE meat_stock
                    SET kg_initial = kg_initial - %s,
                        kg_available = GREATEST(0, kg_available - %s)
                    WHERE id=%s
                    """,
                    (kg_meat, kg_meat, meat_lot["id"]),
                )

        kg_taken = float(entry.get("kg_quarter") or 0)
        cx_execute(
            conn,
            """
            UPDATE raw_batches
            SET kg_available = COALESCE(kg_available, 0) + %s
            WHERE id=%s
            """,
            (kg_taken, entry.get("raw_batch_id")),
        )

        cx_execute(
            conn,
            "DELETE FROM stock_movements WHERE source_type='deboning' AND source_id=%s",
            (entry_id,),
        )
        cx_execute(conn, "DELETE FROM deboning_entries WHERE id=%s", (entry_id,))

    logger.info(
        "deboning.entry.undone",
        extra={"entry_id": entry_id, "kg_taken": kg_taken, "kg_meat": kg_meat},
    )
    return {"ok": True, "id": entry_id}
