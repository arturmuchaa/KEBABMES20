"""Additive DDL for the 7 × 9 logical pallet locations (not room dimensions).

Release is a database invariant: all loading/undo/correction paths, including
mobile clients, must free the slot. Undo never invents a physical put-away.
"""

DDL = [
    # Non-scanned goods use their own records; never fake a carton or stock move.
    """CREATE TABLE IF NOT EXISTS cold_storage_blocked_slots (
        slot TEXT PRIMARY KEY CHECK (slot ~ '^[A-I][1-7]$'),
        description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 160),
        revision TEXT NOT NULL,
        operator TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS cold_storage_positions (
        slot TEXT PRIMARY KEY CHECK (slot ~ '^[A-I][1-7]$'),
        pallet_id TEXT UNIQUE REFERENCES order_pallets(id) ON DELETE CASCADE,
        carton_id TEXT UNIQUE REFERENCES stock_cartons(id) ON DELETE CASCADE,
        rotation INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90)),
        revision TEXT NOT NULL,
        operator TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK ((pallet_id IS NULL) <> (carton_id IS NULL))
    )""",
    """CREATE OR REPLACE FUNCTION release_cold_storage_position() RETURNS trigger AS $$
    BEGIN
        IF TG_TABLE_NAME = 'order_pallets' THEN
            IF NEW.status IS DISTINCT FROM 'cold_storage'
               OR NEW.cold_storage_at IS DISTINCT FROM OLD.cold_storage_at THEN
                DELETE FROM cold_storage_positions WHERE pallet_id=NEW.id;
            END IF;
        ELSE
            IF NEW.cold_storage_at IS NULL OR NEW.loaded_vehicle_id IS NOT NULL
               OR NEW.shipped_at IS NOT NULL
               OR NEW.cold_storage_at IS DISTINCT FROM OLD.cold_storage_at THEN
                DELETE FROM cold_storage_positions WHERE carton_id=NEW.id;
            END IF;
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql""",
    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='release_pallet_position'
                       AND tgrelid='order_pallets'::regclass) THEN
            CREATE TRIGGER release_pallet_position AFTER UPDATE OF status, cold_storage_at
            ON order_pallets FOR EACH ROW EXECUTE FUNCTION release_cold_storage_position();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='release_carton_position'
                       AND tgrelid='stock_cartons'::regclass) THEN
            CREATE TRIGGER release_carton_position
            AFTER UPDATE OF cold_storage_at, loaded_vehicle_id, shipped_at
            ON stock_cartons FOR EACH ROW EXECUTE FUNCTION release_cold_storage_position();
        END IF;
    END $$""",
]
