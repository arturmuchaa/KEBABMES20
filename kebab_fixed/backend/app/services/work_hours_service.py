"""Ewidencja godzin pracowników ogólnych.

Dzień bywa NIEDOKOŃCZONY: biuro zapisuje rano sam start (pracownik melduje
się o 6:00), a koniec dopisuje po południu — czasem dopiero po dwóch dniach.
Dlatego `time_to` jest NULL-owalne, a `hours` liczy się dopiero po domknięciu.

Brak wiersza znaczy „jeszcze nie wpisane" i to zupełnie co innego niż wolne
— stąd osobna kolumna `status`, a nie wnioskowanie z pustych godzin.
"""
import re
from typing import Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, transaction
from app.logging_config import get_logger
from app.models.work_hours import StampDto, WorkHoursDto
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)

#: Kolejność ma znaczenie tylko dla czytelności — CHECK w bazie zna te same.
HOUR_STATUSES = ("work", "off", "vacation", "sick", "absent")

_HHMM = re.compile(r"^(\d{1,2}):(\d{2})$")
_DEC = re.compile(r"^(\d{1,2})(?:[.,](\d{1,2}))?$")


def parse_hhmm(value: str) -> int:
    """'6' → 360, '6:05' → 365, '8,5' → 510, '8,30' → 510. Minuty od północy.

    Dwukropek wymaga Shift, więc biuro wpisuje połówki przecinkiem. Cyfry po
    przecinku czytamy zależnie od ich liczby, bo oba zapisy są w użyciu:
      1 cyfra → ułamek godziny ('8,5'  = 8:30)
      2 cyfry → minuty         ('8,30' = 8:30, NIE 8:18)
    Bez tego rozróżnienia „8,30" wyszłoby 8:18 i po cichu zaniżyło wypłatę.
    Reguła MUSI być identyczna z parseTime() w src/lib/workHours.ts.
    """
    s = (value or "").strip()
    m = _HHMM.match(s)
    if m:
        hh, mm = int(m.group(1)), int(m.group(2))
        if hh > 23 or mm > 59:
            raise HTTPException(400, f"Zła godzina: {value!r} — poza dobą")
        return hh * 60 + mm

    d = _DEC.match(s)
    if not d:
        raise HTTPException(400, f"Zła godzina: {value!r} — użyj formatu 6:00")
    hh = int(d.group(1))
    frac = d.group(2)
    if frac is None:
        mm = 0
    elif len(frac) == 1:
        mm = round(int(frac) / 10 * 60)
    else:
        mm = int(frac)
    if hh > 23 or mm > 59:
        raise HTTPException(400, f"Zła godzina: {value!r} — poza dobą")
    return hh * 60 + mm


def compute_hours(
    time_from: Optional[str], time_to: Optional[str]
) -> Optional[float]:
    """None = zmiana otwarta (brak którejś godziny). Koniec wcześniejszy niż
    start znaczy zmianę przez północ, nie ujemny czas pracy."""
    if not time_from or not time_to:
        return None
    a = parse_hhmm(time_from)
    b = parse_hhmm(time_to)
    if a == b:
        raise HTTPException(400, "Godzina końca musi różnić się od początku")
    if b < a:
        b += 24 * 60
    return round((b - a) / 60.0, 2)


def _fmt(minutes: int) -> str:
    return f"{minutes // 60}:{minutes % 60:02d}"


# ── CRUD ──────────────────────────────────────────────────────────────

def _row_out(r: Dict) -> Dict:
    return {
        "id": r["id"],
        "workerId": r["worker_id"],
        "workDate": str(r["work_date"]),
        "status": r["status"],
        "timeFrom": r["time_from"] or "",
        "timeTo": r["time_to"] or "",
        "hours": float(r["hours"]) if r["hours"] is not None else None,
        "note": r.get("note") or "",
        # Dzień objęty rozliczeniem jest zamknięty — siatka rysuje kłódkę,
        # a zapis i tak odbiłby się od _assert_not_settled.
        "settled": bool(r.get("settled")),
    }


def _assert_not_settled(conn, worker_id: str, work_date: str) -> None:
    settled = cx_query_one(
        conn,
        "SELECT settlement_id FROM settled_days WHERE worker_id=%s AND work_date=%s",
        (worker_id, work_date),
    )
    if settled:
        raise HTTPException(400, f"Dzień {work_date} jest już rozliczony")


def upsert_hours(dto: WorkHoursDto) -> Dict:
    if dto.status not in HOUR_STATUSES:
        raise HTTPException(400, f"Nieznany status dnia: {dto.status!r}")

    if dto.status == "work":
        time_from = (dto.time_from or "").strip() or None
        time_to = (dto.time_to or "").strip() or None
        if not time_from:
            raise HTTPException(400, "Podaj godzinę rozpoczęcia")
        # Normalizacja: '6' wpisane w pośpiechu ma wylądować jako '6:00'.
        time_from = _fmt(parse_hhmm(time_from))
        time_to = _fmt(parse_hhmm(time_to)) if time_to else None
        hours = compute_hours(time_from, time_to)
    else:
        # Znacznik nieobecności nie niesie godzin — czyścimy, żeby nie
        # zostały po wcześniejszym wpisie roboczym.
        time_from = time_to = hours = None

    with transaction() as conn:
        worker = cx_query_one(
            conn, "SELECT id, role, active FROM workers WHERE id=%s", (dto.worker_id,)
        )
        if not worker:
            raise HTTPException(404, "Pracownik nie istnieje")
        if "GENERAL" not in (worker.get("role") or ""):
            raise HTTPException(400, "Godziny wpisuje się tylko pracownikom ogólnym")
        _assert_not_settled(conn, dto.worker_id, dto.work_date)

        cx_execute(
            conn,
            """
            INSERT INTO worker_hours
                (id, worker_id, work_date, status, time_from, time_to, hours,
                 note, created_by, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (worker_id, work_date) DO UPDATE SET
                status=EXCLUDED.status, time_from=EXCLUDED.time_from,
                time_to=EXCLUDED.time_to, hours=EXCLUDED.hours,
                note=EXCLUDED.note, updated_at=EXCLUDED.updated_at
            """,
            (cuid(), dto.worker_id, dto.work_date, dto.status, time_from,
             time_to, hours, dto.note or "", dto.created_by or "",
             now_iso(), now_iso()),
        )
        row = cx_query_one(
            conn,
            "SELECT * FROM worker_hours WHERE worker_id=%s AND work_date=%s",
            (dto.worker_id, dto.work_date),
        )
    assert row is not None
    return _row_out(row)


def list_hours(date_from: str, date_to: str) -> List[Dict]:
    """Wiersze wszystkich AKTYWNYCH pracowników ogólnych w zakresie."""
    rows = query_all(
        """
        SELECT h.*, (sd.settlement_id IS NOT NULL) AS settled
        FROM worker_hours h
        JOIN workers w ON w.id = h.worker_id
        LEFT JOIN settled_days sd
               ON sd.worker_id = h.worker_id AND sd.work_date = h.work_date
        WHERE w.active = true AND w.role = 'WORKER_GENERAL'
          AND h.work_date BETWEEN %s AND %s
        ORDER BY h.work_date, w.name
        """,
        (date_from, date_to),
    )
    return [_row_out(r) for r in rows]


def delete_hours(worker_id: str, work_date: str) -> Dict:
    with transaction() as conn:
        _assert_not_settled(conn, worker_id, work_date)
        cx_execute(
            conn,
            "DELETE FROM worker_hours WHERE worker_id=%s AND work_date=%s",
            (worker_id, work_date),
        )
    return {"ok": True}


# ── Stempel zbiorczy ──────────────────────────────────────────────────

def stamp_hours(dto: StampDto) -> Dict:
    """Stempel zbiorczy dnia. 'start' zakłada OTWARTE wpisy tam, gdzie
    jeszcze nic nie ma; 'end' domyka wpisy otwarte. Nigdy nie nadpisuje
    tego, co biuro wpisało ręcznie, i nie rusza dni rozliczonych."""
    if dto.mode not in ("start", "end"):
        raise HTTPException(400, "Tryb stempla: 'start' albo 'end'")
    time = _fmt(parse_hhmm(dto.time))
    changed = 0

    with transaction() as conn:
        settled = {
            r["worker_id"]
            for r in cx_query_all(
                conn,
                "SELECT worker_id FROM settled_days WHERE work_date=%s",
                (dto.work_date,),
            )
        }
        workers = cx_query_all(
            conn,
            "SELECT id FROM workers WHERE active=true AND role='WORKER_GENERAL'",
        )
        existing = {
            r["worker_id"]: r
            for r in cx_query_all(
                conn,
                "SELECT * FROM worker_hours WHERE work_date=%s",
                (dto.work_date,),
            )
        }

        for w in workers:
            wid = w["id"]
            if wid in settled:
                continue
            row = existing.get(wid)
            if dto.mode == "start":
                if row is not None:
                    continue
                cx_execute(
                    conn,
                    """
                    INSERT INTO worker_hours
                        (id, worker_id, work_date, status, time_from, time_to,
                         hours, note, created_at, updated_at)
                    VALUES (%s,%s,%s,'work',%s,NULL,NULL,'',%s,%s)
                    """,
                    (cuid(), wid, dto.work_date, time, now_iso(), now_iso()),
                )
                changed += 1
            else:
                if row is None or row["status"] != "work" or row["time_to"]:
                    continue
                hours = compute_hours(row["time_from"], time)
                cx_execute(
                    conn,
                    "UPDATE worker_hours SET time_to=%s, hours=%s, updated_at=%s "
                    "WHERE worker_id=%s AND work_date=%s",
                    (time, hours, now_iso(), wid, dto.work_date),
                )
                changed += 1

    logger.info(
        "payroll.hours.stamp",
        extra={"work_date": dto.work_date, "mode": dto.mode, "changed": changed},
    )
    return {"changed": changed}
