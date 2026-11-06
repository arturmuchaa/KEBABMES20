"""Additive schema for per-worker mass settlement; historical entries stay legacy."""

DDL = [
    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS deboning_mode TEXT",
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS settlement_stage TEXT",
    # Closed outside ±1% with the manager's code: reason, who, when and the numbers.
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS settlement_exception JSONB",
    """CREATE TABLE IF NOT EXISTS deboning_settlement_weighings (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES deboning_entries(id),
        kind TEXT NOT NULL CHECK (kind IN ('meat','backs','bones')),
        kg_net NUMERIC NOT NULL CHECK (kg_net > 0),
        kg_gross NUMERIC,
        tare_cart_kg NUMERIC,
        tare_e2_kg NUMERIC,
        e2_count INTEGER,
        weigh_mode TEXT NOT NULL CHECK (weigh_mode IN ('auto','manual')),
        reason TEXT NOT NULL DEFAULT '',
        weighed_by TEXT NOT NULL,
        weighed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        original_payload JSONB NOT NULL,
        corrections JSONB NOT NULL DEFAULT '[]'
    )""",
    "CREATE INDEX IF NOT EXISTS idx_settlement_weighings_entry ON deboning_settlement_weighings(entry_id)",
    # Whole pallet of backs/bones collected from many takes, weighed FOR INFORMATION:
    # the kilograms already entered stock per worker, so no stock movement here.
    """CREATE TABLE IF NOT EXISTS byproduct_pallet_checks (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('backs','bones')),
        kg_net NUMERIC(10,3) NOT NULL CHECK (kg_net > 0),
        kg_gross NUMERIC(10,3),
        tare_kg NUMERIC(10,3),
        tare_label TEXT NOT NULL DEFAULT '',
        tare_e2_kg NUMERIC(10,3),
        e2_count INTEGER,
        weigh_mode TEXT NOT NULL CHECK (weigh_mode IN ('auto','manual')),
        reason TEXT NOT NULL DEFAULT '',
        batches JSONB NOT NULL,
        workers_kg NUMERIC(10,3) NOT NULL DEFAULT 0,
        weighed_by TEXT NOT NULL,
        weighed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        original_payload JSONB NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_byproduct_pallet_checks_at ON byproduct_pallet_checks(weighed_at)",
]
