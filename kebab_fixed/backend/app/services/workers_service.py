"""Workers + payroll (worker days, settlements)."""
import json
from datetime import date as _date
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import (
    cx_execute,
    cx_execute_returning,
    cx_query_all,
    cx_query_one,
    query_all,
    query_one,
    transaction,
)
from app.logging_config import get_logger
from app.models.workers import (
    CreateSettlementDto,
    KgAdjustmentDto,
    WorkerCreate,
    WorkerDeductionDto,
    WorkerUpdate,
)
from app.utils.ids import cuid, now_iso
from app.utils.passwords import hash_secret

logger = get_logger(__name__)


# ── CRUD ──────────────────────────────────────────────────────────────

def list_workers(include_inactive: bool = False) -> List[Dict]:
    """Domyślnie tylko aktywni — z tej listy żyją panele hali i kioski
    rozbioru, więc zarchiwizowany ma z nich zniknąć natychmiast.
    `include_inactive` używa wyłącznie biuro (Pracownicy, Rozliczenia)."""
    if include_inactive:
        return query_all("SELECT * FROM workers ORDER BY active DESC, name")
    return query_all("SELECT * FROM workers WHERE active = true ORDER BY name")


def create_worker(dto: WorkerCreate) -> Dict:
    pin_hash = hash_secret(dto.pin) if dto.pin else None
    departments_json = json.dumps(dto.departments or [])
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO workers
                (id, name, role, pin, pin_hash, departments, active, rate_per_kg,
                 rate_per_hour, sunday_bonus_enabled, sunday_bonus_per_hour,
                 contract_type, employer_cost_amount, crew_size, created_at)
            VALUES (%s,%s,%s,NULL,%s,%s,true,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                cuid(),
                dto.name,
                dto.role,
                pin_hash,
                departments_json,
                dto.rate_per_kg,
                dto.rate_per_hour,
                dto.sunday_bonus_enabled,
                dto.sunday_bonus_per_hour,
                dto.contract_type,
                dto.employer_cost_amount,
                max(1, int(dto.crew_size or 1)),
                now_iso(),
            ),
        )
    assert row is not None
    logger.info("worker.created", extra={"worker_id": row["id"]})
    return row


def update_worker(worker_id: str, dto: WorkerUpdate) -> Dict:
    with transaction() as conn:
        existing = cx_query_one(
            conn, "SELECT * FROM workers WHERE id=%s FOR UPDATE", (worker_id,)
        )
        if not existing:
            raise HTTPException(404, "Pracownik nie istnieje")
        fields: List[str] = []
        vals: List[Any] = []
        if dto.name is not None:
            fields.append("name=%s")
            vals.append(dto.name)
        if dto.role is not None:
            fields.append("role=%s")
            vals.append(dto.role)
        if dto.pin is not None:
            if dto.pin:
                fields.append("pin_hash=%s")
                vals.append(hash_secret(dto.pin))
            # never store plaintext pin; leave pin column untouched
        if dto.rate_per_kg is not None:
            fields.append("rate_per_kg=%s")
            vals.append(dto.rate_per_kg)
        if dto.rate_per_hour is not None:
            fields.append("rate_per_hour=%s")
            vals.append(dto.rate_per_hour)
        if dto.sunday_bonus_enabled is not None:
            fields.append("sunday_bonus_enabled=%s")
            vals.append(dto.sunday_bonus_enabled)
        if dto.sunday_bonus_per_hour is not None:
            fields.append("sunday_bonus_per_hour=%s")
            vals.append(dto.sunday_bonus_per_hour)
        if dto.crew_size is not None:
            fields.append("crew_size=%s")
            vals.append(max(1, int(dto.crew_size)))
        if dto.contract_type is not None:
            fields.append("contract_type=%s")
            vals.append(dto.contract_type)
        if dto.employer_cost_amount is not None:
            fields.append("employer_cost_amount=%s")
            vals.append(dto.employer_cost_amount)
        if dto.active is not None:
            fields.append("active=%s")
            vals.append(dto.active)
        if dto.departments is not None:
            fields.append("departments=%s")
            vals.append(json.dumps(dto.departments))
        if not fields:
            return existing
        vals.append(worker_id)
        row = cx_execute_returning(
            conn,
            f"UPDATE workers SET {', '.join(fields)} WHERE id=%s RETURNING *",
            vals,
        )
    assert row is not None
    logger.info("worker.updated", extra={"worker_id": worker_id})
    return row


# ── Worker days (payroll basis) ───────────────────────────────────────

def _apply_kg_adjustments(
    worker_id: str,
    date_from: str,
    date_to: str,
    days: List[Dict],
    settled_dates: set,
) -> List[Dict]:
    """Dolicza korekty kg liczone WYŁĄCZNIE do płacy (praca nieujęta
    w ważeniu). Zmierzone wagi zostają nietknięte — korekta jest osobną,
    jawną pozycją, więc podstawa rozliczenia rozjeżdża się z produkcją
    tylko tam, gdzie biuro świadomie tak zdecydowało."""
    rows = query_all(
        """
        SELECT work_date::text AS work_date, SUM(kg_delta) AS kg_delta
        FROM payroll_kg_adjustments
        WHERE worker_id=%s AND work_date BETWEEN %s AND %s
        GROUP BY work_date
        """,
        (worker_id, date_from, date_to),
    )
    adj = {r["work_date"]: float(r["kg_delta"] or 0) for r in rows}
    if not adj:
        return days

    for d in days:
        delta = adj.pop(d["workDate"], 0.0)
        if delta:
            d["kgMeasured"] = d["kgTotal"]
            d["kgAdjustment"] = delta
            d["kgTotal"] = round(d["kgTotal"] + delta, 3)

    # korekta na dzień bez wpisów produkcyjnych — też musi trafić do płacy
    for date, delta in adj.items():
        days.append(
            {
                "workDate": date,
                "kgTotal": round(delta, 3),
                "kgMeasured": 0.0,
                "kgAdjustment": delta,
                "entriesCount": 0,
                "settled": date in settled_dates,
            }
        )

    return sorted(days, key=lambda d: d["workDate"])


def get_worker_days(worker_id: str, date_from: str, date_to: str) -> List[Dict]:
    worker = query_one("SELECT * FROM workers WHERE id=%s", (worker_id,))
    if not worker:
        raise HTTPException(404, "Pracownik nie istnieje")
    role = worker.get("role", "") or ""

    settled_rows = query_all(
        "SELECT work_date::text FROM settled_days "
        "WHERE worker_id=%s AND work_date BETWEEN %s AND %s",
        (worker_id, date_from, date_to),
    )
    settled_dates = {r["work_date"] for r in settled_rows}

    if "DEBONING" in role:
        rows = query_all(
            """
            SELECT DATE(created_at AT TIME ZONE 'Europe/Warsaw') AS work_date,
                   SUM(kg_quarter) AS kg_total,
                   SUM(kg_meat)    AS kg_meat,
                   COUNT(*)        AS entries_count
            FROM deboning_entries
            WHERE worker_id=%s
              AND COALESCE(status, 'complete') = 'complete'
              AND DATE(created_at AT TIME ZONE 'Europe/Warsaw') BETWEEN %s AND %s
            GROUP BY DATE(created_at AT TIME ZONE 'Europe/Warsaw')
            ORDER BY work_date
            """,
            (worker_id, date_from, date_to),
        )
        days = [
            {
                "workDate": str(r["work_date"]),
                "kgTotal": float(r["kg_total"] or 0),
                "kgMeat": float(r["kg_meat"] or 0),
                "entriesCount": int(r["entries_count"] or 0),
                "settled": str(r["work_date"]) in settled_dates,
            }
            for r in rows
        ]
        return _apply_kg_adjustments(
            worker_id, date_from, date_to, days, settled_dates
        )

    if "PRODUCTION" in role:
        worker_name = worker.get("name", "") or ""
        rows = query_all(
            """
            SELECT DATE(added_at AT TIME ZONE 'Europe/Warsaw') AS work_date,
                   SUM(total_kg) AS kg_total,
                   COUNT(*)      AS session_count
            FROM finished_goods_sessions
            WHERE %s = ANY(worker_names)
              AND DATE(added_at AT TIME ZONE 'Europe/Warsaw') BETWEEN %s AND %s
            GROUP BY DATE(added_at AT TIME ZONE 'Europe/Warsaw')
            ORDER BY work_date
            """,
            (worker_name, date_from, date_to),
        )
        days = [
            {
                "workDate": str(r["work_date"]),
                "kgTotal": float(r["kg_total"] or 0),
                "sessionCount": int(r["session_count"] or 0),
                "settled": str(r["work_date"]) in settled_dates,
            }
            for r in rows
        ]
        return _apply_kg_adjustments(
            worker_id, date_from, date_to, days, settled_dates
        )

    if "GENERAL" in role:
        # Podstawą jest czas pracy, nie kilogramy — korekt kg tu nie ma
        # z definicji (_apply_kg_adjustments dotyczy akordu).
        rows = query_all(
            """
            SELECT work_date::text AS work_date, status, time_from, time_to, hours
            FROM worker_hours
            WHERE worker_id=%s AND work_date BETWEEN %s AND %s
            ORDER BY work_date
            """,
            (worker_id, date_from, date_to),
        )
        return [
            {
                "workDate": r["work_date"],
                "status": r["status"],
                "timeFrom": r["time_from"] or "",
                "timeTo": r["time_to"] or "",
                "hours": float(r["hours"]) if r["hours"] is not None else 0.0,
                # Zmiana bez godziny końca — do rozliczenia NIE wolno jej brać,
                # bo weszłaby jako 0 h.
                "open": r["status"] == "work" and not r["time_to"],
                "settled": r["work_date"] in settled_dates,
            }
            for r in rows
        ]

    return []


def pending_kg_days(worker_id: str, date_from: str, date_to: str) -> Dict:
    """Nierozliczone dni AKORDOWE pracownika — dla ogólnych to sygnał, że
    ktoś przeszedł z rozbioru na godziny i zostawił niezapłacone kilogramy.
    Podstawa rozliczenia idzie za bieżącą rolą, więc bez tej informacji
    takie dni zniknęłyby z ekranu bez śladu."""
    row = query_one(
        """
        SELECT COUNT(*) AS days, COALESCE(SUM(d.kg), 0) AS kg
        FROM (
            SELECT DATE(created_at AT TIME ZONE 'Europe/Warsaw') AS work_date,
                   SUM(kg_quarter) AS kg
            FROM deboning_entries
            WHERE worker_id=%s
              AND COALESCE(status, 'complete') = 'complete'
              AND DATE(created_at AT TIME ZONE 'Europe/Warsaw') BETWEEN %s AND %s
            GROUP BY 1
        ) d
        LEFT JOIN settled_days s
               ON s.worker_id = %s AND s.work_date = d.work_date
        WHERE s.settlement_id IS NULL
        """,
        (worker_id, date_from, date_to, worker_id),
    )
    return {"days": int(row["days"] or 0), "kg": float(row["kg"] or 0)}


# ── Korekty kg do płacy ───────────────────────────────────────────────

def list_kg_adjustments(worker_id: str, date_from: str, date_to: str) -> List[Dict]:
    rows = query_all(
        """
        SELECT id, work_date::text AS work_date, kg_delta, reason,
               created_by, created_at
        FROM payroll_kg_adjustments
        WHERE worker_id=%s AND work_date BETWEEN %s AND %s
        ORDER BY work_date, created_at
        """,
        (worker_id, date_from, date_to),
    )
    return [
        {
            "id": r["id"],
            "workDate": r["work_date"],
            "kgDelta": float(r["kg_delta"] or 0),
            "reason": r["reason"],
            "createdBy": r.get("created_by") or "",
            "createdAt": str(r["created_at"]),
        }
        for r in rows
    ]


def create_kg_adjustment(dto: KgAdjustmentDto) -> Dict:
    """Korekta kilogramów doliczana tylko do rozliczenia pracownika.
    Nie tworzy żadnego ruchu magazynowego i nie zmienia wpisów rozbioru."""
    if not dto.reason.strip():
        raise HTTPException(400, "Podaj powód korekty")
    if dto.kg_delta == 0:
        raise HTTPException(400, "Korekta nie może być zerowa")

    worker = query_one("SELECT * FROM workers WHERE id=%s", (dto.worker_id,))
    if not worker:
        raise HTTPException(404, "Pracownik nie istnieje")

    settled = query_one(
        "SELECT settlement_id FROM settled_days WHERE worker_id=%s AND work_date=%s",
        (dto.worker_id, dto.work_date),
    )
    if settled:
        raise HTTPException(
            400, f"Dzień {dto.work_date} jest już rozliczony — korekta nic nie zmieni"
        )

    aid = cuid()
    execute_sql = (
        "INSERT INTO payroll_kg_adjustments "
        "(id, worker_id, work_date, kg_delta, reason, created_by, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s)"
    )
    with transaction() as conn:
        cx_execute(
            conn,
            execute_sql,
            (
                aid,
                dto.worker_id,
                dto.work_date,
                dto.kg_delta,
                dto.reason.strip(),
                dto.created_by or "",
                now_iso(),
            ),
        )
    logger.info(
        "payroll.kg_adjustment.created",
        extra={
            "adjustment_id": aid,
            "worker_id": dto.worker_id,
            "work_date": dto.work_date,
            "kg_delta": dto.kg_delta,
        },
    )
    return {
        "id": aid,
        "workDate": dto.work_date,
        "kgDelta": dto.kg_delta,
        "reason": dto.reason.strip(),
    }


# ── Potrącenia oczekujące ─────────────────────────────────────────────

def _deduction_out(r: Dict) -> Dict:
    return {
        "id": r["id"],
        "workerId": r["worker_id"],
        "deductionDate": str(r["deduction_date"]),
        "description": r["description"],
        "amount": float(r["amount"] or 0),
        "sourceType": r.get("source_type") or "manual",
        "sourceId": r.get("source_id"),
        "status": r.get("status") or "pending",
        "settlementId": r.get("settlement_id"),
    }


def create_worker_deduction(dto: WorkerDeductionDto) -> Dict:
    """Potrącenie znane np. w poniedziałek nie musi już czekać na kartce
    do piątku — leży w rejestrze i wchodzi do rozliczenia obejmującego
    jego datę."""
    if not dto.description.strip():
        raise HTTPException(400, "Podaj opis potrącenia")
    if not dto.amount or dto.amount <= 0:
        raise HTTPException(400, "Kwota potrącenia musi być większa od zera")
    worker = query_one("SELECT id FROM workers WHERE id=%s", (dto.worker_id,))
    if not worker:
        raise HTTPException(404, "Pracownik nie istnieje")

    did = cuid()
    with transaction() as conn:
        cx_execute(
            conn,
            """
            INSERT INTO worker_deductions
                (id, worker_id, deduction_date, description, amount,
                 source_type, source_id, status, created_by, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,'pending',%s,%s)
            """,
            (did, dto.worker_id, dto.deduction_date, dto.description.strip(),
             round(dto.amount, 2), dto.source_type, dto.source_id,
             dto.created_by or "", now_iso()),
        )
        row = cx_query_one(
            conn, "SELECT * FROM worker_deductions WHERE id=%s", (did,)
        )
    assert row is not None
    logger.info(
        "payroll.deduction.created",
        extra={"deduction_id": did, "worker_id": dto.worker_id,
               "amount": dto.amount, "source_type": dto.source_type},
    )
    return _deduction_out(row)


def list_worker_deductions(worker_id: str, status: str = "pending") -> List[Dict]:
    rows = query_all(
        "SELECT * FROM worker_deductions WHERE worker_id=%s AND status=%s "
        "ORDER BY deduction_date, created_at",
        (worker_id, status),
    )
    return [_deduction_out(r) for r in rows]


def cancel_worker_deduction(deduction_id: str) -> Dict:
    """Anulowanie zostawia ślad (status), nie kasuje wiersza."""
    with transaction() as conn:
        row = cx_query_one(
            conn,
            "SELECT status FROM worker_deductions WHERE id=%s FOR UPDATE",
            (deduction_id,),
        )
        if not row:
            raise HTTPException(404, "Potrącenie nie istnieje")
        if row["status"] == "settled":
            raise HTTPException(400, "Potrącenie jest już rozliczone")
        cx_execute(
            conn,
            "UPDATE worker_deductions SET status='cancelled' WHERE id=%s",
            (deduction_id,),
        )
    return {"ok": True}


# ── Dopasowanie odbiorcy WZ do pracownika ─────────────────────────────

def normalize_worker_name(value: Optional[str]) -> str:
    return " ".join((value or "").split()).casefold()


def match_worker_by_name(name: str, nip: str = "") -> Optional[Dict]:
    """Zwraca pracownika TYLKO gdy NIP jest pusty (firma ma NIP, pracownik
    nie) i nazwa pasuje DOKŁADNIE do jednego aktywnego pracownika.
    Zero dopasowania rozmytego — pomyłka kosztowałaby kogoś pieniądze."""
    if (nip or "").strip():
        return None
    needle = normalize_worker_name(name)
    if not needle:
        return None
    rows = query_all("SELECT id, name, role FROM workers WHERE active = true")
    hits = [r for r in rows if normalize_worker_name(r["name"]) == needle]
    if len(hits) != 1:
        return None
    return {"workerId": hits[0]["id"], "name": hits[0]["name"], "role": hits[0]["role"]}


# ── Settlements ───────────────────────────────────────────────────────

def _is_sunday(iso_date: str) -> bool:
    return _date.fromisoformat(iso_date).weekday() == 6


def create_settlement(dto: CreateSettlementDto) -> Dict:
    sid = cuid()

    with transaction() as conn:
        worker = cx_query_one(
            conn, "SELECT * FROM workers WHERE id=%s FOR UPDATE", (dto.worker_id,)
        )
        if not worker:
            raise HTTPException(404, "Pracownik nie istnieje")

        # Podstawa idzie za BIEŻĄCĄ rolą: ogólny płaci się od godzin,
        # rozbiór i produkcja od kilogramów.
        basis = "hours" if "GENERAL" in (worker.get("role") or "") else "kg"
        sunday_bonus = (
            float(worker.get("sunday_bonus_per_hour") or 0)
            if worker.get("sunday_bonus_enabled") else 0.0
        )
        if basis == "hours":
            hours_total = round(
                sum(dto.hours_per_date.get(d, 0) for d in dto.work_dates), 2
            )
            # Premia liczy się WYŁĄCZNIE od godzin niedzielnych — reszta
            # tygodnia idzie po stawce podstawowej.
            sunday_hours = round(
                sum(dto.hours_per_date.get(d, 0)
                    for d in dto.work_dates if _is_sunday(d)),
                2,
            )
            kg_total = 0.0
            gross_amount = round(
                hours_total * dto.rate_per_hour + sunday_hours * sunday_bonus, 2
            )
            # Godziny od–do idą na pasek: pracownik musi móc sprawdzić dzień,
            # a sama suma mu tego nie daje. Źródłem jest worker_hours, nie
            # front — dokument ma odbijać to, co faktycznie zapisano.
            shifts = {
                str(r["work_date"]): r
                for r in cx_query_all(
                    conn,
                    "SELECT work_date, time_from, time_to FROM worker_hours "
                    "WHERE worker_id=%s AND work_date::text = ANY(%s)",
                    (dto.worker_id, list(dto.work_dates)),
                )
            }
            work_dates_detail = json.dumps(
                [{"work_date": d, "hours": dto.hours_per_date.get(d, 0),
                  "sunday": _is_sunday(d),
                  "time_from": (shifts.get(d) or {}).get("time_from") or "",
                  "time_to": (shifts.get(d) or {}).get("time_to") or ""}
                 for d in sorted(dto.work_dates)]
            )
        else:
            hours_total = 0.0
            sunday_hours = 0.0
            sunday_bonus = 0.0
            kg_total = round(
                sum(dto.kg_per_date.get(d, 0) for d in dto.work_dates), 3
            )
            gross_amount = round(kg_total * dto.rate_per_kg, 2)
            work_dates_detail = json.dumps(
                [{"work_date": d, "kg": dto.kg_per_date.get(d, 0)}
                 for d in sorted(dto.work_dates)]
            )

        for d in dto.work_dates:
            already = cx_query_one(
                conn,
                "SELECT 1 FROM settled_days WHERE worker_id=%s AND work_date=%s",
                (dto.worker_id, d),
            )
            if already:
                raise HTTPException(400, f"Dzień {d} jest już rozliczony")

        # Potrącenia oczekujące: blokada wierszy, żeby dwa równoległe
        # rozliczenia nie zjadły tego samego potrącenia dwa razy.
        pending: List[Dict] = []
        for did in dto.deduction_ids:
            row = cx_query_one(
                conn,
                "SELECT * FROM worker_deductions WHERE id=%s FOR UPDATE",
                (did,),
            )
            if not row:
                raise HTTPException(404, f"Potrącenie {did} nie istnieje")
            if row["worker_id"] != dto.worker_id:
                raise HTTPException(400, "Potrącenie należy do innego pracownika")
            if row["status"] != "pending":
                raise HTTPException(
                    400, f"Potrącenie „{row['description']}” nie jest już oczekujące"
                )
            dd = str(row["deduction_date"])
            if not (dto.date_from <= dd <= dto.date_to):
                raise HTTPException(
                    400,
                    f"Potrącenie „{row['description']}” z {dd} jest poza zakresem "
                    f"{dto.date_from}–{dto.date_to}",
                )
            pending.append(row)

        deductions_total = round(
            sum(d.amount for d in dto.deductions)
            + sum(float(r["amount"] or 0) for r in pending),
            2,
        )
        net_amount = round(gross_amount - deductions_total, 2)
        employer_cost_amount = float(worker.get("employer_cost_amount") or 0)
        cx_execute(
            conn,
            """
            INSERT INTO payroll_settlements
                (id, worker_id, worker_name, worker_role,
                 date_from, date_to, kg_total, rate_per_kg,
                 hours_total, rate_per_hour, basis,
                 sunday_hours, sunday_bonus_per_hour,
                 gross_amount, employer_cost_pct, employer_cost_amount,
                 deductions_total, net_amount, contract_type,
                 work_dates_detail, notes, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                sid,
                dto.worker_id,
                worker["name"],
                worker.get("role"),
                dto.date_from,
                dto.date_to,
                kg_total,
                dto.rate_per_kg,
                hours_total,
                dto.rate_per_hour,
                basis,
                sunday_hours,
                sunday_bonus,
                gross_amount,
                0,
                employer_cost_amount,
                deductions_total,
                net_amount,
                worker.get("contract_type", "zlecenie"),
                work_dates_detail,
                dto.notes,
                now_iso(),
            ),
        )
        for ded in dto.deductions:
            cx_execute(
                conn,
                """
                INSERT INTO settlement_deductions
                    (id, settlement_id, description, amount)
                VALUES (%s,%s,%s,%s)
                """,
                (cuid(), sid, ded.description, ded.amount),
            )
        # Rejestr przepisuje się do settlement_deductions, które zostaje
        # JEDYNYM źródłem dla paska wypłaty i druku zbiorczego.
        for row in pending:
            cx_execute(
                conn,
                "INSERT INTO settlement_deductions (id, settlement_id, description, amount) "
                "VALUES (%s,%s,%s,%s)",
                (cuid(), sid, row["description"], row["amount"]),
            )
            cx_execute(
                conn,
                "UPDATE worker_deductions SET status='settled', settlement_id=%s WHERE id=%s",
                (sid, row["id"]),
            )
        for d in dto.work_dates:
            cx_execute(
                conn,
                """
                INSERT INTO settled_days (worker_id, work_date, settlement_id)
                VALUES (%s,%s,%s)
                ON CONFLICT DO NOTHING
                """,
                (dto.worker_id, d, sid),
            )

        row = cx_query_one(
            conn, "SELECT * FROM payroll_settlements WHERE id=%s", (sid,)
        )
        assert row is not None
        row["deductions"] = cx_query_all(
            conn,
            "SELECT * FROM settlement_deductions WHERE settlement_id=%s",
            (sid,),
        )
    row["date_from"] = str(row["date_from"])
    row["date_to"] = str(row["date_to"])
    logger.info(
        "payroll.settlement.created",
        extra={
            "settlement_id": sid,
            "worker_id": dto.worker_id,
            "kg_total": kg_total,
            "net": net_amount,
        },
    )
    return row


def list_settlements(worker_id: Optional[str]) -> List[Dict]:
    if worker_id:
        rows = query_all(
            "SELECT * FROM payroll_settlements WHERE worker_id=%s "
            "ORDER BY created_at DESC",
            (worker_id,),
        )
    else:
        rows = query_all(
            "SELECT * FROM payroll_settlements ORDER BY created_at DESC LIMIT 100"
        )
    for r in rows:
        r["date_from"] = str(r["date_from"])
        r["date_to"] = str(r["date_to"])
    return rows


def get_settlement(sid: str) -> Dict:
    row = query_one("SELECT * FROM payroll_settlements WHERE id=%s", (sid,))
    if not row:
        raise HTTPException(404, "Rozliczenie nie istnieje")
    row["deductions"] = query_all(
        "SELECT * FROM settlement_deductions WHERE settlement_id=%s", (sid,)
    )
    row["date_from"] = str(row["date_from"])
    row["date_to"] = str(row["date_to"])
    return row
