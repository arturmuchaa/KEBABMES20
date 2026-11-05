"""Additive schema for per-worker mass settlement; historical entries stay legacy."""

DDL = [
    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS deboning_mode TEXT",
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS settlement_stage TEXT",
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
]
