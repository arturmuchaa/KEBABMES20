"""
Inicjalizacja bazy danych Kebab MES
Uruchom PRZED pierwszym użyciem backendu:
  python init_db.py
"""
import psycopg2
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/kebab_mes")

def parse_url(url):
    url = url.replace("postgresql://", "").replace("postgres://", "")
    user_pass, rest = url.split("@")
    host_port, dbname = rest.rsplit("/", 1)
    if ":" in user_pass:
        user, password = user_pass.split(":", 1)
    else:
        user, password = user_pass, ""
    if ":" in host_port:
        host, port = host_port.rsplit(":", 1)
    else:
        host, port = host_port, "5432"
    return user, password, host, port, dbname

SCHEMA = """
CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    nip TEXT, vet_number TEXT, contact_name TEXT, phone TEXT, email TEXT,
    active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS raw_batches (
    id TEXT PRIMARY KEY, internal_batch_no TEXT UNIQUE NOT NULL,
    internal_batch_seq INTEGER, supplier_id TEXT REFERENCES suppliers(id),
    supplier_name TEXT, supplier_batch_no TEXT, slaughter_date DATE,
    received_date DATE, kg_received NUMERIC(10,3), kg_available NUMERIC(10,3),
    price_per_kg NUMERIC(10,4),
    expiry_date DATE, status TEXT DEFAULT 'active', notes TEXT,
    invoice_no TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS raw_batch_history (
    id TEXT PRIMARY KEY, batch_id TEXT REFERENCES raw_batches(id),
    action TEXT, changed_by TEXT, snapshot JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS production_sessions (
    id TEXT PRIMARY KEY,
    session_date DATE NOT NULL,
    process_type TEXT NOT NULL DEFAULT 'deboning',
    status TEXT NOT NULL DEFAULT 'open',
    started_at TIMESTAMPTZ DEFAULT now(),
    ended_at TIMESTAMPTZ,
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    notes TEXT,
    source_mixing_batch_ids TEXT[] DEFAULT '{}',
    batch_allocation JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS deboning_entries (
    id TEXT PRIMARY KEY, raw_batch_id TEXT REFERENCES raw_batches(id),
    raw_batch_no TEXT, session_id TEXT REFERENCES production_sessions(id),
    session_no TEXT, kg_quarter NUMERIC(10,3),
    kg_meat NUMERIC(10,3), kg_backs NUMERIC(10,3) DEFAULT 0,
    kg_bones NUMERIC(10,3) DEFAULT 0, kg_remainder NUMERIC(10,3) DEFAULT 0,
    yield_pct NUMERIC(5,2) DEFAULT 0,
    worker_id TEXT, worker_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meat_stock (
    id TEXT PRIMARY KEY, lot_no TEXT UNIQUE NOT NULL,
    deboning_session_id TEXT, session_no TEXT,
    raw_batch_id TEXT REFERENCES raw_batches(id), raw_batch_no TEXT,
    kg_initial NUMERIC(10,3), kg_available NUMERIC(10,3),
    kg_reserved NUMERIC(10,3) DEFAULT 0,
    kg_in_process NUMERIC(10,3) DEFAULT 0,
    kg_used NUMERIC(10,3) DEFAULT 0,
    production_date DATE, expiry_date DATE,
    status TEXT DEFAULT 'AVAILABLE', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
    pin TEXT, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    nip TEXT, regon TEXT, address TEXT, city TEXT,
    contact_name TEXT, phone TEXT, email TEXT,
    active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ingredients (
    id TEXT PRIMARY KEY, code TEXT, name TEXT NOT NULL, unit TEXT NOT NULL,
    is_unlimited BOOLEAN DEFAULT false, active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ingredient_stock (
    id TEXT PRIMARY KEY, ingredient_id TEXT REFERENCES ingredients(id),
    ingredient_name TEXT, qty_available NUMERIC(10,3), qty_initial NUMERIC(10,3),
    expiry_date DATE, batch_no TEXT, supplier_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS product_types (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, product_type_id TEXT,
    product_type_name TEXT, total_output_per_100kg NUMERIC(10,3),
    active BOOLEAN DEFAULT true, notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id TEXT PRIMARY KEY, recipe_id TEXT REFERENCES recipes(id) ON DELETE CASCADE,
    ingredient_id TEXT REFERENCES ingredients(id),
    ingredient_name TEXT, unit TEXT, qty_per_100kg NUMERIC(10,4)
);
CREATE TABLE IF NOT EXISTS packaging (
    id TEXT PRIMARY KEY, code TEXT, name TEXT NOT NULL,
    type TEXT NOT NULL, unit TEXT NOT NULL,
    kg_initial NUMERIC(10,3) DEFAULT 0,
    kg_available NUMERIC(10,3) DEFAULT 0,
    kg_used NUMERIC(10,3) DEFAULT 0,
    supplier_id TEXT, supplier_name TEXT, expiry_date DATE, notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS client_orders (
    id TEXT PRIMARY KEY, order_no TEXT UNIQUE NOT NULL,
    client_id TEXT REFERENCES clients(id), client_name TEXT,
    order_date DATE, delivery_date DATE,
    total_kg NUMERIC(10,3), total_units INTEGER,
    status TEXT DEFAULT 'draft', notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS client_order_lines (
    id TEXT PRIMARY KEY, order_id TEXT REFERENCES client_orders(id) ON DELETE CASCADE,
    qty INTEGER, kg_per_unit NUMERIC(10,3), total_kg NUMERIC(10,3),
    product_type_id TEXT, product_type_name TEXT,
    recipe_id TEXT, recipe_name TEXT,
    packaging_id TEXT, packaging_name TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS mixing_orders (
    id TEXT PRIMARY KEY, order_no TEXT UNIQUE NOT NULL,
    recipe_id TEXT, recipe_name TEXT,
    product_type_id TEXT, product_type_name TEXT,
    meat_kg NUMERIC(10,3) DEFAULT 0,
    planned_output_kg NUMERIC(10,3) DEFAULT 0,
    kg_done NUMERIC(10,3) DEFAULT 0,
    machine_id INTEGER,
    status TEXT DEFAULT 'planned',
    confirmed_steps JSONB DEFAULT '{}',
    source_seasoned_batch_ids TEXT[] DEFAULT '{}',
    notes TEXT,
    started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mixing_order_lots (
    id TEXT PRIMARY KEY, order_id TEXT REFERENCES mixing_orders(id) ON DELETE CASCADE,
    meat_stock_id TEXT, kg_planned NUMERIC(10,3) DEFAULT 0, kg_actual NUMERIC(10,3) DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mixing_sessions (
    id TEXT PRIMARY KEY, order_id TEXT REFERENCES mixing_orders(id) ON DELETE CASCADE,
    machine_id INTEGER, kg_meat NUMERIC(10,3) DEFAULT 0, kg_output NUMERIC(10,3) DEFAULT 0,
    batch_no TEXT, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS seasoned_meat (
    id TEXT PRIMARY KEY, batch_no TEXT UNIQUE NOT NULL,
    recipe_id TEXT, recipe_name TEXT, mixing_order_no TEXT,
    kg_produced NUMERIC(10,3), kg_available NUMERIC(10,3),
    kg_used NUMERIC(10,3) DEFAULT 0, machine_id INTEGER,
    expiry_date DATE, status TEXT DEFAULT 'available',
    source_deboning_ids TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS machine_locks (
    id TEXT PRIMARY KEY, machine_id INTEGER UNIQUE NOT NULL,
    order_id TEXT, order_no TEXT,
    locked_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS production_plans (
    id TEXT PRIMARY KEY, plan_no TEXT UNIQUE NOT NULL,
    plan_date DATE, total_kg NUMERIC(10,3), total_units INTEGER,
    status TEXT DEFAULT 'draft', notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS production_plan_lines (
    id TEXT PRIMARY KEY, plan_id TEXT REFERENCES production_plans(id) ON DELETE CASCADE,
    qty INTEGER, kg_per_unit NUMERIC(10,3), total_kg NUMERIC(10,3),
    product_type_id TEXT, product_type_name TEXT,
    recipe_id TEXT, recipe_name TEXT,
    packaging_id TEXT, packaging_name TEXT,
    seasoned_batch_id TEXT, seasoned_batch_no TEXT,
    seasoned_batch_nos TEXT[] DEFAULT '{}',
    batch_allocation JSONB DEFAULT '{}',
    client_order_id TEXT, client_order_no TEXT, client_name TEXT,
    kg_assigned NUMERIC(10,3) DEFAULT 0,
    status TEXT DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS finished_goods (
    id TEXT PRIMARY KEY, batch_no TEXT NOT NULL, plan_no TEXT,
    product_type_id TEXT, product_type_name TEXT,
    recipe_id TEXT, recipe_name TEXT,
    packaging_id TEXT, packaging_name TEXT,
    client_name TEXT, client_order_no TEXT,
    qty INTEGER, kg_per_unit NUMERIC(10,3), total_kg NUMERIC(10,3),
    qty_available INTEGER, qty_shipped INTEGER DEFAULT 0,
    produced_date DATE, produced_by TEXT[] DEFAULT '{}',
    seasoned_batch_nos TEXT[] DEFAULT '{}',
    source_production_id TEXT,
    source_mixing_ids TEXT[] DEFAULT '{}',
    source_seasoned_ids TEXT[] DEFAULT '{}',
    source_deboning_ids TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS finished_goods_sessions (
    id TEXT PRIMARY KEY,
    goods_id TEXT REFERENCES finished_goods(id) ON DELETE CASCADE,
    plan_line_id TEXT, qty INTEGER, total_kg NUMERIC(10,3),
    seasoned_batch_nos TEXT[] DEFAULT '{}',
    worker_names TEXT[] DEFAULT '{}',
    added_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY, invoice_no TEXT NOT NULL, supplier_id TEXT,
    supplier_name TEXT, category TEXT, invoice_date DATE, due_date DATE,
    qty NUMERIC(10,3), unit_price NUMERIC(10,4), vat_rate NUMERIC(5,4),
    total_net NUMERIC(12,2), total_vat NUMERIC(12,2), total_gross NUMERIC(12,2),
    raw_batch_id TEXT, notes TEXT,
    currency TEXT DEFAULT 'PLN',
    exchange_rate NUMERIC(10,4),
    amount_eur NUMERIC(12,2),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sequences (
    key TEXT PRIMARY KEY, value INTEGER DEFAULT 0
);
INSERT INTO sequences (key, value) VALUES
    ('batch_seq', 171), ('deboning_seq', 0), ('mixing_seq', 0),
    ('seasoned_seq', 0), ('client_order_seq', 0), ('production_plan_seq', 0),
    ('finished_goods_seq', 0), ('packaging_seq', 0), ('client_seq', 0),
    ('supplier_seq', 0)
ON CONFLICT (key) DO NOTHING;
CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    product_type TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    qty NUMERIC(10,3) NOT NULL,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('IN', 'OUT', 'TRANSFORM')),
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_batch_id ON stock_movements(batch_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_source_id ON stock_movements(source_id);
"""

def main():
    user, password, host, port, dbname = parse_url(DATABASE_URL)
    print(f"Łączę z PostgreSQL na {host}:{port} jako '{user}'...")

    try:
        conn0 = psycopg2.connect(
            host=host, port=int(port), user=user, password=password,
            dbname="postgres"
        )
        conn0.autocommit = True
        cur0 = conn0.cursor()
        cur0.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,))
        exists = cur0.fetchone()
        if not exists:
            cur0.execute(f'CREATE DATABASE "{dbname}"')
            print(f"✓ Baza danych '{dbname}' utworzona")
        else:
            print(f"  Baza danych '{dbname}' już istnieje")
        conn0.close()
    except Exception as e:
        print(f"✗ Nie mogę połączyć z PostgreSQL: {e}")
        print("\nUpewnij się że:")
        print("  1. PostgreSQL jest uruchomiony")
        print("  2. Plik backend/.env zawiera poprawny DATABASE_URL z właściwym hasłem")
        print(f"\n  Aktualny DATABASE_URL: {DATABASE_URL[:60]}...")
        return

    try:
        conn = psycopg2.connect(
            host=host, port=int(port), user=user, password=password,
            dbname=dbname
        )
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute(SCHEMA)

        # BUGFIX: Woda nieograniczona — seed przy każdej instalacji
        cur.execute("""
            INSERT INTO ingredients (id, name, unit, is_unlimited, active, created_at)
            SELECT gen_random_uuid()::text, 'Woda', 'L', true, true, NOW()
            WHERE NOT EXISTS (SELECT 1 FROM ingredients WHERE is_unlimited = true)
        """)
        print("✓ Składnik 'Woda' (nieograniczona) — sprawdzono/dodano")

        conn.close()
        print(f"✓ Schemat tabel utworzony w bazie '{dbname}'")
        print(f"✓ Gotowe! Uruchom teraz: uvicorn server_pg:app --host 0.0.0.0 --port 8000 --reload")
    except Exception as e:
        print(f"✗ Błąd tworzenia tabel: {e}")

def reset():
    """Wyczyść wszystkie dane (zachowaj strukturę tabel i sekwencje)"""
    user, password, host, port, dbname = parse_url(DATABASE_URL)
    print(f"Czyszczenie bazy '{dbname}'...")

    TABLES = [
        'machine_locks', 'finished_goods_sessions', 'finished_goods',
        'production_plan_lines', 'production_plans',
        'client_order_lines', 'client_orders',
        'mixing_order_lots', 'mixing_orders',
        'ingredient_stock', 'recipe_ingredients',
        'deboning_entries', 'meat_stock',
        'raw_batch_history', 'seasoned_meat', 'invoices',
        'packaging', 'raw_batches',
        'recipes', 'product_types', 'ingredients',
        'clients', 'workers', 'suppliers',
    ]

    try:
        conn = psycopg2.connect(host=host, port=int(port), user=user, password=password, dbname=dbname)
        conn.autocommit = True
        cur = conn.cursor()

        for table in TABLES:
            cur.execute(f'TRUNCATE TABLE "{table}" CASCADE')
            print(f"  ✓ {table}")

        cur.execute("""
            UPDATE sequences SET value = CASE key
                WHEN 'batch_seq' THEN 171
                ELSE 0
            END
        """)
        print("  ✓ sekwencje zresetowane")
        conn.close()
        print(f"\n✓ Baza '{dbname}' wyczyszczona. Możesz teraz zacząć od nowa.")
    except Exception as e:
        print(f"✗ Błąd: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "reset":
        confirm = input(f"⚠  Usunąć WSZYSTKIE dane z bazy? Wpisz 'TAK': ")
        if confirm == "TAK":
            reset()
        else:
            print("Anulowano.")
    elif len(sys.argv) > 1 and sys.argv[1] == "migrate":
        # Migracja dla istniejących baz — dodaje brakujące kolumny bez utraty danych
        user, password, host, port, dbname = parse_url(DATABASE_URL)
        print(f"Migracja bazy '{dbname}'...")
        try:
            conn = psycopg2.connect(host=host, port=int(port), user=user, password=password, dbname=dbname)
            conn.autocommit = True
            cur = conn.cursor()
            migrations = [
                ("raw_batches",        "invoice_no",    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS invoice_no TEXT"),
                ("raw_batches",        "kg_available",  "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS kg_available NUMERIC(10,3)"),
                ("raw_batches",        "kg_available_sync", "UPDATE raw_batches SET kg_available = kg_received WHERE kg_available IS NULL"),
                ("deboning_entries",   "session_id",    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS session_id TEXT"),
                ("deboning_entries",   "kg_backs",      "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS kg_backs NUMERIC(10,3) DEFAULT 0"),
                ("deboning_entries",   "kg_bones",      "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS kg_bones NUMERIC(10,3) DEFAULT 0"),
                ("deboning_entries",   "kg_remainder",  "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS kg_remainder NUMERIC(10,3) DEFAULT 0"),
                ("deboning_entries",   "yield_pct",     "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS yield_pct NUMERIC(5,2) DEFAULT 0"),
                ("production_sessions", "create_table", """
                    CREATE TABLE IF NOT EXISTS production_sessions (
                        id TEXT PRIMARY KEY, session_date DATE NOT NULL,
                        process_type TEXT NOT NULL DEFAULT 'deboning',
                        status TEXT NOT NULL DEFAULT 'open',
                        started_at TIMESTAMPTZ DEFAULT now(), ended_at TIMESTAMPTZ,
                        approved_by TEXT, approved_at TIMESTAMPTZ,
                        notes TEXT, created_at TIMESTAMPTZ DEFAULT now()
                    )
                """),
                ("mixing_orders", "meat_kg",           "ALTER TABLE mixing_orders ADD COLUMN IF NOT EXISTS meat_kg NUMERIC(10,3) DEFAULT 0"),
                ("mixing_orders", "planned_output_kg", "ALTER TABLE mixing_orders ADD COLUMN IF NOT EXISTS planned_output_kg NUMERIC(10,3) DEFAULT 0"),
                ("mixing_orders", "kg_done",           "ALTER TABLE mixing_orders ADD COLUMN IF NOT EXISTS kg_done NUMERIC(10,3) DEFAULT 0"),
                ("mixing_orders", "product_type_id",   "ALTER TABLE mixing_orders ADD COLUMN IF NOT EXISTS product_type_id TEXT"),
                ("mixing_orders", "product_type_name", "ALTER TABLE mixing_orders ADD COLUMN IF NOT EXISTS product_type_name TEXT"),
                ("mixing_orders", "confirmed_steps",   "ALTER TABLE mixing_orders ADD COLUMN IF NOT EXISTS confirmed_steps JSONB DEFAULT '{}'"),
                ("mixing_orders", "completed_at",      "ALTER TABLE mixing_orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ"),
                ("mixing_order_lots", "meat_stock_id", "ALTER TABLE mixing_order_lots ADD COLUMN IF NOT EXISTS meat_stock_id TEXT"),
                ("mixing_order_lots", "kg_planned",    "ALTER TABLE mixing_order_lots ADD COLUMN IF NOT EXISTS kg_planned NUMERIC(10,3) DEFAULT 0"),
                ("mixing_order_lots", "kg_actual",     "ALTER TABLE mixing_order_lots ADD COLUMN IF NOT EXISTS kg_actual NUMERIC(10,3) DEFAULT 0"),
                ("mixing_sessions",  "create_table",  """
                    CREATE TABLE IF NOT EXISTS mixing_sessions (
                        id TEXT PRIMARY KEY,
                        order_id TEXT REFERENCES mixing_orders(id) ON DELETE CASCADE,
                        machine_id INTEGER,
                        kg_meat NUMERIC(10,3) DEFAULT 0,
                        kg_output NUMERIC(10,3) DEFAULT 0,
                        batch_no TEXT,
                        started_at TIMESTAMPTZ,
                        completed_at TIMESTAMPTZ
                    )
                """),
                ("ingredients", "water_seed", "INSERT INTO ingredients (id, name, unit, is_unlimited, active, created_at) SELECT gen_random_uuid()::text, 'Woda', 'L', true, true, NOW() WHERE NOT EXISTS (SELECT 1 FROM ingredients WHERE is_unlimited = true)"),
                ("invoices", "currency",      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'PLN'"),
                ("invoices", "exchange_rate", "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(10,4)"),
                ("invoices", "amount_eur",    "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_eur NUMERIC(12,2)"),
                ("raw_batches", "kg_avail_init", "UPDATE raw_batches SET kg_available = kg_received WHERE kg_available IS NULL AND status = 'active'"),
                ("recipes", "total_output_per_100kg", "ALTER TABLE recipes ADD COLUMN IF NOT EXISTS total_output_per_100kg NUMERIC(10,3) DEFAULT 100"),
                # Traceability v2
                ("seasoned_meat", "source_deboning_ids", "ALTER TABLE seasoned_meat ADD COLUMN IF NOT EXISTS source_deboning_ids TEXT[] DEFAULT '{}'"),
                ("mixing_orders", "source_seasoned_batch_ids", "ALTER TABLE mixing_orders ADD COLUMN IF NOT EXISTS source_seasoned_batch_ids TEXT[] DEFAULT '{}'"),
                ("production_sessions", "source_mixing_batch_ids", "ALTER TABLE production_sessions ADD COLUMN IF NOT EXISTS source_mixing_batch_ids TEXT[] DEFAULT '{}'"),
                ("production_sessions", "batch_allocation", "ALTER TABLE production_sessions ADD COLUMN IF NOT EXISTS batch_allocation JSONB DEFAULT '{}'"),
                ("finished_goods", "source_production_id", "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS source_production_id TEXT"),
                ("production_plan_lines", "seasoned_batch_nos", "ALTER TABLE production_plan_lines ADD COLUMN IF NOT EXISTS seasoned_batch_nos TEXT[] DEFAULT '{}'"),
                ("production_plan_lines", "batch_allocation", "ALTER TABLE production_plan_lines ADD COLUMN IF NOT EXISTS batch_allocation JSONB DEFAULT '{}'"),
                # Traceability v3 — pełny lineage w finished_goods i production_sessions
                ("production_sessions", "source_seasoned_ids", "ALTER TABLE production_sessions ADD COLUMN IF NOT EXISTS source_seasoned_ids TEXT[] DEFAULT '{}'"),
                ("production_sessions", "source_deboning_ids", "ALTER TABLE production_sessions ADD COLUMN IF NOT EXISTS source_deboning_ids TEXT[] DEFAULT '{}'"),
                ("finished_goods", "source_mixing_ids",   "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS source_mixing_ids TEXT[] DEFAULT '{}'"),
                ("finished_goods", "source_seasoned_ids", "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS source_seasoned_ids TEXT[] DEFAULT '{}'"),
                ("finished_goods", "source_deboning_ids", "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS source_deboning_ids TEXT[] DEFAULT '{}'"),
                # Stock movements v1
                ("stock_movements", "create_table", """
                    CREATE TABLE IF NOT EXISTS stock_movements (
                        id TEXT PRIMARY KEY,
                        product_type TEXT NOT NULL,
                        batch_id TEXT NOT NULL,
                        qty NUMERIC(10,3) NOT NULL,
                        movement_type TEXT NOT NULL CHECK (movement_type IN ('IN', 'OUT', 'TRANSFORM')),
                        source_type TEXT NOT NULL,
                        source_id TEXT NOT NULL,
                        created_at TIMESTAMPTZ DEFAULT now()
                    )
                """),
                ("stock_movements", "idx_batch_id", "CREATE INDEX IF NOT EXISTS idx_stock_movements_batch_id ON stock_movements(batch_id)"),
                ("stock_movements", "idx_source_id", "CREATE INDEX IF NOT EXISTS idx_stock_movements_source_id ON stock_movements(source_id)"),
            ]
            for table, col, sql in migrations:
                cur.execute(sql)
                print(f"  ✓ {table}.{col}")
            conn.close()
            print("✓ Migracja zakończona pomyślnie.")
        except Exception as e:
            print(f"✗ Błąd migracji: {e}")
    else:
        main()
