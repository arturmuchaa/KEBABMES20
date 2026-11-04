"""Stable per-vehicle order colours, independent of loading sequence."""

SQL = [
    "ALTER TABLE vehicle_loading_orders ADD COLUMN IF NOT EXISTS color_index INTEGER CHECK (color_index >= 0)",
    # Fill only legacy rows. Restarting workers never recolours an active load.
    """WITH missing AS (
        SELECT id, vehicle_id, ROW_NUMBER() OVER (
            PARTITION BY vehicle_id ORDER BY position, created_at, id) AS n
        FROM vehicle_loading_orders WHERE color_index IS NULL
    ), highest AS (
        SELECT vehicle_id, COALESCE(MAX(color_index), -1) AS n
        FROM vehicle_loading_orders GROUP BY vehicle_id
    ) UPDATE vehicle_loading_orders v SET color_index = h.n + m.n
      FROM missing m JOIN highest h USING (vehicle_id) WHERE v.id = m.id""",
    "ALTER TABLE vehicle_loading_orders ALTER COLUMN color_index SET NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_loading_order_color ON vehicle_loading_orders(vehicle_id, color_index)",
    # Covers add_order and legacy backfill. The same vehicle lock is already
    # used by add/remove/clear. A colour stays with its row through reordering.
    """CREATE OR REPLACE FUNCTION assign_vehicle_loading_color() RETURNS trigger AS $$
    BEGIN
        IF NEW.color_index IS NULL THEN
            PERFORM id FROM vehicles WHERE id = NEW.vehicle_id FOR UPDATE;
            SELECT candidate INTO NEW.color_index
              FROM generate_series(0, (SELECT COUNT(*)::int FROM vehicle_loading_orders
                                       WHERE vehicle_id = NEW.vehicle_id)) candidate
             WHERE NOT EXISTS (SELECT 1 FROM vehicle_loading_orders
                               WHERE vehicle_id = NEW.vehicle_id AND color_index = candidate)
             ORDER BY candidate LIMIT 1;
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql""",
    "DROP TRIGGER IF EXISTS trg_vehicle_loading_color ON vehicle_loading_orders",
    """CREATE TRIGGER trg_vehicle_loading_color BEFORE INSERT ON vehicle_loading_orders
       FOR EACH ROW EXECUTE FUNCTION assign_vehicle_loading_color()""",
]
