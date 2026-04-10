"""Startup migrations — idempotent schema changes run once at boot.

Every statement MUST be safe to re-run (IF NOT EXISTS, ADD COLUMN IF NOT EXISTS).
Never DROP or ALTER TYPE in a way that destroys data.
"""
from app.db import execute, query_all, query_one
from app.logging_config import get_logger

logger = get_logger(__name__)

_DDL: list[str] = [
    # ── Product types ──
    "ALTER TABLE product_types ADD COLUMN IF NOT EXISTS description TEXT",
    "ALTER TABLE product_types ADD COLUMN IF NOT EXISTS components JSONB DEFAULT '[]'",

    # ── Traceability v2 — batch→batch lineage ──
    "ALTER TABLE seasoned_meat ADD COLUMN IF NOT EXISTS source_deboning_ids TEXT[] DEFAULT '{}'",
    "ALTER TABLE mixing_orders ADD COLUMN IF NOT EXISTS source_seasoned_batch_ids TEXT[] DEFAULT '{}'",
    "ALTER TABLE production_sessions ADD COLUMN IF NOT EXISTS source_mixing_batch_ids TEXT[] DEFAULT '{}'",
    "ALTER TABLE production_sessions ADD COLUMN IF NOT EXISTS batch_allocation JSONB DEFAULT '{}'",
    "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS source_production_id TEXT",
    "ALTER TABLE production_plan_lines ADD COLUMN IF NOT EXISTS batch_allocation JSONB DEFAULT '{}'",
    "ALTER TABLE production_plan_lines ADD COLUMN IF NOT EXISTS seasoned_batch_nos TEXT[] DEFAULT '{}'",

    # ── Traceability v3 — full chain in production_sessions + finished_goods ──
    "ALTER TABLE production_sessions ADD COLUMN IF NOT EXISTS source_seasoned_ids TEXT[] DEFAULT '{}'",
    "ALTER TABLE production_sessions ADD COLUMN IF NOT EXISTS source_deboning_ids TEXT[] DEFAULT '{}'",
    "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS source_mixing_ids TEXT[] DEFAULT '{}'",
    "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS source_seasoned_ids TEXT[] DEFAULT '{}'",
    "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS source_deboning_ids TEXT[] DEFAULT '{}'",

    # ── Stock reservation model ──
    "ALTER TABLE meat_stock ADD COLUMN IF NOT EXISTS kg_reserved NUMERIC(10,3) DEFAULT 0",
    "ALTER TABLE meat_stock ADD COLUMN IF NOT EXISTS kg_used NUMERIC(10,3) DEFAULT 0",

    # ── Mixing machine tracking ──
    "ALTER TABLE mixing_orders ADD COLUMN IF NOT EXISTS kg_in_machine NUMERIC(10,3) DEFAULT 0",

    # ── Worker payroll fields ──
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS rate_per_kg NUMERIC(10,4) DEFAULT 0",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS contract_type TEXT DEFAULT 'zlecenie'",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS employer_cost_pct NUMERIC(5,2) DEFAULT 0",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS employer_cost_amount NUMERIC(10,2) DEFAULT 0",

    # ── Payroll tables ──
    """CREATE TABLE IF NOT EXISTS payroll_settlements (
        id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        worker_name TEXT NOT NULL,
        worker_role TEXT,
        date_from DATE NOT NULL,
        date_to DATE NOT NULL,
        kg_total NUMERIC(10,3) DEFAULT 0,
        rate_per_kg NUMERIC(10,4) DEFAULT 0,
        gross_amount NUMERIC(10,2) DEFAULT 0,
        employer_cost_pct NUMERIC(5,2) DEFAULT 0,
        employer_cost_amount NUMERIC(10,2) DEFAULT 0,
        deductions_total NUMERIC(10,2) DEFAULT 0,
        net_amount NUMERIC(10,2) DEFAULT 0,
        contract_type TEXT DEFAULT 'zlecenie',
        work_dates_detail JSONB DEFAULT '[]',
        notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS settlement_deductions (
        id TEXT PRIMARY KEY,
        settlement_id TEXT NOT NULL,
        description TEXT NOT NULL,
        amount NUMERIC(10,2) NOT NULL
    )""",
    "ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS work_dates_detail JSONB DEFAULT '[]'",
    """CREATE TABLE IF NOT EXISTS settled_days (
        worker_id TEXT NOT NULL,
        work_date DATE NOT NULL,
        settlement_id TEXT NOT NULL,
        PRIMARY KEY (worker_id, work_date)
    )""",
]


def run_migrations() -> None:
    """Execute all idempotent DDL statements, then seed data."""
    logger.info("migrations.start", extra={"count": len(_DDL)})
    for sql in _DDL:
        try:
            execute(sql)
        except Exception as exc:
            logger.warning(
                "migrations.statement_failed",
                extra={"sql": sql[:120], "error": str(exc)},
            )

    _seed_water()
    _seed_mixed_seq()
    _backfill_lineage()
    logger.info("migrations.done")


def _seed_water() -> None:
    """Ensure the unlimited ingredient (water) exists."""
    try:
        existing = query_one(
            "SELECT id FROM ingredients WHERE is_unlimited = true LIMIT 1"
        )
        if not existing:
            execute(
                "INSERT INTO ingredients (id, name, unit, is_unlimited, active, created_at) "
                "VALUES (gen_random_uuid()::text, 'Woda', 'L', true, true, NOW())"
            )
            logger.info("migrations.seed_water.created")
    except Exception as exc:
        logger.warning("migrations.seed_water.error", extra={"error": str(exc)})


def _seed_mixed_seq() -> None:
    """Ensure the mixed_seq sequence row exists."""
    try:
        execute(
            "INSERT INTO sequences (key, value) VALUES ('mixed_seq', 0) "
            "ON CONFLICT (key) DO NOTHING"
        )
    except Exception as exc:
        logger.warning("migrations.seed_mixed_seq.error", extra={"error": str(exc)})


def _backfill_lineage() -> None:
    """Backfill source_deboning_ids for seasoned_meat rows that lack it."""
    try:
        old_batches = query_all(
            "SELECT id, mixing_order_no FROM seasoned_meat "
            "WHERE source_deboning_ids = '{}' OR source_deboning_ids IS NULL"
        )
        fixed = 0
        for sm in old_batches:
            mo_no = sm.get("mixing_order_no")
            if not mo_no:
                continue
            mo = query_one(
                "SELECT id FROM mixing_orders WHERE order_no=%s", (mo_no,)
            )
            if not mo:
                continue
            lots = query_all(
                "SELECT ms.deboning_session_id "
                "FROM mixing_order_lots mol "
                "LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id "
                "WHERE mol.order_id = %s AND ms.deboning_session_id IS NOT NULL",
                (mo["id"],),
            )
            deb_ids = list(
                {lt["deboning_session_id"] for lt in lots if lt.get("deboning_session_id")}
            )
            if deb_ids:
                execute(
                    "UPDATE seasoned_meat SET source_deboning_ids = %s::text[] "
                    "WHERE id = %s AND (source_deboning_ids = '{}' OR source_deboning_ids IS NULL)",
                    (deb_ids, sm["id"]),
                )
                fixed += 1
        if fixed:
            logger.info(
                "migrations.backfill_lineage.done",
                extra={"fixed": fixed},
            )
    except Exception as exc:
        logger.warning(
            "migrations.backfill_lineage.error", extra={"error": str(exc)}
        )
