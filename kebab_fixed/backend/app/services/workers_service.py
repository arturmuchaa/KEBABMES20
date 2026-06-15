"""Workers + payroll (worker days, settlements)."""
import json
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
from app.models.workers import CreateSettlementDto, WorkerCreate, WorkerUpdate
from app.utils.ids import cuid, now_iso
from app.utils.passwords import hash_secret

logger = get_logger(__name__)


# ── CRUD ──────────────────────────────────────────────────────────────

def list_workers() -> List[Dict]:
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
                 contract_type, employer_cost_amount, created_at)
            VALUES (%s,%s,%s,NULL,%s,%s,true,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                cuid(),
                dto.name,
                dto.role,
                pin_hash,
                departments_json,
                dto.rate_per_kg,
                dto.contract_type,
                dto.employer_cost_amount,
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
              AND DATE(created_at AT TIME ZONE 'Europe/Warsaw') BETWEEN %s AND %s
            GROUP BY DATE(created_at AT TIME ZONE 'Europe/Warsaw')
            ORDER BY work_date
            """,
            (worker_id, date_from, date_to),
        )
        return [
            {
                "workDate": str(r["work_date"]),
                "kgTotal": float(r["kg_total"] or 0),
                "kgMeat": float(r["kg_meat"] or 0),
                "entriesCount": int(r["entries_count"] or 0),
                "settled": str(r["work_date"]) in settled_dates,
            }
            for r in rows
        ]

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
        return [
            {
                "workDate": str(r["work_date"]),
                "kgTotal": float(r["kg_total"] or 0),
                "sessionCount": int(r["session_count"] or 0),
                "settled": str(r["work_date"]) in settled_dates,
            }
            for r in rows
        ]

    return []


# ── Settlements ───────────────────────────────────────────────────────

def create_settlement(dto: CreateSettlementDto) -> Dict:
    kg_total = round(
        sum(dto.kg_per_date.get(d, 0) for d in dto.work_dates), 3
    )
    gross_amount = round(kg_total * dto.rate_per_kg, 2)
    deductions_total = round(sum(d.amount for d in dto.deductions), 2)
    net_amount = round(gross_amount - deductions_total, 2)
    sid = cuid()
    work_dates_detail = json.dumps(
        [
            {"work_date": d, "kg": dto.kg_per_date.get(d, 0)}
            for d in sorted(dto.work_dates)
        ]
    )

    with transaction() as conn:
        worker = cx_query_one(
            conn, "SELECT * FROM workers WHERE id=%s FOR UPDATE", (dto.worker_id,)
        )
        if not worker:
            raise HTTPException(404, "Pracownik nie istnieje")

        for d in dto.work_dates:
            already = cx_query_one(
                conn,
                "SELECT 1 FROM settled_days WHERE worker_id=%s AND work_date=%s",
                (dto.worker_id, d),
            )
            if already:
                raise HTTPException(400, f"Dzień {d} jest już rozliczony")

        employer_cost_amount = float(worker.get("employer_cost_amount") or 0)
        cx_execute(
            conn,
            """
            INSERT INTO payroll_settlements
                (id, worker_id, worker_name, worker_role,
                 date_from, date_to, kg_total, rate_per_kg,
                 gross_amount, employer_cost_pct, employer_cost_amount,
                 deductions_total, net_amount, contract_type,
                 work_dates_detail, notes, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
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
