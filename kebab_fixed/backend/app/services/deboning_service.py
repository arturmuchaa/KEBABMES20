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
    cx_execute_rowcount,
    cx_query_all,
    cx_query_one,
    query_all,
    query_one,
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
        "status": row.get("status") or "complete",
        "completedAt": str(row.get("completed_at") or "") or None,
        "createdAt": str(row.get("created_at") or ""),
    }


def list_deboning_entries(session_id: str | None, with_open_takes: bool = False) -> List[Dict]:
    if session_id:
        if with_open_takes:
            # HMI: otwarte pobrania (status='pending') muszą być widoczne
            # NIEZALEŻNIE od sesji — pobranie niezważone do końca dnia inaczej
            # znika z kafelka pracownika następnego dnia i nie da się go
            # domknąć (kg zeszło z partii, a na ekranie nic nie widać).
            rows = query_all(
                "SELECT * FROM deboning_entries WHERE session_id=%s "
                "OR COALESCE(status, 'complete')='pending' ORDER BY created_at DESC",
                (session_id,),
            )
        else:
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


def deboning_stats(date_from: str, date_to: str) -> Dict[str, Any]:
    """Agregaty rozbioru dla biura w zakresie dat (po created_at::date).

    Zwraca: summary (KPI), workers (ranking), byHour (przepustowość dnia),
    byDay (trend zakresu), recent (live feed). Godziny aktywne = liczba
    unikalnych kubełków (dzień, godzina) z wpisami — daje intuicyjne kg/h.
    """
    from collections import defaultdict

    rows = query_all(
        """
        SELECT id, worker_id, worker_name, kg_quarter, kg_meat, kg_backs,
               kg_bones, yield_pct, raw_batch_no, created_at
        FROM deboning_entries
        WHERE created_at::date BETWEEN %s AND %s
          AND COALESCE(status, 'complete') = 'complete'
        ORDER BY created_at
        """,
        (date_from, date_to),
    )

    def f(v) -> float:
        return float(v or 0)

    def bucket(r):
        d = r["created_at"]
        return (d.date(), d.hour)

    total_q = len(rows)
    total_kgq = sum(f(r["kg_quarter"]) for r in rows)
    total_meat = sum(f(r["kg_meat"]) for r in rows)
    total_backs = sum(f(r["kg_backs"]) for r in rows)
    total_bones = sum(f(r["kg_bones"]) for r in rows)

    # Zbiorcze ważenie ubocznych partii (batch_byproducts) — kreator na HMI
    # zapisuje grzbiety/kości NA PARTIĘ, nie per wpis, więc bez tego biuro
    # widziało zero (prod 2026-07-08). Frakcja liczy się w dniu zakończenia
    # partii (finished_at), zapasowo w dniu ważenia.
    bp = query_one(
        """
        SELECT COALESCE(SUM(backs_kg), 0) AS backs, COALESCE(SUM(bones_kg), 0) AS bones
        FROM batch_byproducts
        WHERE COALESCE(finished_at, backs_at, bones_at)::date BETWEEN %s AND %s
        """,
        (date_from, date_to),
    )
    total_backs += f(bp and bp.get("backs"))
    total_bones += f(bp and bp.get("bones"))
    active_hours = max(1, len({bucket(r) for r in rows})) if rows else 1

    wagg: Dict[str, Dict] = defaultdict(
        lambda: {"quarters": 0, "kgQuarter": 0.0, "kgMeat": 0.0,
                 "kgBacks": 0.0, "kgBones": 0.0, "buckets": set(), "name": "—"}
    )
    for r in rows:
        wid = r["worker_id"] or r["worker_name"] or "—"
        w = wagg[wid]
        w["name"] = r["worker_name"] or "—"
        w["quarters"] += 1
        w["kgQuarter"] += f(r["kg_quarter"])
        w["kgMeat"] += f(r["kg_meat"])
        w["kgBacks"] += f(r["kg_backs"])
        w["kgBones"] += f(r["kg_bones"])
        w["buckets"].add(bucket(r))

    workers = []
    for wid, w in wagg.items():
        ah = max(1, len(w["buckets"]))
        workers.append({
            "workerId": wid,
            "workerName": w["name"],
            "quarters": w["quarters"],
            "kgQuarter": round(w["kgQuarter"], 1),
            "kgMeat": round(w["kgMeat"], 1),
            "avgYield": round(w["kgMeat"] / w["kgQuarter"] * 100, 1) if w["kgQuarter"] else 0.0,
            "kgPerHour": round(w["kgMeat"] / ah, 1),
        })
    workers.sort(key=lambda x: -x["kgQuarter"])

    hagg: Dict[str, Dict] = defaultdict(lambda: {"quarters": 0, "kgMeat": 0.0})
    for r in rows:
        h = r["created_at"].strftime("%Y-%m-%d %H:00")
        hagg[h]["quarters"] += 1
        hagg[h]["kgMeat"] += f(r["kg_meat"])
    by_hour = [
        {"hour": k, "quarters": v["quarters"], "kgMeat": round(v["kgMeat"], 1)}
        for k, v in sorted(hagg.items())
    ]

    dagg: Dict[str, Dict] = defaultdict(lambda: {"quarters": 0, "kgMeat": 0.0, "kgQuarter": 0.0})
    for r in rows:
        d = r["created_at"].strftime("%Y-%m-%d")
        dagg[d]["quarters"] += 1
        dagg[d]["kgMeat"] += f(r["kg_meat"])
        dagg[d]["kgQuarter"] += f(r["kg_quarter"])
    by_day = [
        {"date": k, "quarters": v["quarters"], "kgMeat": round(v["kgMeat"], 1),
         "avgYield": round(v["kgMeat"] / v["kgQuarter"] * 100, 1) if v["kgQuarter"] else 0.0}
        for k, v in sorted(dagg.items())
    ]

    # Uzysk per partia surowca — % mięsa z każdej partii w zakresie.
    # Ważniejsze niż przepustowość: słaba partia = rozmowa z dostawcą.
    bagg: Dict[str, Dict] = defaultdict(lambda: {"kgQuarter": 0.0, "kgMeat": 0.0})
    for r in rows:
        b = bagg[r["raw_batch_no"] or "—"]
        b["kgQuarter"] += f(r["kg_quarter"])
        b["kgMeat"] += f(r["kg_meat"])
    by_batch = [
        {"batchNo": no, "kgQuarter": round(v["kgQuarter"], 1), "kgMeat": round(v["kgMeat"], 1),
         "yieldPct": round(v["kgMeat"] / v["kgQuarter"] * 100, 1) if v["kgQuarter"] else 0.0}
        for no, v in sorted(bagg.items())
    ]

    recent = [
        {"id": r["id"], "workerName": r["worker_name"] or "—",
         "rawBatchNo": r["raw_batch_no"] or "—",
         "kgQuarter": round(f(r["kg_quarter"]), 1), "kgMeat": round(f(r["kg_meat"]), 1),
         "yield": round(f(r["yield_pct"]), 1), "at": r["created_at"].isoformat()}
        for r in rows[-50:]
    ][::-1]

    # Rozkład dzienny per pracownik — do drill-downu „ile X rozebrał dnia Y".
    wdaily: Dict[str, Dict[str, Dict]] = defaultdict(
        lambda: defaultdict(lambda: {"quarters": 0, "kgQuarter": 0.0, "kgMeat": 0.0})
    )
    for r in rows:
        wid = r["worker_id"] or r["worker_name"] or "—"
        d = r["created_at"].strftime("%Y-%m-%d")
        c = wdaily[wid][d]
        c["quarters"] += 1
        c["kgQuarter"] += f(r["kg_quarter"])
        c["kgMeat"] += f(r["kg_meat"])
    worker_daily = {
        wid: [
            {"date": d, "quarters": v["quarters"],
             "kgQuarter": round(v["kgQuarter"], 1), "kgMeat": round(v["kgMeat"], 1),
             "avgYield": round(v["kgMeat"] / v["kgQuarter"] * 100, 1) if v["kgQuarter"] else 0.0}
            for d, v in sorted(days.items())
        ]
        for wid, days in wdaily.items()
    }

    return {
        "summary": {
            "quarters": total_q,
            "kgQuarter": round(total_kgq, 1),
            "kgMeat": round(total_meat, 1),
            "kgBacks": round(total_backs, 1),
            "kgBones": round(total_bones, 1),
            "avgYield": round(total_meat / total_kgq * 100, 1) if total_kgq else 0.0,
            "workers": len(wagg),
            "kgPerHour": round(total_meat / active_hours, 1),
            "backsPct": round(total_backs / total_kgq * 100, 1) if total_kgq else 0.0,
            "bonesPct": round(total_bones / total_kgq * 100, 1) if total_kgq else 0.0,
        },
        "workers": workers,
        "byHour": by_hour,
        "byDay": by_day,
        "byBatch": by_batch,
        "recent": recent,
        "workerDaily": worker_daily,
    }


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


def validate_meat_yield(kg_taken: float, kg_meat: float) -> str | None:
    """Sanity mięsa vs pobranej ćwiartki. Czysta funkcja — testy bez DB.

    Wspólna dla zapisu 'od razu' i domknięcia pobrania. Reguły identyczne
    jak dotąd inline w create_deboning_entry.
    """
    kg_taken = float(kg_taken or 0)
    kg_meat = float(kg_meat or 0)
    if kg_meat <= 0:
        return "Ilość mięsa musi być > 0"
    if kg_taken <= 0:
        return "Ilość pobranej ćwiartki musi być > 0"
    if kg_meat > kg_taken:
        return (
            f"Mięso ({kg_meat} kg) nie może przekraczać pobranej "
            f"ćwiartki ({kg_taken} kg)"
        )
    yield_pct = (kg_meat / kg_taken) * 100
    if yield_pct > 95:
        return f"Wydajność {round(yield_pct, 1)}% jest nierealna — sprawdź dane"
    if yield_pct < 30:
        return f"Wydajność {round(yield_pct, 1)}% jest bardzo niska — sprawdź dane"
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


def validate_edit_deltas(delta_taken, raw_available, delta_meat, meat_available):
    """Korekta wpisu (PATCH) musi zmieścić się w stanach magazynowych.

    delta_taken > 0 → dobieramy z partii: musi być dostępne.
    delta_meat < 0 → zdejmujemy z lotu mięsa: nie może być już zużyte.
    raw_available/meat_available=None → odpowiedni stan nieznany (brak
    wiersza) — nie blokuje. Czysta funkcja — testy bez DB.
    """
    if delta_taken > 0.001 and raw_available is not None:
        if float(raw_available) < delta_taken - 0.001:
            return (
                f"Korekta wymaga dobrania {delta_taken:g} kg z partii, "
                f"a dostępne tylko {float(raw_available):g} kg"
            )
    if delta_meat < -0.001 and meat_available is not None:
        if float(meat_available) < -delta_meat - 0.001:
            return (
                "Nie można zmniejszyć mięsa — zostało już zużyte "
                f"(wolne w locie: {float(meat_available):g} kg)"
            )
    return None


def _auto_finish_exhausted(raw_batch_id: str, kg_left) -> None:
    """Serwerowa gwarancja: partia wyczerpana (≤0,5 kg) MUSI mieć rekord
    ubocznych z finished_at — inaczej schodzi z kafli aktywnych bez szarego
    kafla ważenia kości/grzbietów i „znika". Kiosk robi to samo po swojej
    stronie, ale liczy z nieświeżego stanu partii (prod 2026-07-09, partia
    407) — to tutaj jest jedyne pewne miejsce. Nigdy nie może wywalić wpisu,
    który już się zapisał."""
    try:
        if kg_left is None or float(kg_left) > 0.5:
            return
        from app.services.batch_byproducts_service import finish_batch

        finish_batch(raw_batch_id)
        logger.info("deboning.batch.auto_finished", extra={"raw_batch_id": raw_batch_id})
    except Exception:
        logger.exception("deboning.batch.auto_finish_failed", extra={"raw_batch_id": raw_batch_id})


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
    yield_err = validate_meat_yield(kg_taken, kg_meat)
    if yield_err:
        raise HTTPException(400, yield_err)
    yield_pct_val = (kg_meat / kg_taken) * 100

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

        after = cx_execute_returning(
            conn,
            """
            UPDATE raw_batches
            SET kg_available = GREATEST(0, COALESCE(kg_available, kg_received) - %s)
            WHERE id = %s
            RETURNING kg_available
            """,
            (kg_taken, batch["id"]),
        )
        kg_left_after = after["kg_available"] if after else None

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
    _auto_finish_exhausted(batch["id"], kg_left_after)
    return _map_deboning_entry(entry)  # type: ignore[arg-type]


def create_deboning_take(dto) -> Dict:
    """Faza 1: pobranie ćwiartki. Wiersz pending, surowiec schodzi, ruch OUT.
    Bez lotu mięsa i ABP — te powstają dopiero przy domknięciu."""
    raw_batch_id = dto.raw_batch_id
    worker_id = dto.worker_id
    worker_name = dto.worker_name
    kg_taken = float(dto.kg_taken or dto.kg_quarter or 0)
    session_id = dto.session_id

    if kg_taken <= 0:
        raise HTTPException(400, "Ilość pobranej ćwiartki musi być > 0")

    entry_id = cuid()
    with transaction() as conn:
        if session_id:
            session_row = cx_query_one(
                conn, "SELECT status FROM production_sessions WHERE id=%s", (session_id,)
            )
            session_err = validate_session_writable(session_row)
            if session_err:
                raise HTTPException(400, session_err)

        session_no = next_dated_no(conn, "ROZ")
        batch = cx_query_one(
            conn, "SELECT * FROM raw_batches WHERE id=%s FOR UPDATE", (raw_batch_id,)
        )
        if not batch:
            batch = cx_query_one(
                conn, "SELECT * FROM raw_batches WHERE internal_batch_no=%s FOR UPDATE",
                (raw_batch_id,),
            )
        if not batch:
            raise HTTPException(404, f"Partia nie znaleziona (raw_batch_id={raw_batch_id!r})")
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
                f"{round(kg_available, 2)} kg w partii {batch.get('internal_batch_no', '')}",
            )

        if worker_id and not worker_name:
            worker = cx_query_one(conn, "SELECT name FROM workers WHERE id=%s", (worker_id,))
            if worker:
                worker_name = worker["name"]

        # DOLICZANIE zamiast drugiego wiersza: ten sam pracownik dobiera z tej
        # samej partii → jedno otwarte pobranie rośnie (prod 2026-07-09:
        # Anatoli 135 + 300 zrobiło dwa niewidoczne wiersze zamiast 435).
        # Tylko w obrębie TEJ SAMEJ sesji — doliczenie do pobrania z innego
        # dnia byłoby niewidoczne na dzisiejszym HMI (kg schodzi, ekran nic
        # nie pokazuje).
        existing = cx_query_one(
            conn,
            "SELECT * FROM deboning_entries WHERE raw_batch_id=%s AND worker_id=%s "
            "AND status='pending' AND session_id IS NOT DISTINCT FROM %s "
            "ORDER BY created_at LIMIT 1 FOR UPDATE",
            (batch["id"], worker_id, session_id),
        )
        if existing:
            entry = cx_execute_returning(
                conn,
                "UPDATE deboning_entries SET kg_quarter = kg_quarter + %s, "
                "kg_remainder = kg_remainder + %s WHERE id=%s RETURNING *",
                (kg_taken, kg_taken, existing["id"]),
            )
            after = cx_execute_returning(
                conn,
                "UPDATE raw_batches SET kg_available = GREATEST(0, "
                "COALESCE(kg_available, kg_received) - %s) WHERE id = %s "
                "RETURNING kg_available",
                (kg_taken, batch["id"]),
            )
            updated = cx_execute_rowcount(
                conn,
                # ruchy OUT są zapisywane jako ujemne kg — doliczenie = odjęcie
                "UPDATE stock_movements SET qty = qty - %s "
                "WHERE source_type='deboning' AND source_id=%s AND movement_type='OUT'",
                (kg_taken, existing["id"]),
            )
            if not updated:
                create_stock_movement(
                    conn, product_type="raw", batch_id=batch["id"], qty=kg_taken,
                    movement_type="OUT", source_type="deboning", source_id=existing["id"],
                )
            logger.info(
                "deboning.take.merged",
                extra={"entry_id": existing["id"], "kg_added": kg_taken},
            )
        else:
            entry = cx_execute_returning(
                conn,
                """
                INSERT INTO deboning_entries
                    (id, raw_batch_id, raw_batch_no, session_id, session_no,
                     kg_quarter, kg_meat, kg_remainder, yield_pct,
                     worker_id, worker_name, status, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,0,%s,0,%s,%s,'pending',%s)
                RETURNING *
                """,
                (
                    entry_id, batch["id"], batch["internal_batch_no"], session_id, session_no,
                    kg_taken, kg_taken, worker_id, worker_name, now_iso(),
                ),
            )

            after = cx_execute_returning(
                conn,
                "UPDATE raw_batches SET kg_available = GREATEST(0, "
                "COALESCE(kg_available, kg_received) - %s) WHERE id = %s "
                "RETURNING kg_available",
                (kg_taken, batch["id"]),
            )
            create_stock_movement(
                conn, product_type="raw", batch_id=batch["id"], qty=kg_taken,
                movement_type="OUT", source_type="deboning", source_id=entry_id,
            )
            logger.info(
                "deboning.take.created", extra={"entry_id": entry_id, "kg_taken": kg_taken}
            )

    _auto_finish_exhausted(batch["id"], after["kg_available"] if after else None)
    return _map_deboning_entry(entry)  # type: ignore[arg-type]


def update_deboning_take(entry_id: str, dto) -> Dict:
    """Edycja OTWARTEGO pobrania (czeka na zważenie): zmiana kg pobranej
    ćwiartki. Różnica koryguje stan partii i ruch magazynowy OUT."""
    new_kg = float(dto.kg_taken)
    if new_kg <= 0:
        raise HTTPException(400, "Ilość pobranej ćwiartki musi być > 0")

    with transaction() as conn:
        entry = cx_query_one(
            conn, "SELECT * FROM deboning_entries WHERE id=%s FOR UPDATE", (entry_id,)
        )
        if not entry:
            raise HTTPException(404, "Pobranie nie znalezione")
        if (entry.get("status") or "complete") != "pending":
            raise HTTPException(409, "Edycja możliwa tylko dla pobrania czekającego na zważenie")

        batch = cx_query_one(
            conn, "SELECT * FROM raw_batches WHERE id=%s FOR UPDATE",
            (entry["raw_batch_id"],),
        )
        if not batch:
            raise HTTPException(404, "Partia pobrania nie istnieje")

        old_kg = float(entry.get("kg_quarter") or 0)
        diff = new_kg - old_kg
        kg_available = float(batch.get("kg_available") or 0)
        if diff > kg_available + 0.01:
            raise HTTPException(
                400,
                f"Nie można zwiększyć do {new_kg} kg — w partii zostało tylko "
                f"{round(kg_available, 2)} kg",
            )

        updated = cx_execute_returning(
            conn,
            "UPDATE deboning_entries SET kg_quarter=%s, kg_remainder=%s WHERE id=%s RETURNING *",
            (new_kg, new_kg, entry_id),
        )
        after = cx_execute_returning(
            conn,
            "UPDATE raw_batches SET kg_available = GREATEST(0, COALESCE(kg_available,0) - %s) "
            "WHERE id=%s RETURNING kg_available",
            (diff, batch["id"]),
        )
        moved = cx_execute_rowcount(
            conn,
            # ruchy OUT są zapisywane jako ujemne kg
            "UPDATE stock_movements SET qty=%s "
            "WHERE source_type='deboning' AND source_id=%s AND movement_type='OUT'",
            (-new_kg, entry_id),
        )
        if not moved:
            create_stock_movement(
                conn, product_type="raw", batch_id=batch["id"], qty=new_kg,
                movement_type="OUT", source_type="deboning", source_id=entry_id,
            )

    logger.info(
        "deboning.take.updated",
        extra={"entry_id": entry_id, "old_kg": old_kg, "new_kg": new_kg},
    )
    _auto_finish_exhausted(batch["id"], after["kg_available"] if after else None)
    return _map_deboning_entry(updated)  # type: ignore[arg-type]


def complete_deboning_take(entry_id: str, dto) -> Dict:
    """Faza 2: domknięcie pobrania mięsem. Tworzy lot mięsa + ABP, status→complete.
    Surowiec zszedł już w fazie 1 — tutaj nie ruszamy raw_batches."""
    kg_meat = float(dto.kg_meat)

    with transaction() as conn:
        entry = cx_query_one(
            conn, "SELECT * FROM deboning_entries WHERE id=%s FOR UPDATE", (entry_id,)
        )
        if not entry:
            raise HTTPException(404, "Pobranie nie znalezione")
        if (entry.get("status") or "complete") != "pending":
            raise HTTPException(409, "Pobranie już domknięte lub nie jest pobraniem")

        if entry.get("session_id"):
            session_row = cx_query_one(
                conn, "SELECT status FROM production_sessions WHERE id=%s",
                (entry["session_id"],),
            )
            session_err = validate_session_writable(session_row)
            if session_err:
                # Pobranie „przeszło przez noc": sesja z dnia pobrania jest już
                # zamknięta/zatwierdzona. Mięso waży się DZIŚ — przepinamy wpis
                # do otwartej sesji rozbioru, zamiast blokować domknięcie na
                # zawsze (kg zeszło z partii, musi dać się zważyć).
                open_s = cx_query_one(
                    conn,
                    "SELECT id FROM production_sessions WHERE process_type='deboning' "
                    "AND status='open' ORDER BY started_at DESC LIMIT 1",
                )
                if not open_s:
                    raise HTTPException(400, session_err)
                cx_execute(
                    conn,
                    "UPDATE deboning_entries SET session_id=%s WHERE id=%s",
                    (open_s["id"], entry_id),
                )
                logger.info(
                    "deboning.take.session_reassigned",
                    extra={"entry_id": entry_id, "new_session_id": open_s["id"]},
                )

        if dto.weigh_mode == "auto":
            weighing_err = validate_weighing_consistency(
                dto.kg_gross, dto.tare_cart_kg, dto.tare_e2_kg, kg_meat
            )
            if weighing_err:
                raise HTTPException(400, weighing_err)

        kg_taken = float(entry.get("kg_quarter") or 0)
        yield_err = validate_meat_yield(kg_taken, kg_meat)
        if yield_err:
            raise HTTPException(400, yield_err)

        kg_remainder = max(0, kg_taken - kg_meat)
        yield_pct = round((kg_meat / kg_taken) * 100, 2)

        row = cx_execute_returning(
            conn,
            """
            UPDATE deboning_entries
            SET kg_meat=%s, kg_remainder=%s, yield_pct=%s, status='complete',
                completed_at=now(),
                kg_gross=%s, tare_cart_kg=%s, tare_e2_kg=%s, e2_count=%s, weigh_mode=%s
            WHERE id=%s
            RETURNING *
            """,
            (
                kg_meat, kg_remainder, yield_pct,
                dto.kg_gross, dto.tare_cart_kg, dto.tare_e2_kg, dto.e2_count, dto.weigh_mode,
                entry_id,
            ),
        )

        from app.services.byproducts_service import create_byproduct_lots_for_entry
        create_byproduct_lots_for_entry(conn, row)

        batch = cx_query_one(
            conn, "SELECT * FROM raw_batches WHERE id=%s", (entry["raw_batch_id"],)
        )
        recv = batch.get("received_date") if batch else None
        if recv:
            try:
                exp = (datetime.fromisoformat(str(recv)) + timedelta(days=7)).date().isoformat()
            except Exception:
                exp = batch.get("expiry_date") if batch else None
        else:
            exp = batch.get("expiry_date") if batch else None

        meat_lot_no = entry["raw_batch_no"]
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
                meat_stock_id, meat_lot_no, entry_id, entry["session_no"],
                entry["raw_batch_id"], meat_lot_no, kg_meat, kg_meat, exp,
                "mat-mieso-zs", "Mięso z/s", now_iso(),
            ),
        )
        ms_row = cx_query_one(conn, "SELECT id FROM meat_stock WHERE lot_no=%s", (meat_lot_no,))
        real_ms_id = ms_row["id"] if ms_row else meat_stock_id
        create_stock_movement(
            conn, product_type="meat", batch_id=real_ms_id, qty=kg_meat,
            movement_type="IN", source_type="deboning", source_id=entry_id,
        )

    logger.info(
        "deboning.take.completed",
        extra={"entry_id": entry_id, "kg_taken": kg_taken, "kg_meat": kg_meat},
    )
    return _map_deboning_entry(row)  # type: ignore[arg-type]


def update_deboning_entry(entry_id: str, dto: DeboningEntryUpdate) -> Dict:
    with transaction() as conn:
        existing = cx_query_one(
            conn, "SELECT * FROM deboning_entries WHERE id=%s FOR UPDATE", (entry_id,)
        )
        if not existing:
            raise HTTPException(404, "Wpis rozbioru nie znaleziony")

        if existing.get("session_id"):
            session_row = cx_query_one(
                conn,
                "SELECT status FROM production_sessions WHERE id=%s",
                (existing["session_id"],),
            )
            session_err = validate_session_writable(session_row)
            if session_err:
                raise HTTPException(400, session_err)

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

        # Korekta stanów magazynowych przy zmianie kg (audyt 2026-07-05:
        # wcześniej PATCH kgTaken/kgMeat rozjeżdżał partię i lot mięsa).
        delta_taken = kg_taken - float(existing.get("kg_quarter") or 0)
        delta_meat = kg_meat - float(existing.get("kg_meat") or 0)
        raw_row = None
        meat_lot = None
        if abs(delta_taken) > 0.001:
            raw_row = cx_query_one(
                conn,
                "SELECT id, kg_available FROM raw_batches WHERE id=%s FOR UPDATE",
                (existing.get("raw_batch_id"),),
            )
        if abs(delta_meat) > 0.001:
            meat_lot = cx_query_one(
                conn,
                "SELECT id, kg_initial, kg_available FROM meat_stock WHERE lot_no=%s FOR UPDATE",
                (existing.get("raw_batch_no"),),
            )
        delta_err = validate_edit_deltas(
            delta_taken,
            float(raw_row["kg_available"]) if raw_row else None,
            delta_meat,
            float(meat_lot["kg_available"]) if meat_lot else None,
        )
        if delta_err:
            raise HTTPException(400, delta_err)
        if raw_row:
            cx_execute(
                conn,
                "UPDATE raw_batches SET kg_available = GREATEST(0, COALESCE(kg_available,0) - %s) WHERE id=%s",
                (delta_taken, raw_row["id"]),
            )
        if meat_lot:
            cx_execute(
                conn,
                """
                UPDATE meat_stock
                SET kg_initial = GREATEST(0, kg_initial + %s),
                    kg_available = GREATEST(0, kg_available + %s)
                WHERE id=%s
                """,
                (delta_meat, delta_meat, meat_lot["id"]),
            )

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

        # Storno POBRANIA (pending): odwraca tylko fazę 1 — oddaje surowiec,
        # kasuje ruch OUT i wiersz. Brak lotu mięsa i ABP do odwracania.
        if (entry.get("status") or "complete") == "pending":
            kg_taken = float(entry.get("kg_quarter") or 0)
            cx_execute(
                conn,
                "UPDATE raw_batches SET kg_available = COALESCE(kg_available,0) + %s WHERE id=%s",
                (kg_taken, entry.get("raw_batch_id")),
            )
            cx_execute(
                conn,
                "DELETE FROM stock_movements WHERE source_type='deboning' AND source_id=%s",
                (entry_id,),
            )
            cx_execute(conn, "DELETE FROM deboning_entries WHERE id=%s", (entry_id,))
            logger.info("deboning.take.undone", extra={"entry_id": entry_id, "kg_taken": kg_taken})
            return {"ok": True, "id": entry_id}

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
