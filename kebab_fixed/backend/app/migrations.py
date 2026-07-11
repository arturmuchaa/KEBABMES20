"""Startup migrations — idempotent schema changes run once at boot.

Every statement MUST be safe to re-run (IF NOT EXISTS, ADD COLUMN IF NOT EXISTS).
Never DROP or ALTER TYPE in a way that destroys data.
"""
import json

from app.db import cx_execute, cx_query_all, execute, query_all, query_one, transaction
from app.logging_config import get_logger

logger = get_logger(__name__)

_DDL: list[str] = [
    # ── Product types ──
    "ALTER TABLE product_types ADD COLUMN IF NOT EXISTS description TEXT",
    "ALTER TABLE product_types ADD COLUMN IF NOT EXISTS components JSONB DEFAULT '[]'",

    # ── Clients: nazwa wyświetlana (skrócona/zakładowa) ──
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS display_name TEXT",

    # ── Suppliers: kolumny dopisane na prod ręcznie — guard dla świeżych baz
    # (init_db.py tworzy tabelę bez nich; serwis je INSERT/UPDATE-uje) ──
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS display_name TEXT DEFAULT ''",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS regon TEXT DEFAULT ''",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address TEXT DEFAULT ''",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS city TEXT DEFAULT ''",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS postal_code TEXT DEFAULT ''",

    # ── App settings (klucz–wartość) ──
    """CREATE TABLE IF NOT EXISTS app_settings (
        key        TEXT PRIMARY KEY,
        value      JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now()
    )""",

    # ── Order pallets (palety wydania) ──
    """CREATE TABLE IF NOT EXISTS order_pallets (
        id         TEXT PRIMARY KEY,
        order_id   TEXT NOT NULL REFERENCES client_orders(id) ON DELETE CASCADE,
        pallet_no  INTEGER NOT NULL,
        notes      TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (order_id, pallet_no)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_order_pallets_order ON order_pallets(order_id)",

    """CREATE TABLE IF NOT EXISTS order_pallet_items (
        id            TEXT PRIMARY KEY,
        pallet_id     TEXT NOT NULL REFERENCES order_pallets(id) ON DELETE CASCADE,
        order_line_id TEXT NOT NULL REFERENCES client_order_lines(id) ON DELETE CASCADE,
        qty           INTEGER NOT NULL CHECK (qty > 0)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_pallet_items_pallet ON order_pallet_items(pallet_id)",
    "CREATE INDEX IF NOT EXISTS idx_pallet_items_line   ON order_pallet_items(order_line_id)",

    # ── Tracking skanowania palet (kod QR) ──
    # Globalny unikalny numer kartonu (= paleta), sekwencyjny od 000001.
    # Nadawany przy tworzeniu palety (next_seq('carton_seq')); wyświetlany w UI
    # (lewy górny róg) i na etykiecie (mały, prawy górny róg).
    "ALTER TABLE order_pallets ADD COLUMN IF NOT EXISTS carton_no INTEGER",
    "ALTER TABLE order_pallets ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'created'",
    "ALTER TABLE order_pallets ADD COLUMN IF NOT EXISTS cold_storage_at TIMESTAMPTZ",
    "ALTER TABLE order_pallets ADD COLUMN IF NOT EXISTS loaded_at TIMESTAMPTZ",
    "CREATE INDEX IF NOT EXISTS idx_order_pallets_status ON order_pallets(status)",

    """CREATE TABLE IF NOT EXISTS pallet_scans (
        id          TEXT PRIMARY KEY,
        pallet_id   TEXT NOT NULL REFERENCES order_pallets(id) ON DELETE CASCADE,
        action      TEXT NOT NULL,
        scanned_at  TIMESTAMPTZ DEFAULT now(),
        operator    TEXT DEFAULT ''
    )""",
    "CREATE INDEX IF NOT EXISTS idx_pallet_scans_pallet ON pallet_scans(pallet_id)",

    # ── Traceability v2 — batch→batch lineage ──
    "ALTER TABLE seasoned_meat ADD COLUMN IF NOT EXISTS source_deboning_ids TEXT[] DEFAULT '{}'",
    "ALTER TABLE mixing_orders ADD COLUMN IF NOT EXISTS source_seasoned_batch_ids TEXT[] DEFAULT '{}'",
    "ALTER TABLE production_sessions ADD COLUMN IF NOT EXISTS source_mixing_batch_ids TEXT[] DEFAULT '{}'",
    "ALTER TABLE production_sessions ADD COLUMN IF NOT EXISTS batch_allocation JSONB DEFAULT '{}'",
    "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS source_production_id TEXT",
    # (legacy, nieużywane — karton magazynowy przeniesiony do stock_cartons)
    "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS carton_no INTEGER",
    "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS client_id TEXT",
    # ── Karton magazynowy = jednostka pakowa (bez zamówienia). Sztuki wpadają
    #    przez skan (finished_units.carton_id). Numer wspólny carton_seq z paletami.
    """CREATE TABLE IF NOT EXISTS stock_cartons (
        id                TEXT PRIMARY KEY,
        carton_no         INTEGER,
        client_id         TEXT,
        client_name       TEXT DEFAULT '',
        recipe_id         TEXT DEFAULT '',
        recipe_name       TEXT DEFAULT '',
        product_type_id   TEXT DEFAULT '',
        product_type_name TEXT DEFAULT '',
        packaging_id      TEXT DEFAULT '',
        packaging_name    TEXT DEFAULT '',
        kg_per_unit       NUMERIC NOT NULL DEFAULT 0,
        target_qty        INTEGER NOT NULL DEFAULT 0,
        packed_qty        INTEGER NOT NULL DEFAULT 0,
        status            TEXT NOT NULL DEFAULT 'open',
        linked_order_id   TEXT,
        linked_order_no   TEXT,
        created_at        TIMESTAMPTZ DEFAULT now(),
        closed_at         TIMESTAMPTZ
    )""",
    "CREATE INDEX IF NOT EXISTS idx_stock_cartons_status ON stock_cartons(status)",
    "CREATE INDEX IF NOT EXISTS idx_stock_cartons_client ON stock_cartons(client_id)",
    "ALTER TABLE production_plan_lines ADD COLUMN IF NOT EXISTS batch_allocation JSONB DEFAULT '{}'",
    "ALTER TABLE production_plan_lines ADD COLUMN IF NOT EXISTS seasoned_batch_nos TEXT[] DEFAULT '{}'",
    "ALTER TABLE production_plan_lines ADD COLUMN IF NOT EXISTS client_order_line_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_plan_lines_order_line ON production_plan_lines(client_order_line_id) WHERE client_order_line_id IS NOT NULL",

    # ── Traceability v3 — full chain in production_sessions + finished_goods ──
    "ALTER TABLE production_sessions ADD COLUMN IF NOT EXISTS source_seasoned_ids TEXT[] DEFAULT '{}'",
    "ALTER TABLE production_sessions ADD COLUMN IF NOT EXISTS source_deboning_ids TEXT[] DEFAULT '{}'",
    "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS source_mixing_ids TEXT[] DEFAULT '{}'",
    "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS source_seasoned_ids TEXT[] DEFAULT '{}'",
    "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS source_deboning_ids TEXT[] DEFAULT '{}'",

    # ── Ważenie automatyczne RS232 (HMI rozbiór v10) — audyt brutto/tara/tryb ──
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS kg_gross NUMERIC(10,3)",
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS tare_cart_kg NUMERIC(10,3)",
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS tare_e2_kg NUMERIC(10,3)",
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS e2_count INTEGER",
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS weigh_mode TEXT",
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'complete'",
    # Czas domknięcia pobrania mięsem (dwufazowy rozbiór) — „Ostatnie wpisy"
    # sortują po nim, żeby wpis nie wskakiwał wg czasu POBRANIA (created_at).
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ",

    # ── Stock reservation model ──
    "ALTER TABLE meat_stock ADD COLUMN IF NOT EXISTS kg_reserved NUMERIC(10,3) DEFAULT 0",
    "ALTER TABLE meat_stock ADD COLUMN IF NOT EXISTS kg_used NUMERIC(10,3) DEFAULT 0",
    # Reservation model rozszerzony na seasoned_meat — plany rezerwują kg_reserved,
    # finish_day (faktyczne wyprodukowanie) zdejmuje kg_reserved + kg_available.
    "ALTER TABLE seasoned_meat ADD COLUMN IF NOT EXISTS kg_reserved NUMERIC(10,3) DEFAULT 0",

    # ── Mixing machine tracking ──
    "ALTER TABLE mixing_orders ADD COLUMN IF NOT EXISTS kg_in_machine NUMERIC(10,3) DEFAULT 0",

    # ── Ingredient receipts metadata ──
    "ALTER TABLE ingredient_stock ADD COLUMN IF NOT EXISTS price_per_unit NUMERIC(10,4) DEFAULT 0",
    "ALTER TABLE ingredient_stock ADD COLUMN IF NOT EXISTS invoice_no TEXT",
    "ALTER TABLE ingredient_stock ADD COLUMN IF NOT EXISTS received_date DATE",
    "ALTER TABLE ingredient_stock ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''",

    # ── Worker payroll fields ──
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS rate_per_kg NUMERIC(10,4) DEFAULT 0",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS contract_type TEXT DEFAULT 'zlecenie'",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS employer_cost_pct NUMERIC(5,2) DEFAULT 0",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS employer_cost_amount NUMERIC(10,2) DEFAULT 0",

    # ── Faktury: trwałe powiązanie pozycji (kalkulacja kosztu wg ceny z FZ) ──
    "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ingredient_id TEXT",
    "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS packaging_id TEXT",

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

    # ── Postęp produkcji per linia (live update z tabletu) ──
    "ALTER TABLE production_plan_lines ADD COLUMN IF NOT EXISTS qty_done INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE production_plan_lines ADD COLUMN IF NOT EXISTS worker_entries JSONB NOT NULL DEFAULT '[]'",
    "ALTER TABLE production_plan_lines ADD COLUMN IF NOT EXISTS line_status TEXT NOT NULL DEFAULT 'PLANNED'",
    "ALTER TABLE production_plan_lines ADD COLUMN IF NOT EXISTS progress_updated_at TIMESTAMPTZ",

    # ── Production plan — tablet → office confirmation flow ──
    # Tablet klika "Zakończ produkcję": stempluje tablet_finished_at i zapisuje
    # entries do tablet_pending_entries. Kebab NIE wchodzi jeszcze na magazyn.
    # Biuro w panelu klika "Potwierdź": stempluje office_confirmed_at i URUCHAMIA
    # finish_day (tworzy finished_goods, zwalnia kg_reserved, status='done').
    "ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS tablet_finished_at TIMESTAMPTZ",
    "ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS office_confirmed_at TIMESTAMPTZ",
    "ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS tablet_pending_entries JSONB",

    # ── Day closures (biuro zamyka dzień osobno dla każdej sekcji) ──
    """CREATE TABLE IF NOT EXISTS day_closures (
        id           TEXT PRIMARY KEY,
        closure_date DATE NOT NULL,
        section      TEXT NOT NULL,
        closed_at    TIMESTAMPTZ DEFAULT now(),
        closed_by    TEXT DEFAULT '',
        notes        TEXT DEFAULT '',
        UNIQUE (closure_date, section)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_day_closures_date_section ON day_closures(closure_date, section)",

    # ── Samochody / pojazdy do załadunku ──
    """CREATE TABLE IF NOT EXISTS vehicles (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        plate       TEXT DEFAULT '',
        kind        TEXT NOT NULL DEFAULT 'own',
        vehicle_type TEXT NOT NULL DEFAULT 'dostawczy',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        active      BOOLEAN NOT NULL DEFAULT true,
        notes       TEXT DEFAULT '',
        created_at  TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_vehicles_active ON vehicles(active)",
    "ALTER TABLE pallet_scans ADD COLUMN IF NOT EXISTS vehicle_id TEXT",
    "ALTER TABLE order_pallets ADD COLUMN IF NOT EXISTS loaded_vehicle_id TEXT",

    # ── CHECK constraints (NOT VALID — dotyczą tylko nowych wierszy) ──
    # Sens: blokuj ujemne kg. Stare wiersze nie są skanowane przy ADD;
    # po sprawdzeniu czystości danych admin może VALIDATE CONSTRAINT.
    # Każdy statement w osobnym DO bo CHECK nie wspiera IF NOT EXISTS.
    """DO $$ BEGIN
        ALTER TABLE meat_stock ADD CONSTRAINT meat_stock_kg_nonneg_ck
            CHECK (
                COALESCE(kg_initial, 0) >= 0
                AND COALESCE(kg_available, 0) >= 0
                AND COALESCE(kg_reserved, 0) >= 0
                AND COALESCE(kg_used, 0) >= 0
            ) NOT VALID;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$""",
    """DO $$ BEGIN
        ALTER TABLE seasoned_meat ADD CONSTRAINT seasoned_meat_kg_nonneg_ck
            CHECK (
                COALESCE(kg_produced, 0) >= 0
                AND COALESCE(kg_available, 0) >= 0
                AND COALESCE(kg_reserved, 0) >= 0
                AND COALESCE(kg_used, 0) >= 0
            ) NOT VALID;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$""",
    """DO $$ BEGIN
        ALTER TABLE raw_batches ADD CONSTRAINT raw_batches_kg_nonneg_ck
            CHECK (
                COALESCE(kg_received, 0) >= 0
                AND COALESCE(kg_available, 0) >= 0
            ) NOT VALID;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$""",
    """DO $$ BEGIN
        ALTER TABLE packaging ADD CONSTRAINT packaging_kg_nonneg_ck
            CHECK (
                COALESCE(kg_initial, 0) >= 0
                AND COALESCE(kg_available, 0) >= 0
                AND COALESCE(kg_used, 0) >= 0
            ) NOT VALID;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$""",
    """DO $$ BEGIN
        ALTER TABLE ingredient_stock ADD CONSTRAINT ingredient_stock_qty_nonneg_ck
            CHECK (
                COALESCE(qty_initial, 0) >= 0
                AND COALESCE(qty_available, 0) >= 0
            ) NOT VALID;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$""",
    """DO $$ BEGIN
        ALTER TABLE mixing_orders ADD CONSTRAINT mixing_orders_kg_nonneg_ck
            CHECK (
                COALESCE(meat_kg, 0) >= 0
                AND COALESCE(kg_done, 0) >= 0
                AND COALESCE(kg_in_machine, 0) >= 0
            ) NOT VALID;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$""",
    """DO $$ BEGIN
        ALTER TABLE finished_goods ADD CONSTRAINT finished_goods_qty_nonneg_ck
            CHECK (
                COALESCE(qty, 0) >= 0
                AND COALESCE(qty_available, 0) >= 0
                AND COALESCE(qty_shipped, 0) >= 0
                AND COALESCE(kg_per_unit, 0) >= 0
                AND COALESCE(total_kg, 0) >= 0
            ) NOT VALID;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$""",

    # ── QR per sztuka — finished_units + cartons ──
    """CREATE TABLE IF NOT EXISTS finished_units (
        id            TEXT PRIMARY KEY,
        qr_code       TEXT NOT NULL UNIQUE,
        qr_seq        INTEGER,
        plan_line_id  TEXT,
        order_id      TEXT,
        client_name   TEXT DEFAULT '',
        product_type_id TEXT DEFAULT '',
        recipe_id     TEXT DEFAULT '',
        tuleja        TEXT DEFAULT '',
        weight_kg     NUMERIC NOT NULL DEFAULT 0,
        batch_no      TEXT DEFAULT '',
        produced_date TEXT DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'planned',
        trolley_id    TEXT,
        produced_at   TIMESTAMPTZ,
        carton_id     TEXT,
        created_at    TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_finished_units_status   ON finished_units(status)",
    "CREATE INDEX IF NOT EXISTS idx_finished_units_batch    ON finished_units(batch_no)",
    "CREATE INDEX IF NOT EXISTS idx_finished_units_planline ON finished_units(plan_line_id)",
    "CREATE INDEX IF NOT EXISTS idx_finished_units_carton   ON finished_units(carton_id) WHERE carton_id IS NOT NULL",
    "ALTER TABLE finished_units ADD COLUMN IF NOT EXISTS pallet_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_finished_units_pallet ON finished_units(pallet_id) WHERE pallet_id IS NOT NULL",

    """CREATE TABLE IF NOT EXISTS dispatches (
        id            TEXT PRIMARY KEY,
        trip_id       TEXT,
        client_id     TEXT,
        client_name   TEXT NOT NULL DEFAULT '',
        vehicle_id    TEXT,
        cmr_requested BOOLEAN NOT NULL DEFAULT false,
        status        TEXT NOT NULL DEFAULT 'open',
        operator      TEXT DEFAULT '',
        notes         TEXT DEFAULT '',
        created_at    TIMESTAMPTZ DEFAULT now(),
        shipped_at    TIMESTAMPTZ
    )""",
    "CREATE INDEX IF NOT EXISTS idx_dispatches_status ON dispatches(status)",
    "CREATE INDEX IF NOT EXISTS idx_dispatches_client ON dispatches(client_id)",
    "ALTER TABLE finished_units ADD COLUMN IF NOT EXISTS dispatch_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_finished_units_dispatch ON finished_units(dispatch_id) WHERE dispatch_id IS NOT NULL",

    # ── Twardy link sztuka → wyrób gotowy (traceability fundament B) ──
    "ALTER TABLE finished_units ADD COLUMN IF NOT EXISTS source_finished_goods_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_finished_units_goods ON finished_units(source_finished_goods_id) WHERE source_finished_goods_id IS NOT NULL",

    # ── Produkty uboczne rozbioru (ABP — kości/grzbiety/inne) z utylizacją (C) ──
    """CREATE TABLE IF NOT EXISTS byproduct_lots (
        id TEXT PRIMARY KEY,
        deboning_entry_id TEXT REFERENCES deboning_entries(id) ON DELETE CASCADE,
        raw_batch_id TEXT,
        raw_batch_no TEXT,
        kind TEXT NOT NULL,
        kg NUMERIC(10,3) NOT NULL DEFAULT 0,
        destination TEXT,
        doc_ref TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        disposed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        CONSTRAINT byproduct_lots_kg_nonneg_ck CHECK (kg >= 0)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_byproduct_lots_entry ON byproduct_lots(deboning_entry_id)",
    "CREATE INDEX IF NOT EXISTS idx_byproduct_lots_raw ON byproduct_lots(raw_batch_id)",
    "CREATE INDEX IF NOT EXISTS idx_byproduct_lots_status ON byproduct_lots(status)",

    # ── Dokument WZ (Wydanie Zewnętrzne) — SP-1 ──
    """CREATE TABLE IF NOT EXISTS wz_documents (
        id TEXT PRIMARY KEY,
        number TEXT NOT NULL,
        seq INTEGER NOT NULL DEFAULT 0,
        year_month TEXT NOT NULL DEFAULT '',
        source_type TEXT,
        source_id TEXT,
        seller JSONB DEFAULT '{}',
        buyer_name TEXT,
        buyer_address TEXT,
        buyer_nip TEXT,
        valued BOOLEAN NOT NULL DEFAULT true,
        lines JSONB DEFAULT '[]',
        total_value NUMERIC(12,2) DEFAULT 0,
        place TEXT,
        issued_date TEXT,
        release_date TEXT,
        status TEXT NOT NULL DEFAULT 'wstepny',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_wz_source ON wz_documents(source_type, source_id)",
    "CREATE INDEX IF NOT EXISTS idx_wz_number ON wz_documents(number)",
    "CREATE INDEX IF NOT EXISTS idx_wz_ym ON wz_documents(year_month)",
    # ── WZ: waluta dokumentu + kurs EUR/PLN (NBP) z dnia wystawienia ──
    "ALTER TABLE wz_documents ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'PLN'",
    "ALTER TABLE wz_documents ADD COLUMN IF NOT EXISTS eur_rate NUMERIC(10,4)",
    # ── WZ: weryfikacja przy załadunku (dokument wstępny vs faktyczny załadunek) ──
    "ALTER TABLE wz_documents ADD COLUMN IF NOT EXISTS loading_status TEXT",       # NULL|potwierdzony|rozjazd
    "ALTER TABLE wz_documents ADD COLUMN IF NOT EXISTS loading_diff JSONB",        # [{name,batch_no,doc_qty,loaded_qty,diff}]
    "ALTER TABLE wz_documents ADD COLUMN IF NOT EXISTS loaded_at TIMESTAMPTZ",
    "ALTER TABLE wz_documents ADD COLUMN IF NOT EXISTS vehicle_plate TEXT",

    # ── HDI fundament: język + miejsce przeznaczenia klienta ──
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS language TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS dest_name TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS dest_address TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS dest_city TEXT DEFAULT ''",

    # ── HDI dokumenty ──
    """CREATE TABLE IF NOT EXISTS hdi_documents (
        id           TEXT PRIMARY KEY,
        number       TEXT NOT NULL,
        seq          INTEGER NOT NULL,
        year_month   TEXT NOT NULL,
        order_id     TEXT,
        client_name  TEXT DEFAULT '',
        language     TEXT DEFAULT 'pl',
        status       TEXT NOT NULL DEFAULT 'wstepny',
        incomplete   BOOLEAN NOT NULL DEFAULT false,
        header       JSONB NOT NULL DEFAULT '{}',
        items        JSONB NOT NULL DEFAULT '[]',
        totals       JSONB NOT NULL DEFAULT '{}',
        issue_date   TEXT DEFAULT '',
        created_at   TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_hdi_status ON hdi_documents(status)",
    "CREATE INDEX IF NOT EXISTS idx_hdi_order ON hdi_documents(order_id)",

    # ── Przewoźnicy (słownik) ──
    """CREATE TABLE IF NOT EXISTS carriers (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        address       TEXT DEFAULT '',
        postal_code   TEXT DEFAULT '',
        city          TEXT DEFAULT '',
        country       TEXT DEFAULT '',
        nip           TEXT DEFAULT '',
        vat_eu        TEXT DEFAULT '',
        default_plate TEXT DEFAULT '',
        phone         TEXT DEFAULT '',
        notes         TEXT DEFAULT '',
        active        BOOLEAN NOT NULL DEFAULT true,
        created_at    TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_carriers_active ON carriers(active)",

    # ── CMR dokumenty ──
    """CREATE TABLE IF NOT EXISTS cmr_documents (
        id           TEXT PRIMARY KEY,
        number       TEXT NOT NULL,
        seq          INTEGER NOT NULL,
        order_id     TEXT,
        client_name  TEXT DEFAULT '',
        carrier_id   TEXT,
        status       TEXT NOT NULL DEFAULT 'wystawiony',
        payload      JSONB NOT NULL DEFAULT '{}',
        issue_date   TEXT DEFAULT '',
        created_at   TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_cmr_order ON cmr_documents(order_id)",
    "CREATE INDEX IF NOT EXISTS idx_cmr_created ON cmr_documents(created_at)",

    # ── Konfiguracja układu druku CMR (pozycje pól nakładanych na druk) ──
    """CREATE TABLE IF NOT EXISTS cmr_layout (
        id          TEXT PRIMARY KEY,
        positions   JSONB NOT NULL DEFAULT '{}',
        updated_at  TIMESTAMPTZ DEFAULT now()
    )""",

    """CREATE TABLE IF NOT EXISTS cartons (
        id              TEXT PRIMARY KEY,
        order_id        TEXT,
        client_name     TEXT DEFAULT '',
        product_type_id TEXT DEFAULT '',
        recipe_id       TEXT DEFAULT '',
        tuleja          TEXT DEFAULT '',
        target_qty      INTEGER NOT NULL DEFAULT 0,
        target_weight_kg NUMERIC NOT NULL DEFAULT 0,
        packed_qty      INTEGER NOT NULL DEFAULT 0,
        status          TEXT NOT NULL DEFAULT 'open',
        pallet_id       TEXT,
        created_at      TIMESTAMPTZ DEFAULT now(),
        closed_at       TIMESTAMPTZ
    )""",
    "CREATE INDEX IF NOT EXISTS idx_cartons_status ON cartons(status)",

    # ── QR per sztuka — Faza 2: termin przydatności w recepturze ──
    "ALTER TABLE recipes ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER NOT NULL DEFAULT 5",

    # ── QR per sztuka — Faza 3: szablony etykiet (per klient+receptura) ──
    """CREATE TABLE IF NOT EXISTS label_templates (
        id              TEXT PRIMARY KEY,
        client_id       TEXT NOT NULL DEFAULT '',
        recipe_id       TEXT NOT NULL DEFAULT '',
        kind            TEXT NOT NULL DEFAULT 'overlay',
        background_data TEXT DEFAULT '',
        field_positions JSONB NOT NULL DEFAULT '{}',
        page_size       TEXT NOT NULL DEFAULT 'a4',
        labels_per_sheet INTEGER NOT NULL DEFAULT 2,
        zpl             TEXT DEFAULT '',
        updated_at      TIMESTAMPTZ DEFAULT now(),
        UNIQUE (client_id, recipe_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_label_templates_client_recipe ON label_templates(client_id, recipe_id)",

    # ── QR per sztuka — Faza 3+: oryginalny PDF tła etykiety (wektorowy) ──
    "ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS background_pdf TEXT DEFAULT ''",

    # ── QR per sztuka — Faza 3++: korekta offsetu per slot (auto 2. etykieta) ──
    "ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS slot_offsets JSONB DEFAULT '[]'",
    # ── Kalibracja druku: kompensacja ucinanego paska (przesunięcie X/Y w mm + skala %) ──
    "ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS print_calib JSONB NOT NULL DEFAULT '{}'",
    # ── Pozycje pól per slot (etykieta 2+): ręczne ustawienie KAŻDEGO pola osobno na
    #    nierównej etykiecie (gdy globalny offset nie wystarcza). {slot: {fieldKey: {x,y,...}}} ──
    "ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS slot_field_positions JSONB NOT NULL DEFAULT '{}'",

    # ── Rodzaje surowca — przyjęcie nie tylko ćwiartki (filet, indyk; ──
    # ── w przyszłości kategoria 'czerwone': wołowina 80/20, łój itd.) ──
    """CREATE TABLE IF NOT EXISTS raw_material_types (
        id                TEXT PRIMARY KEY,
        name              TEXT NOT NULL UNIQUE,
        requires_deboning BOOLEAN NOT NULL DEFAULT false,
        category          TEXT NOT NULL DEFAULT 'drob',
        active            BOOLEAN NOT NULL DEFAULT true,
        created_at        TIMESTAMPTZ DEFAULT now()
    )""",
    # Rozróżnienie kontekstu rodzaju surowca:
    #   receivable=true            → pokazuje się przy PRZYJĘCIU (ćwiartka, filet, indyk,
    #                                mięso z/s — od 2026-07 także dostawy zewnętrzne z/s)
    #   requires_deboning=false    → MASOWALNY wprost, pokazuje się w SKŁADZIE rodzaju
    #                                (mięso z/s, filet, indyk — NIE ćwiartka)
    # 'Mięso z/s' powstaje z rozbioru ORAZ bywa kupowane z zewnątrz: receivable=true,
    # requires_deboning=false → przyjęcie od razu tworzy lot w meat_stock (ta sama
    # ścieżka co filet), material_type_id=mat-mieso-zs włącza je w Auto-FEFO masowania.
    "ALTER TABLE raw_material_types ADD COLUMN IF NOT EXISTS receivable BOOLEAN NOT NULL DEFAULT true",
    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS material_type_id TEXT",
    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS material_name TEXT DEFAULT ''",
    # Rodzaj płynie przez cały łańcuch: magazyn mięsa → masowanie → mięso
    # przyprawione (komponenty kebaba w Fazie B wybierają partie po rodzaju).
    "ALTER TABLE meat_stock ADD COLUMN IF NOT EXISTS material_type_id TEXT",
    "ALTER TABLE meat_stock ADD COLUMN IF NOT EXISTS material_name TEXT DEFAULT ''",
    "ALTER TABLE seasoned_meat ADD COLUMN IF NOT EXISTS material_type_id TEXT",
    "ALTER TABLE seasoned_meat ADD COLUMN IF NOT EXISTS material_name TEXT DEFAULT ''",
    # ── Plan dnia masowania: kolejność zleceń (operator jedzie 1→n) ──
    "ALTER TABLE mixing_orders ADD COLUMN IF NOT EXISTS day_seq INTEGER DEFAULT 0",

    # ── Skład produkcyjny receptury (kebab komponentowy, np. 70/30) ──
    # [{"materialTypeId","materialName","pct"}] — pusta lista = produkt
    # jednoskładnikowy (dotychczasowe zachowanie bez zmian)
    "ALTER TABLE recipes ADD COLUMN IF NOT EXISTS components JSONB DEFAULT '[]'",

    # ── Auth: konta i sesje ──
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS departments JSONB DEFAULT '[]'",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS pin_hash TEXT",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS failed_attempts INT DEFAULT 0",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ",
    """CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY,
        login TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'office',
        display_name TEXT NOT NULL DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT true,
        must_change_password BOOLEAN NOT NULL DEFAULT false,
        failed_attempts INT NOT NULL DEFAULT 0,
        locked_until TIMESTAMPTZ,
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        label TEXT DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL,
        last_seen TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ
    )""",
    # Bazy utworzone przed dodaniem idle-timeoutu sesji mogą nie mieć kolumny.
    "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ",

    # ── Przyprawione: rozdzielenie partii per (produkt + surowiec + dzień) ──
    "ALTER TABLE seasoned_meat ADD COLUMN IF NOT EXISTS production_day date DEFAULT CURRENT_DATE",
    "UPDATE seasoned_meat SET production_day = created_at::date WHERE production_day IS NULL",
    "ALTER TABLE seasoned_meat DROP CONSTRAINT IF EXISTS seasoned_meat_batch_no_key",
    "CREATE UNIQUE INDEX IF NOT EXISTS seasoned_meat_recipe_batch_day_key "
    "ON seasoned_meat (recipe_id, batch_no, production_day)",

    # ── Audit log (kto/co/kiedy — compliance/ślad zmian) ──
    """CREATE TABLE IF NOT EXISTS audit_log (
        id      BIGSERIAL PRIMARY KEY,
        at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        subject TEXT,
        method  TEXT NOT NULL,
        path    TEXT NOT NULL,
        status  INTEGER,
        ip      TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at DESC)",

    # ── Karton magazynowy: nagłówek + pozycje (skład mieszany) ──
    """CREATE TABLE IF NOT EXISTS stock_carton_lines (
        id                TEXT PRIMARY KEY,
        carton_id         TEXT NOT NULL,
        recipe_id         TEXT DEFAULT '',
        recipe_name       TEXT DEFAULT '',
        product_type_id   TEXT DEFAULT '',
        product_type_name TEXT DEFAULT '',
        packaging_id      TEXT DEFAULT '',
        packaging_name    TEXT DEFAULT '',
        kg_per_unit       NUMERIC NOT NULL DEFAULT 0,
        target_qty        INTEGER NOT NULL DEFAULT 0,
        packed_qty        INTEGER NOT NULL DEFAULT 0
    )""",
    "CREATE INDEX IF NOT EXISTS idx_stock_carton_lines_carton ON stock_carton_lines(carton_id)",

    # ── Wizualny projektant etykiet Zebra (Z-Design-1) ──
    """CREATE TABLE IF NOT EXISTS zebra_label_designs (
        id          TEXT PRIMARY KEY,
        recipe_id   TEXT NOT NULL DEFAULT '',
        size_key    TEXT NOT NULL DEFAULT '',
        width_mm    NUMERIC NOT NULL DEFAULT 100,
        height_mm   NUMERIC NOT NULL DEFAULT 150,
        dpi         INTEGER NOT NULL DEFAULT 203,
        elements    JSONB NOT NULL DEFAULT '[]',
        updated_at  TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_zebra_designs_recipe_size ON zebra_label_designs(recipe_id, size_key)",
    "CREATE INDEX IF NOT EXISTS idx_zebra_designs_recipe ON zebra_label_designs(recipe_id)",
    # Tło ZPL wklejone z Zebra Designer (statyka 1:1) — pola dynamiczne nakładane na wierzch.
    "ALTER TABLE zebra_label_designs ADD COLUMN IF NOT EXISTS background_zpl TEXT NOT NULL DEFAULT ''",
    # Projekt Zebra teraz per (klient + receptura) — jak szablon PDF. Wybieramy klienta
    # i recepturę, tworzymy etykietę. size_key zostaje jako metadana rozmiaru.
    "ALTER TABLE zebra_label_designs ADD COLUMN IF NOT EXISTS client_id TEXT NOT NULL DEFAULT ''",
    "DROP INDEX IF EXISTS uq_zebra_designs_recipe_size",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_zebra_designs_client_recipe ON zebra_label_designs(client_id, recipe_id)",
    # Klient pod nadzorem HALAL → etykieta dostaje pole „kod nadzoru" (org_code).
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS halal_supervision BOOLEAN NOT NULL DEFAULT false",
    # Kolejność składników receptury — bez niej Postgres nie gwarantuje kolejności
    # wierszy (SELECT bez ORDER BY), więc operator widział przyprawy w innej
    # kolejności niż planista je dodawał. seq ustawiany przy tworzeniu/edycji
    # receptury wg kolejności w formularzu (recipes_service.py).
    "ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS seq INTEGER NOT NULL DEFAULT 0",
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
    _seed_raw_material_types()
    _seed_mixed_seq()
    _seed_vehicles()
    _backfill_lineage()
    _backfill_ingredient_receipts()
    _migrate_plan_reservations_to_kg_reserved()
    _add_finished_units_goods_fk()
    _backfill_unit_goods_links()
    _backfill_byproduct_lots()
    _backfill_stock_carton_lines()
    _backfill_recipe_ingredients_seq()
    logger.info("migrations.done")


def _backfill_stock_carton_lines() -> None:
    """Każdy istniejący (jednorodny) karton bez pozycji → jedna pozycja z jego składu."""
    try:
        from app.utils.ids import cuid

        legacy = query_all(
            """SELECT sc.* FROM stock_cartons sc
               WHERE NOT EXISTS (
                   SELECT 1 FROM stock_carton_lines l WHERE l.carton_id = sc.id)"""
        )
        for c in legacy:
            execute(
                """INSERT INTO stock_carton_lines
                     (id, carton_id, recipe_id, recipe_name, product_type_id,
                      product_type_name, packaging_id, packaging_name,
                      kg_per_unit, target_qty, packed_qty)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (cuid(), c["id"], c.get("recipe_id") or "", c.get("recipe_name") or "",
                 c.get("product_type_id") or "", c.get("product_type_name") or "",
                 c.get("packaging_id") or "", c.get("packaging_name") or "",
                 float(c.get("kg_per_unit") or 0), int(c.get("target_qty") or 0),
                 int(c.get("packed_qty") or 0)),
            )
    except Exception as exc:
        logger.warning(
            "migrations.backfill_stock_carton_lines.failed", extra={"error": str(exc)}
        )


def _backfill_byproduct_lots() -> None:
    """Wygeneruj loty ABP dla historycznych rozbiorów (idempotentne)."""
    try:
        from app.services.byproducts_service import backfill_byproduct_lots

        backfill_byproduct_lots()
    except Exception as exc:
        logger.warning(
            "migrations.backfill_byproduct_lots.failed", extra={"error": str(exc)}
        )


def _add_finished_units_goods_fk() -> None:
    """Dodaj FK finished_units.source_finished_goods_id → finished_goods(id).

    Postgres nie ma ADD CONSTRAINT IF NOT EXISTS — sprawdzamy pg_constraint.
    ON DELETE SET NULL: usunięcie wyrobu nie kasuje sztuk, tylko zrywa link
    (wtedy wykryje to detektor sierot w lineage_health).
    """
    try:
        exists = query_one(
            "SELECT 1 FROM pg_constraint WHERE conname = 'finished_units_goods_fk'"
        )
        if exists:
            return
        execute(
            """
            ALTER TABLE finished_units
            ADD CONSTRAINT finished_units_goods_fk
            FOREIGN KEY (source_finished_goods_id)
            REFERENCES finished_goods(id) ON DELETE SET NULL
            """
        )
        logger.info("migrations.finished_units_goods_fk.added")
    except Exception as exc:
        logger.warning(
            "migrations.finished_units_goods_fk.failed", extra={"error": str(exc)}
        )


def _backfill_unit_goods_links() -> None:
    """Podłącz istniejące sztuki do wyrobów gotowych (idempotentne)."""
    try:
        from app.services.finished_units_service import backfill_unit_goods_links

        backfill_unit_goods_links()
    except Exception as exc:
        logger.warning(
            "migrations.backfill_unit_goods_links.failed", extra={"error": str(exc)}
        )


def _backfill_ingredient_receipts() -> None:
    """Backfill receipt metadata from invoice-linked stock movements."""
    try:
        row = query_one(
            """
            WITH updated AS (
                UPDATE ingredient_stock s
                SET
                    price_per_unit = CASE
                        WHEN COALESCE(s.price_per_unit, 0) = 0
                            THEN COALESCE(i.unit_price, 0)
                        ELSE s.price_per_unit
                    END,
                    invoice_no = COALESCE(s.invoice_no, i.invoice_no),
                    received_date = COALESCE(s.received_date, i.invoice_date),
                    supplier_id = COALESCE(s.supplier_id, i.supplier_id),
                    notes = CASE
                        WHEN COALESCE(s.notes, '') = ''
                            THEN COALESCE(i.notes, '')
                        ELSE s.notes
                    END
                FROM stock_movements sm
                JOIN invoices i ON i.id = sm.source_id
                WHERE sm.batch_id = s.id
                  AND sm.product_type = 'ingredient'
                  AND sm.source_type = 'invoice'
                  AND i.category = 'PRZYPRAWY_I_DODATKI'
                  AND (
                      COALESCE(s.price_per_unit, 0) = 0
                      OR s.invoice_no IS NULL
                      OR s.received_date IS NULL
                      OR s.supplier_id IS NULL
                      OR COALESCE(s.notes, '') = ''
                  )
                RETURNING s.id
            )
            SELECT COUNT(*)::int AS cnt FROM updated
            """
        )
        fixed = int(row["cnt"]) if row and row.get("cnt") is not None else 0
        if fixed:
            logger.info(
                "migrations.backfill_ingredient_receipts.done",
                extra={"fixed": fixed},
            )
    except Exception as exc:
        logger.warning(
            "migrations.backfill_ingredient_receipts.error",
            extra={"error": str(exc)},
        )


def _seed_vehicles() -> None:
    """Wstępna lista samochodów do załadunku."""
    try:
        existing = query_one("SELECT count(*) AS n FROM vehicles")
        if existing and int(existing.get("n", 0)) > 0:
            return
        seeds = [
            ("Samochód dostawczy", "KRA621AK", "own",      "dostawczy", 10),
            ("Samochód dostawczy", "KOL 47267", "own",     "dostawczy", 20),
            ("TIR spedycja",       "",          "external", "tir",     30),
            ("SOLO spedycja",      "",          "external", "solo",    40),
        ]
        for name, plate, kind, vtype, sort_order in seeds:
            execute(
                "INSERT INTO vehicles (id, name, plate, kind, vehicle_type, sort_order, active, created_at) "
                "VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, true, now())",
                (name, plate, kind, vtype, sort_order),
            )
        logger.info("migrations.seed_vehicles.done", extra={"count": len(seeds)})
    except Exception as exc:
        logger.warning("migrations.seed_vehicles.error", extra={"error": str(exc)})


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


def _seed_raw_material_types() -> None:
    """Słownik rodzajów surowca — ćwiartka (rozbiór) + surowce bez rozbioru.
    Idempotentny; nowe rodzaje (np. wołowina 80/20, łój — kategoria
    'czerwone') dodaje się wpisem w tej tabeli, bez zmian w kodzie."""
    # (id, nazwa, requires_deboning, kategoria, receivable)
    rows = [
        ("mat-cwiartka",      "Ćwiartka z kurczaka", True,  "drob", True),
        ("mat-filet-kurczak", "Filet z kurczaka",    False, "drob", True),
        ("mat-mieso-indyk",   "Mięso z indyka",      False, "drob", True),
        # Produkt rozbioru, ale też przyjmowalny z zewnątrz (dostawy z/s) —
        # przyjęcie idzie ścieżką "bez rozbioru" wprost do meat_stock.
        ("mat-mieso-zs",      "Mięso z/s",           False, "drob", True),
    ]
    try:
        for rid, name, deb, cat, recv in rows:
            execute(
                "INSERT INTO raw_material_types (id, name, requires_deboning, category, receivable) "
                "VALUES (%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING",
                (rid, name, deb, cat, recv),
            )
        # Wymuś poprawne flagi dla 'Mięso z/s' także na istniejących bazach
        # (starsze bazy mają receivable=false z czasów, gdy z/s nie było
        # przyjmowalne z zewnątrz — od 2026-07 jest).
        execute(
            "UPDATE raw_material_types SET requires_deboning=false, receivable=true "
            "WHERE id='mat-mieso-zs'"
        )
        # Istniejące partie bez rodzaju = ćwiartka (jedyny dotychczasowy surowiec)
        execute(
            "UPDATE raw_batches SET material_type_id='mat-cwiartka', "
            "material_name='Ćwiartka z kurczaka' "
            "WHERE COALESCE(material_type_id,'')=''"
        )
        execute(
            "UPDATE meat_stock SET material_type_id='mat-cwiartka', "
            "material_name='Ćwiartka z kurczaka' "
            "WHERE COALESCE(material_type_id,'')=''"
        )
        _migrate_cwiartka_to_mieso_zs()
    except Exception as exc:
        logger.warning("migrations.seed_raw_material_types.error", extra={"error": str(exc)})


def _migrate_cwiartka_to_mieso_zs() -> None:
    """Jednorazowa, idempotentna migracja: mięso z rozbioru przestaje dziedziczyć
    ćwiartkę i staje się odrębnym rodzajem 'Mięso z/s'.

    - meat_stock/seasoned_meat z `mat-cwiartka` = produkty rozbioru → `mat-mieso-zs`.
      (Surowiec ćwiartka nigdy nie trafia do meat_stock/seasoned — tam jest tylko
       wynik rozbioru albo filet, więc retag jest bezpieczny.)
    - raw_batches ZOSTAJĄ ćwiartką (to faktyczny surowiec wejściowy).
    - product_types.components: `mat-cwiartka` → `mat-mieso-zs`; komponenty nazwane
      'MIĘSO Z/S' bez materialTypeId dostają `mat-mieso-zs`.
    """
    execute(
        "UPDATE meat_stock SET material_type_id='mat-mieso-zs', material_name='Mięso z/s' "
        "WHERE material_type_id='mat-cwiartka'"
    )
    execute(
        "UPDATE seasoned_meat SET material_type_id='mat-mieso-zs', material_name='Mięso z/s' "
        "WHERE material_type_id='mat-cwiartka'"
    )
    # Składy rodzajów produktu — przepisanie JSONB po stronie Pythona.
    pts = query_all(
        "SELECT id, components FROM product_types "
        "WHERE jsonb_array_length(COALESCE(components,'[]')) > 0"
    )
    for pt in pts:
        comps = pt.get("components") or []
        if isinstance(comps, str):
            try:
                comps = json.loads(comps)
            except Exception:
                continue
        changed = False
        for c in comps:
            if not isinstance(c, dict):
                continue
            mat = c.get("materialTypeId") or c.get("material_type_id") or ""
            name = (c.get("name") or "").strip().upper().replace("Ę", "E")
            if mat == "mat-cwiartka":
                c["materialTypeId"] = "mat-mieso-zs"
                c["name"] = "Mięso z/s"
                changed = True
            elif not mat and name in ("MIESO Z/S", "MIESO Z S", "MIESOZS"):
                c["materialTypeId"] = "mat-mieso-zs"
                changed = True
        if changed:
            execute(
                "UPDATE product_types SET components=%s::jsonb WHERE id=%s",
                (json.dumps(comps), pt["id"]),
            )


def _seed_mixed_seq() -> None:
    """Ensure the mixed_seq sequence row exists."""
    try:
        execute(
            "INSERT INTO sequences (key, value) VALUES ('mixed_seq', 0) "
            "ON CONFLICT (key) DO NOTHING"
        )
    except Exception as exc:
        logger.warning("migrations.seed_mixed_seq.error", extra={"error": str(exc)})


def _migrate_plan_reservations_to_kg_reserved() -> None:
    """Jednorazowo przenosi rezerwacje aktywnych/szkicowych planów z
    kg_available/kg_used na nowe pole kg_reserved.

    Poprzednia wersja _apply_reservations w production_plans_service
    dekrementowała kg_available i inkrementowała kg_used już przy
    utworzeniu planu — traktując rezerwację jak konsumpcję. Po fixie
    rezerwacja siedzi w kg_reserved, a konsumpcja dzieje się dopiero w
    finish_day. Ta funkcja "odwija" stary stan dla planów które jeszcze
    nie zostały zamknięte (status != 'done').

    Idempotentna przez marker w app_settings — uruchamia się tylko raz.
    """
    try:
        marker = query_one(
            "SELECT key FROM app_settings WHERE key='migration_kg_reserved_v1'"
        )
        if marker:
            return
        with transaction() as conn:
            plans = cx_query_all(
                conn,
                "SELECT id, plan_no FROM production_plans "
                "WHERE status IN ('draft', 'active')",
            )
            touched_batches = 0
            total_kg_moved = 0.0
            for p in plans:
                lines = cx_query_all(
                    conn,
                    "SELECT batch_allocation FROM production_plan_lines WHERE plan_id=%s",
                    (p["id"],),
                )
                for line in lines:
                    ba = line.get("batch_allocation") or {}
                    if isinstance(ba, str):
                        try:
                            ba = json.loads(ba)
                        except Exception:
                            ba = {}
                    if not isinstance(ba, dict):
                        continue
                    for alloc in ba.values():
                        if not isinstance(alloc, dict):
                            continue
                        bid = alloc.get("batch_id")
                        kg = float(alloc.get("kg") or 0)
                        if not bid or kg <= 0:
                            continue
                        cx_execute(
                            conn,
                            """
                            UPDATE seasoned_meat
                            SET kg_available = kg_available + %s,
                                kg_used      = GREATEST(0, kg_used - %s),
                                kg_reserved  = COALESCE(kg_reserved, 0) + %s
                            WHERE id = %s
                            """,
                            (kg, kg, kg, bid),
                        )
                        touched_batches += 1
                        total_kg_moved += kg
            cx_execute(
                conn,
                """
                INSERT INTO app_settings (key, value, updated_at)
                VALUES ('migration_kg_reserved_v1', %s::jsonb, now())
                ON CONFLICT (key) DO NOTHING
                """,
                (json.dumps({
                    "plans": len(plans),
                    "rows_touched": touched_batches,
                    "kg_moved": round(total_kg_moved, 3),
                }),),
            )
        logger.info(
            "migrations.kg_reserved_v1.done",
            extra={
                "plans": len(plans),
                "rows_touched": touched_batches,
                "kg_moved": round(total_kg_moved, 3),
            },
        )
    except Exception as exc:
        logger.warning(
            "migrations.kg_reserved_v1.error",
            extra={"error": str(exc)},
        )


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


def _backfill_recipe_ingredients_seq() -> None:
    """Nadaje seq recepturom sprzed kolumny — kolejność wg id (najlepsze
    przybliżenie, prawdziwej kolejności dodawania nie da się odzyskać).
    Celuje TYLKO w receptury, gdzie wszystkie wiersze mają jeszcze seq=0
    (czyli nikt ich nie ustawił po tej migracji) i jest ich więcej niż
    jedna — inaczej nadpisywałaby też świeżo utworzone, poprawne kolejności
    złożone z samej pozycji 0 (receptura z jednym składnikiem)."""
    try:
        execute(
            """
            WITH multi AS (
                SELECT recipe_id
                FROM recipe_ingredients
                GROUP BY recipe_id
                HAVING COUNT(*) > 1 AND MAX(seq) = 0
            ),
            ordered AS (
                SELECT ri.id, ROW_NUMBER() OVER (
                    PARTITION BY ri.recipe_id ORDER BY ri.id
                ) - 1 AS new_seq
                FROM recipe_ingredients ri
                JOIN multi m ON m.recipe_id = ri.recipe_id
            )
            UPDATE recipe_ingredients ri
            SET seq = ordered.new_seq
            FROM ordered
            WHERE ordered.id = ri.id
            """
        )
    except Exception as exc:
        logger.warning(
            "migrations.backfill_recipe_ingredients_seq.error", extra={"error": str(exc)}
        )
