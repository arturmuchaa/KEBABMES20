"""Startup migrations — idempotent schema changes run once at boot.

Every statement MUST be safe to re-run (IF NOT EXISTS, ADD COLUMN IF NOT EXISTS).
Never DROP or ALTER TYPE in a way that destroys data.
"""
import json
import re
from typing import Dict, List

from app.db import cx_execute, cx_query_all, execute, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.pallets import pallet_containers

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
    # ── Ważenie zbiorcze mięsa: równe palety i wózki dla masowni.
    #    To OPIS ułożenia, nie stan — mięso jest na stanie od rozbioru, więc
    #    ten zapis NIE generuje żadnych ruchów magazynowych.
    """CREATE TABLE IF NOT EXISTS meat_pallets (
        id              TEXT PRIMARY KEY,
        pallet_no       TEXT UNIQUE NOT NULL,
        target_kg       NUMERIC NOT NULL,
        stack_kg        NUMERIC,
        kg_net          NUMERIC NOT NULL,
        containers      INTEGER NOT NULL DEFAULT 0,
        carrier_label   TEXT NOT NULL DEFAULT '',
        carrier_kg      NUMERIC NOT NULL DEFAULT 0,
        operator        TEXT DEFAULT '',
        production_date DATE NOT NULL,
        expiry_date     DATE,
        created_at      TIMESTAMPTZ DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS meat_pallet_lots (
        id        TEXT PRIMARY KEY,
        pallet_id TEXT NOT NULL REFERENCES meat_pallets(id) ON DELETE CASCADE,
        lot_no    TEXT NOT NULL,
        kg        NUMERIC NOT NULL,
        seq       INTEGER NOT NULL DEFAULT 0
    )""",
    "CREATE INDEX IF NOT EXISTS idx_meat_pallet_lots_pallet ON meat_pallet_lots(pallet_id)",
    "CREATE INDEX IF NOT EXISTS idx_meat_pallets_day ON meat_pallets(production_date)",
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
    # Wpisy zapisane „za jednym razem" (ZAPISZ na HMI) nie miały completed_at,
    # więc kartoteka pracownika pokazywała pustą kolumnę „Zważono" przy
    # ważeniach zrobionych na wadze (prod 2026-08-14, DAWID 75 kg). Dla wpisu
    # jednoetapowego moment zapisu JEST momentem zważenia. Idempotentne —
    # po przebiegu nie ma już wierszy do uzupełnienia.
    "UPDATE deboning_entries SET completed_at = created_at "
    "WHERE completed_at IS NULL AND COALESCE(status, 'complete') = 'complete'",

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
    # Korekty kilogramów liczone WYŁĄCZNIE do płacy — nie ruszają
    # deboning_entries ani stanów magazynowych (praca nieujęta w ważeniu).
    """CREATE TABLE IF NOT EXISTS payroll_kg_adjustments (
        id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        work_date DATE NOT NULL,
        kg_delta NUMERIC(10,3) NOT NULL,
        reason TEXT NOT NULL,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_pka_worker_date "
    "ON payroll_kg_adjustments (worker_id, work_date)",

    # ── Postęp produkcji per linia (live update z tabletu) ──
    # Kolejność pozycji planu = kolejność wpisywania przez planistę. Bez tej
    # kolumny odczyty szły bez ORDER BY, więc baza zwracała pozycje w dowolnej
    # kolejności (i innej po każdej edycji) — karta produkcji dla kierownika
    # musi mieć je dokładnie tak, jak je zaplanowano.
    "ALTER TABLE production_plan_lines ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0",
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
    # Ptaszki per dokument: na których dokumentach stosować miejsce
    # przeznaczenia (np. ISSA: CMR → Farmex, HDI → adres odbiorcy).
    # Default true = dotychczasowe zachowanie (przeznaczenie wszędzie).
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS dest_for_hdi BOOLEAN NOT NULL DEFAULT true",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS dest_for_cmr BOOLEAN NOT NULL DEFAULT true",

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
    # Grupy odbiorców: jeden kontrahent bywa kilkoma spółkami (YALCIN — dwie,
    # oddziały Wrocławia — pięć). Towar zrobiony dla jednej ma pokrywać
    # zamówienia pozostałych, bo dla hali to jeden odbiorca.
    """CREATE TABLE IF NOT EXISTS client_groups (
        id          text PRIMARY KEY,
        name        text NOT NULL,
        created_at  timestamptz DEFAULT now()
    )""",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS group_id text",
    "CREATE INDEX IF NOT EXISTS idx_clients_group ON clients(group_id)",
    # HDI do RĘCZNEGO WZ (sprzedaż wyrobu z magazynu, bez zamówienia).
    # `order_id` zostaje wtedy puste — dokument wisi na WZ.
    "ALTER TABLE hdi_documents ADD COLUMN IF NOT EXISTS wz_id text",
    "CREATE INDEX IF NOT EXISTS idx_hdi_wz ON hdi_documents(wz_id)",

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

    # ── Numeracja CMR jak HDI: NN/MM/RR, od 1 w każdym miesiącu ──
    "ALTER TABLE cmr_documents ADD COLUMN IF NOT EXISTS year_month TEXT",
    # Backfill starych dokumentów: year_month z created_at, a płaskie numery
    # ('1', '2') na format NN/MM/RR — porządkowa część zostaje ta sama.
    "UPDATE cmr_documents SET year_month = to_char(created_at, 'YYMM') WHERE year_month IS NULL",
    "UPDATE cmr_documents SET number = seq::text || '/' || to_char(created_at, 'MM/YY') "
    "WHERE position('/' in number) = 0",

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
    # Dzień PLANOWANEJ produkcji, odróżniony od created_at (kiedy wiersz
    # powstał w bazie) — pozwala zaplanować masowanie na przyszły dzień,
    # zanim surowiec fizycznie trafi na magazyn. Bez tego "dzień planu"
    # był zawsze created_at::date (tylko dziś).
    "ALTER TABLE mixing_orders ADD COLUMN IF NOT EXISTS plan_date DATE",
    "UPDATE mixing_orders SET plan_date = created_at::date WHERE plan_date IS NULL",
    # Żywy licznik pojemników na locie ubocznych (grzbiety/kości) — do tej
    # pory "containers" na WZ było tylko wyliczane z palet ważenia (zawsze
    # PEŁNA liczba, nigdy nie malało przy wydaniu). Teraz WZ dekrementuje
    # tę kolumnę, edycja/anulowanie WZ koryguje ją z powrotem.
    "ALTER TABLE byproduct_lots ADD COLUMN IF NOT EXISTS containers_available INTEGER",
    # Materiały zużyte w dniu produkcyjnym (folia stretch i kolejne).
    # `packaging.kg_used` jest NARASTAJĄCE — nie odpowie na pytanie „ile folii
    # poszło 25.08", a tego potrzebuje koszt dnia. Zapis musi też przeżyć
    # zamknięcie planu, bo koszt liczy się po fakcie, czasem po tygodniu.
    """
    CREATE TABLE IF NOT EXISTS production_day_materials (
        id           TEXT PRIMARY KEY,
        work_date    DATE NOT NULL,
        packaging_id TEXT NOT NULL,
        qty          NUMERIC(12,3) NOT NULL,
        kind         TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by   TEXT DEFAULT '',
        CONSTRAINT production_day_materials_kind_ck
            CHECK (kind IN ('pobranie','zwrot')),
        CONSTRAINT production_day_materials_qty_ck CHECK (qty > 0)
    )
    """,
    "CREATE INDEX IF NOT EXISTS production_day_materials_dzien_idx "
    "ON production_day_materials (work_date, packaging_id)",

    # Foliowanie — kilogramy zafoliowane przez konkretną osobę w danym dniu.
    # Pracy foliowczyka nie widać w liczniku sztuk (foliuje to, co zrobiła cała
    # linia), a wchodzi do płacy tak samo jak układanie. UNIQUE na (dzień,
    # pracownik), bo poprawka ma nadpisywać, nie dopisywać drugiej kwoty.
    """
    CREATE TABLE IF NOT EXISTS production_wrapping (
        id          TEXT PRIMARY KEY,
        work_date   DATE NOT NULL,
        worker_id   TEXT NOT NULL,
        worker_name TEXT DEFAULT '',
        kg          NUMERIC(12,2) NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by  TEXT DEFAULT '',
        CONSTRAINT production_wrapping_kg_ck CHECK (kg > 0)
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS production_wrapping_dzien_osoba_idx "
    "ON production_wrapping (work_date, worker_id)",

    # Tuleje zdejmowane NA BIEŻĄCO przy zapisie sztuk. Licznik mówi, ile już
    # zeszło z tej linii, żeby finish_day nie zdjął ich drugi raz przy
    # potwierdzeniu biura (i żeby dni bez kiosku działały jak dotąd).
    "ALTER TABLE production_plan_lines ADD COLUMN IF NOT EXISTS packaging_used INTEGER NOT NULL DEFAULT 0",

    # Sztuka weszła na magazyn wyrobu gotowego już przy skanie QR na hali.
    # Bez tego znacznika potwierdzenie dnia dopisałoby ją drugi raz (skan
    # tworzy wyrób „na bieżąco", finish_day dopisuje wyłącznie resztę).
    "ALTER TABLE finished_units ADD COLUMN IF NOT EXISTS stock_booked_at TIMESTAMPTZ",

    # Foliowczyk — znacznik w kartotece pracownika. Kiosk proponuje wpis
    # zafoliowanych kilogramów tylko tym osobom; bez tego okno foliowania
    # pokazuje całą zmianę i operator szuka dwóch nazwisk w dziesięciu.
    # Znacznik, nie osobna rola: foliowczyk zwykle też układa, a płaca sumuje
    # jedno i drugie.
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS is_wrapper BOOLEAN NOT NULL DEFAULT false",

    # Ślad przeniesienia sztuk między pracownikami. Sam `worker_entries` po
    # poprawce wygląda tak, jakby pomyłki nigdy nie było — a kilogramy idą do
    # wypłaty, więc musi zostać zapis kto, komu, ile i kiedy przepisał.
    """
    CREATE TABLE IF NOT EXISTS production_worker_moves (
        id             TEXT PRIMARY KEY,
        plan_id        TEXT NOT NULL,
        plan_line_id   TEXT NOT NULL,
        from_worker_id TEXT NOT NULL,
        to_worker_id   TEXT NOT NULL,
        pieces         INTEGER NOT NULL,
        moved_by       TEXT DEFAULT '',
        moved_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT production_worker_moves_pieces_ck CHECK (pieces > 0)
    )
    """,
    "CREATE INDEX IF NOT EXISTS production_worker_moves_linia_idx "
    "ON production_worker_moves (plan_line_id, moved_at DESC)",

    # CHECK w bazie nie nadążył za app/utils/stock.py: VALID_MOVEMENT_TYPES
    # ma od dawna też ADJUST/CANCEL, ale baza znała tylko IN/OUT/TRANSFORM —
    # każdy ruch tych dwóch typów (np. zwrot stanu po anulowaniu WZ) padał
    # na CheckViolation. Poszerzamy CHECK do zgodności z kodem.
    "ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check",
    "ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check "
    "CHECK (movement_type = ANY (ARRAY['IN','OUT','TRANSFORM','ADJUST','CANCEL']))",
    # Ręczna korekta/zamknięcie partii przyprawionej (uzgodnienie teoria↔fizyka):
    # ślad audytowy (kto/kiedy/dlaczego) dla kosztu i dokumentów weterynaryjnych.
    "ALTER TABLE seasoned_meat ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ",
    "ALTER TABLE seasoned_meat ADD COLUMN IF NOT EXISTS reconcile_reason TEXT",
    # Ręczne zamknięcie ważenia ubocznych partii. Kafel na HMI trzyma się
    # bilansu masy, więc partia z ŚWIADOMĄ korektą z biura (np. usunięta
    # paleta, której fizycznie nie było — 437, 28.07.2026) wisiałaby
    # operatorowi w nieskończoność jako „niedoważona". Zamknięcie to decyzja
    # biura ze śladem kto/kiedy/dlaczego — nie zmienia ani kilogramów, ani
    # procentów, wyłącznie zdejmuje kafel.
    # Mięso b/s (bez skóry) z rozbioru — rzadka ścieżka (~30 kg/tydzień) obok
    # z/s. Rodzaj zapisujemy i na wpisie (raport/uzysk: b/s ma normę ~50–55%,
    # nie 63–68%), i na KAŻDEJ porcji ważenia (porcja trafia na lot od razu,
    # więc to ona decyduje, dokąd idzie mięso). Domyślnie 'zs' — przełącznik
    # na HMI nie może zmieniać zachowania zwykłej ścieżki.
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS meat_type TEXT NOT NULL DEFAULT 'zs'",
    # Obsada stanowiska rozbioru: część brygady pracuje we DWOJE, a wpisy idą
    # na jedno nazwisko. Bez tego surowe kg/h takiego stanowiska jest dwa razy
    # zawyżone (Anatolii 214 kg/h vs Olha 104 — w rzeczywistości 107 vs 104,
    # lipiec 2026). Wpływa WYŁĄCZNIE na tempo: kilogramy i uzysk zostają, bo
    # akord płaci się za kg i zmiana ustawienia w biurze nie może ruszyć płac.
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS crew_size INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE deboning_take_weighings ADD COLUMN IF NOT EXISTS meat_type TEXT NOT NULL DEFAULT 'zs'",
    "ALTER TABLE batch_byproducts ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ",
    "ALTER TABLE batch_byproducts ADD COLUMN IF NOT EXISTS closed_by TEXT",
    "ALTER TABLE batch_byproducts ADD COLUMN IF NOT EXISTS closed_reason TEXT",
    # Historia korekt wpisów rozbioru z biura (zmiana pracownika/kg PO
    # zatwierdzeniu zmiany). Powód jest WYMAGANY — wsteczna zmiana akordu
    # musi mieć ślad. Diff PRZED/PO w JSONB: to czysty zapis audytowy,
    # nikt po nim nie filtruje ani nie liczy.
    """
    CREATE TABLE IF NOT EXISTS deboning_entry_corrections (
        id         TEXT PRIMARY KEY,
        entry_id   TEXT NOT NULL,
        at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        by_subject TEXT,
        reason     TEXT NOT NULL,
        changes    JSONB NOT NULL DEFAULT '{}'::jsonb
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_dec_entry ON deboning_entry_corrections(entry_id)",
    # Korekty palet ważenia zbiorczego (2026-08-24). Ten sam wzorzec co przy
    # rozbiorze: zapisujemy stan SPRZED zmiany, bo bez niego korekta jest
    # nieodróżnialna od zmyślenia.
    """
    CREATE TABLE IF NOT EXISTS meat_pallet_corrections (
        id         TEXT PRIMARY KEY,
        pallet_id  TEXT NOT NULL,
        at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        by_subject TEXT,
        reason     TEXT NOT NULL,
        changes    JSONB NOT NULL DEFAULT '{}'::jsonb
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_mpc_pallet ON meat_pallet_corrections(pallet_id)",
    # Korekty wazen ubocznych (2026-08-24). Wazenie uboczne to PALETA w JSON-ie
    # wewnatrz batch_byproducts, wiec bez tego sladu po korekcie nie zostaje
    # zadna informacja, co i dlaczego zniknelo.
    """
    CREATE TABLE IF NOT EXISTS byproduct_weighing_corrections (
        id           TEXT PRIMARY KEY,
        raw_batch_id TEXT NOT NULL,
        at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        by_subject   TEXT,
        reason       TEXT NOT NULL,
        changes      JSONB NOT NULL DEFAULT '{}'::jsonb
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_bwc_batch ON byproduct_weighing_corrections(raw_batch_id)",
    # Częściowe ważenia mięsa z otwartego pobrania — porcja = wiersz (2026-07-18).
    # Mięso schodzi z hali porcjami zanim pracownik wykroi całość; każda porcja
    # od razu wchodzi na lot mięsa, wpis zostaje 'pending' aż do domknięcia.
    """
    CREATE TABLE IF NOT EXISTS deboning_take_weighings (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES deboning_entries(id) ON DELETE CASCADE,
        kg_meat NUMERIC NOT NULL CHECK (kg_meat > 0),
        kg_gross NUMERIC,
        tare_cart_kg NUMERIC,
        tare_e2_kg NUMERIC,
        e2_count INTEGER,
        weigh_mode TEXT,
        weighed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_dtw_entry ON deboning_take_weighings(entry_id)",
    # Miesięczne migawki KPI — fundament trendu w raporcie dla zarządu.
    # Korekty rozbioru wchodzą WSTECZ (storno, zmiana partii, korekty biurowe),
    # więc liczony na żywo trend zmieniałby historię pod prezesem: lipiec
    # wydrukowany 1 sierpnia i ten sam lipiec we wrześniu podawałyby inne
    # liczby. Zamknięty miesiąc jest zamrożony; przeliczenie po korekcie to
    # świadoma decyzja biura (force) ze śladem kto/kiedy.
    # Dane rozbioru zaczynają się 7.07.2026 — tabela startuje pusta i zapełnia
    # się z każdym domkniętym miesiącem.
    """
    CREATE TABLE IF NOT EXISTS kpi_monthly_snapshots (
        id                 TEXT PRIMARY KEY,
        year_month         TEXT NOT NULL UNIQUE,
        closed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        closed_by          TEXT,
        kg_quarter         NUMERIC NOT NULL DEFAULT 0,
        kg_meat            NUMERIC NOT NULL DEFAULT 0,
        kg_backs           NUMERIC NOT NULL DEFAULT 0,
        kg_bones           NUMERIC NOT NULL DEFAULT 0,
        missing_kg         NUMERIC NOT NULL DEFAULT 0,
        avg_yield          NUMERIC,
        kg_per_hour        NUMERIC,
        quarter_cost       NUMERIC,
        labor_cost         NUMERIC,
        byproduct_revenue  NUMERIC,
        meat_cost_per_kg   NUMERIC,
        yield_point_value  NUMERIC,
        entries            INTEGER NOT NULL DEFAULT 0,
        batches            INTEGER NOT NULL DEFAULT 0,
        workers            INTEGER NOT NULL DEFAULT 0,
        prod_days          INTEGER NOT NULL DEFAULT 0,
        suppliers          JSONB NOT NULL DEFAULT '[]'::jsonb
    )
    """,
    # Usunięte przyjęcia trzymały swój numer (UNIQUE), więc nie dało się przyjąć
    # ponownie pod tym samym numerem — prod 2026-07-20: „Partia 423 już istnieje".
    # Anulowana dostawa jest z definicji nieruszona (bez rozbioru/mięsa/ubocznych),
    # więc numer wraca do puli; pierwotny numer zostaje w internal_batch_seq.
    # left() zamiast LIKE 'ANUL-%': psycopg2 czyta % w SQL jako placeholder
    # parametru (IndexError przy starcie), a runner połyka błąd instrukcji.
    "UPDATE raw_batches SET internal_batch_no = 'ANUL-' || id "
    "WHERE status='cancelled' AND left(internal_batch_no, 5) <> 'ANUL-'",

    # ── Saldo pojemników (2026-07-29) ────────────────────────────────
    # Kartoteka tożsamości: dostawca i odbiorca o TYM SAMYM NIP-ie to jeden
    # partner, więc mają jedno saldo. `suppliers`/`clients` zostają nietknięte
    # — to warstwa wyłącznie na potrzeby nośników zwrotnych.
    """CREATE TABLE IF NOT EXISTS container_partners (
        id         TEXT PRIMARY KEY,
        nip        TEXT,
        name       TEXT NOT NULL,
        address    TEXT DEFAULT '',
        active     BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_container_partners_nip "
    "ON container_partners(nip) WHERE nip IS NOT NULL AND nip <> ''",
    """CREATE TABLE IF NOT EXISTS container_partner_links (
        partner_id TEXT NOT NULL REFERENCES container_partners(id),
        ref_type   TEXT NOT NULL,
        ref_id     TEXT NOT NULL,
        PRIMARY KEY (ref_type, ref_id)
    )""",
    # UWAGA KOLEJNOŚCI: container_docs MUSI powstać przed container_movements
    # (FK doc_id). Migracje wykonują się po kolei, a błąd pojedynczej
    # instrukcji jest tylko logowany — odwrotna kolejność dałaby CICHĄ awarię
    # widoczną dopiero przy pierwszym zapisie.
    """CREATE TABLE IF NOT EXISTS container_docs (
        id               TEXT PRIMARY KEY,
        number           TEXT NOT NULL,
        seq              INTEGER NOT NULL DEFAULT 0,
        year_month       TEXT NOT NULL DEFAULT '',
        partner_id       TEXT NOT NULL REFERENCES container_partners(id),
        partner_snapshot JSONB DEFAULT '{}',
        seller           JSONB DEFAULT '{}',
        doc_date         DATE NOT NULL,
        driver           TEXT DEFAULT '',
        vehicle          TEXT DEFAULT '',
        lines            JSONB DEFAULT '[]',
        balance_after    JSONB DEFAULT '{}',
        status           TEXT NOT NULL DEFAULT 'wystawiony',
        notes            TEXT DEFAULT '',
        created_by       TEXT,
        created_at       TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_container_docs_partner ON container_docs(partner_id)",
    "CREATE INDEX IF NOT EXISTS idx_container_docs_ym ON container_docs(year_month)",
    # Księga nośników. qty ZE ZNAKIEM: dodatnie = przyjechało do nas (my
    # winni), ujemne = wyjechało od nas (oni winni). Saldo = SUM(qty).
    """CREATE TABLE IF NOT EXISTS container_movements (
        id            TEXT PRIMARY KEY,
        partner_id    TEXT NOT NULL REFERENCES container_partners(id),
        asset_type    TEXT NOT NULL,
        qty           INTEGER NOT NULL,
        source_type   TEXT NOT NULL,
        source_id     TEXT,
        doc_id        TEXT REFERENCES container_docs(id),
        movement_date DATE NOT NULL,
        confirmed     BOOLEAN NOT NULL DEFAULT false,
        note          TEXT DEFAULT '',
        created_by    TEXT,
        created_at    TIMESTAMPTZ DEFAULT now(),
        CONSTRAINT container_movements_asset_ck
            CHECK (asset_type = ANY (ARRAY['e2','pallet_h1','pallet_other']))
    )""",
    "CREATE INDEX IF NOT EXISTS idx_container_mov_partner "
    "ON container_movements(partner_id, asset_type)",
    "CREATE INDEX IF NOT EXISTS idx_container_mov_source "
    "ON container_movements(source_type, source_id)",
    "CREATE INDEX IF NOT EXISTS idx_container_mov_date ON container_movements(movement_date)",
    # Kaliber i nośniki na przyjęciu surowca. container_kg NULL = niekalibrowany
    # (containers_count wpisuje wtedy operator).
    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS container_kg NUMERIC(6,2)",
    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS containers_count INTEGER",
    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS pallets_h1 INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS pallets_other INTEGER NOT NULL DEFAULT 0",
    # Palety na dokumencie WZ. Palety są na POZIOMIE DOKUMENTU (transport wiezie
    # N palet łącznie), pojemniki zostają na pozycjach (wynikają z masy partii).
    "ALTER TABLE wz_documents ADD COLUMN IF NOT EXISTS pallets_h1 INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE wz_documents ADD COLUMN IF NOT EXISTS pallets_other INTEGER NOT NULL DEFAULT 0",
    # Powiązanie dokumentu pojemnikowego z konkretną dostawą. Przyjęcie surowca
    # JUŻ zaksięgowało nośniki, więc przy powiązaniu kolumna „Dostawa/odbiór"
    # jest tylko REFERENCJĄ na papierze — księguje się wyłącznie zwrot.
    # Bez tego jedna fizyczna dostawa 600 sztuk podbiłaby saldo o 1200.
    "ALTER TABLE container_docs ADD COLUMN IF NOT EXISTS linked_source_type TEXT",
    "ALTER TABLE container_docs ADD COLUMN IF NOT EXISTS linked_source_id TEXT",
    # Jedna dostawa bywa rozbita na KILKA partii przyjęcia (jedna ciężarówka
    # Koko → dwie partie), a druk pojemnikowy ma objąć je razem. Stąd lista
    # źródeł; kolumny pojedyncze zostają dla zgodności i prostych odczytów.
    # Liczba pojemników wpisana na WZ przez operatora. NULL = weź sumę
    # z pozycji. Bez tej kolumny pole „Pojemniki" na dokumencie sterowało
    # tylko drukiem, a saldo księgowało po cichu sumę z pozycji — operator
    # wpisywał 0, a saldo schodziło o 1741 (prod 2026-07-30).
    "ALTER TABLE wz_documents ADD COLUMN IF NOT EXISTS containers_total INTEGER",
    # Przyjęcie NA USŁUGĘ: mięso powierzone przez klienta, z którego robimy
    # kebab na jego zlecenie. Osobna seria numerów (48U, 49U…), bo towar jest
    # cudzy — mimo że leży w tym samym magazynie i normalnie się go masuje.
    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT false",
    # Rodzaje nośników rozbite na osobne salda (siatka E1, europaleta,
    # plastik, drewno) — siatki nie zwraca się europaletą. CHECK musi je
    # znać, inaczej każdy taki ruch padłby na CheckViolation.
    "ALTER TABLE container_movements DROP CONSTRAINT IF EXISTS container_movements_asset_ck",
    "ALTER TABLE container_movements ADD CONSTRAINT container_movements_asset_ck "
    "CHECK (asset_type = ANY (ARRAY['e2','net_e1','pallet_h1','pallet_euro',"
    "'pallet_plastic','pallet_wood','pallet_other']))",
    # Rodzaj wybrany w polu „inne opakowania / palety" na przyjęciu i WZ.
    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS pallets_other_kind TEXT",
    "ALTER TABLE wz_documents ADD COLUMN IF NOT EXISTS pallets_other_kind TEXT",
    # Pierwszy numer usługowy ma być 48U — sekwencja startuje z 47.
    "INSERT INTO sequences (key, value) VALUES ('service_batch_seq', 47) "
    "ON CONFLICT (key) DO NOTHING",
    "ALTER TABLE container_docs ADD COLUMN IF NOT EXISTS linked_sources JSONB DEFAULT '[]'",
    "UPDATE container_docs SET linked_sources = "
    "  jsonb_build_array(jsonb_build_object('sourceType', linked_source_type, "
    "                                       'sourceId',   linked_source_id)) "
    "WHERE linked_source_id IS NOT NULL "
    "  AND COALESCE(jsonb_array_length(linked_sources), 0) = 0",
    "CREATE INDEX IF NOT EXISTS idx_container_docs_sources "
    "ON container_docs USING gin (linked_sources)",

    # ── Godziny pracowników ogólnych ──
    # Jeden wiersz na (pracownik, dzień). `time_to` NULL = zmiana OTWARTA:
    # biuro zapisuje rano sam start (6:00) i domyka po południu, czasem
    # dopiero po dwóch dniach. `status` jest osobno, bo BRAK WIERSZA znaczy
    # „jeszcze nie wpisane", a to zupełnie co innego niż „wolne".
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS rate_per_hour NUMERIC(10,2) DEFAULT 0",
    """CREATE TABLE IF NOT EXISTS worker_hours (
        id          TEXT PRIMARY KEY,
        worker_id   TEXT NOT NULL,
        work_date   DATE NOT NULL,
        status      TEXT NOT NULL DEFAULT 'work',
        time_from   TEXT,
        time_to     TEXT,
        hours       NUMERIC(5,2),
        note        TEXT DEFAULT '',
        created_by  TEXT,
        created_at  TIMESTAMPTZ DEFAULT now(),
        updated_at  TIMESTAMPTZ DEFAULT now(),
        UNIQUE (worker_id, work_date)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_worker_hours_date ON worker_hours (work_date)",
    "ALTER TABLE worker_hours DROP CONSTRAINT IF EXISTS worker_hours_status_ck",
    "ALTER TABLE worker_hours ADD CONSTRAINT worker_hours_status_ck "
    "CHECK (status = ANY (ARRAY['work','off','vacation','sick','absent']))",

    # ── Potrącenia oczekujące ──
    # Dopisywane w dowolnym momencie (np. w poniedziałek) i czekające na
    # rozliczenie. Przy rozliczeniu przepisywane do settlement_deductions,
    # które pozostaje JEDYNYM źródłem dla paska wypłaty i druku zbiorczego.
    """CREATE TABLE IF NOT EXISTS worker_deductions (
        id             TEXT PRIMARY KEY,
        worker_id      TEXT NOT NULL,
        deduction_date DATE NOT NULL,
        description    TEXT NOT NULL,
        amount         NUMERIC(10,2) NOT NULL,
        source_type    TEXT DEFAULT 'manual',
        source_id      TEXT,
        status         TEXT DEFAULT 'pending',
        settlement_id  TEXT,
        created_by     TEXT,
        created_at     TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_worker_deductions_worker "
    "ON worker_deductions (worker_id, status, deduction_date)",
    "CREATE INDEX IF NOT EXISTS idx_worker_deductions_source "
    "ON worker_deductions (source_type, source_id)",

    # ── Rozliczenie na podstawie godzin ──
    "ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS hours_total NUMERIC(10,2) DEFAULT 0",
    "ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS rate_per_hour NUMERIC(10,2) DEFAULT 0",
    "ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS basis TEXT DEFAULT 'kg'",

    # ── Premia niedzielna (godzinowi) ──
    # Dodatek do stawki liczony WYŁĄCZNIE za godziny przepracowane
    # w niedzielę. Osobny przełącznik, bo kwotę chcemy zachować także wtedy,
    # gdy premia jest chwilowo wyłączona.
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS sunday_bonus_enabled BOOLEAN DEFAULT false",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS sunday_bonus_per_hour NUMERIC(10,2) DEFAULT 0",
    # Na rozliczeniu zapisujemy migawkę — pasek ma pokazać, ile godzin
    # niedzielnych i po jakim dodatku poszło, nawet gdy stawka się potem zmieni.
    "ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS sunday_hours NUMERIC(10,2) DEFAULT 0",
    "ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS sunday_bonus_per_hour NUMERIC(10,2) DEFAULT 0",

    # ── Druga zmiana w tym samym dniu (sporadycznie: 6-15, potem 18-20) ──
    # Unikalność schodzi z (pracownik, dzień) na (pracownik, dzień, nr) —
    # samo zdjęcie constraintu wpuściłoby przypadkowe duplikaty tej samej
    # zmiany. Istniejące wiersze dostają seq=1, więc nic nie ginie.
    "ALTER TABLE worker_hours ADD COLUMN IF NOT EXISTS seq INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE worker_hours DROP CONSTRAINT IF EXISTS worker_hours_worker_id_work_date_key",
    "ALTER TABLE worker_hours DROP CONSTRAINT IF EXISTS worker_hours_worker_date_seq_key",
    "ALTER TABLE worker_hours ADD CONSTRAINT worker_hours_worker_date_seq_key "
    "UNIQUE (worker_id, work_date, seq)",

    # ── Uznania (odwrotność potrącenia: dodatek, zwrot, premia uznaniowa) ──
    # Ta sama kolejka co potrącenia, tylko znak przeciwny. `amount` zostaje
    # DODATNIA, o kierunku decyduje `kind` — ujemne kwoty w tabeli pieniędzy
    # to proszenie się o pomyłkę przy sumowaniu.
    "ALTER TABLE worker_deductions ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'deduction'",
    "ALTER TABLE worker_deductions DROP CONSTRAINT IF EXISTS worker_deductions_kind_ck",
    "ALTER TABLE worker_deductions ADD CONSTRAINT worker_deductions_kind_ck "
    "CHECK (kind = ANY (ARRAY['deduction','credit']))",
    "ALTER TABLE settlement_deductions ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'deduction'",

    # ── Premia sobotnia (bliźniacza do niedzielnej) ──
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS saturday_bonus_enabled BOOLEAN DEFAULT false",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS saturday_bonus_per_hour NUMERIC(10,2) DEFAULT 0",
    "ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS saturday_hours NUMERIC(10,2) DEFAULT 0",
    "ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS saturday_bonus_per_hour NUMERIC(10,2) DEFAULT 0",

    # ── Dniówka: płatne za OBECNOŚĆ, nie za godziny ──
    # Myjący dostaje 150 zł za dzień, w którym był — godziny nie mają dla
    # niego znaczenia, więc w grafiku wybiera się tylko obecny/nieobecny.
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS pay_mode TEXT DEFAULT 'hourly'",
    "ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_pay_mode_ck",
    "ALTER TABLE workers ADD CONSTRAINT workers_pay_mode_ck "
    "CHECK (pay_mode = ANY (ARRAY['hourly','daily']))",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS rate_per_day NUMERIC(10,2) DEFAULT 0",
    "ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS days_total NUMERIC(10,2) DEFAULT 0",
    "ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS rate_per_day NUMERIC(10,2) DEFAULT 0",

    # ── Przyjęcie = dokument całej dostawy ──
    # Jedna dostawa (np. 10 t ćwiartki) dostaje JEDEN numer przyjęcia
    # („12/08/2026") i rozpada się na kilka numerów porządkowych (471, 472).
    # Dotąd numeru przyjęcia nie było wcale i nic nie łączyło tych partii —
    # karta HACCP 1.1.1 ma na niego osobną kolumnę (a).
    """CREATE TABLE IF NOT EXISTS receptions (
        id               TEXT PRIMARY KEY,
        reception_no     TEXT NOT NULL,
        reception_seq    INTEGER NOT NULL DEFAULT 0,
        reception_period TEXT NOT NULL DEFAULT '',
        received_date    DATE,
        supplier_id      TEXT,
        supplier_name    TEXT DEFAULT '',
        document_no      TEXT DEFAULT '',
        notes            TEXT DEFAULT '',
        created_at       TEXT
    )""",
    # Numer przyjęcia (12/08) NIE jest unikalny w skali lat — „1/08" wraca
    # w każdym sierpniu, bo zakład tak go zapisuje na kartach HACCP.
    # Unikalności pilnuje prawdziwy klucz: miesiąc dostawy + numer w miesiącu.
    "DROP INDEX IF EXISTS uq_receptions_no",
    # Przyjęcie NA USŁUGĘ ma własną serię („1/08U"), więc ta sama para
    # (miesiąc, numer) występuje legalnie dwa razy — raz w każdej serii.
    "ALTER TABLE receptions ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT false",
    "DROP INDEX IF EXISTS uq_receptions_period_seq",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_receptions_period_seq_series "
    "ON receptions(reception_period, reception_seq, is_service)",
    # HDI dostawcy ma WŁASNY numer („33656") i osobno wskazuje dokument
    # handlowy („do dokumentu: WZ 388/MDU/08/2026"). Karta 1.1.1 kol. (e)
    # dopuszcza jedno albo drugie, więc trzymamy oba.
    "ALTER TABLE receptions ADD COLUMN IF NOT EXISTS hdi_no TEXT DEFAULT ''",
    # Sumy ZE STOPKI HDI: „Masa netto: 9 000,00" i „Ilość pojemników: 600".
    # Służą wyłącznie kontroli przepisania dokumentu — stan magazynu liczy się
    # z pozycji, nie stąd.
    "ALTER TABLE receptions ADD COLUMN IF NOT EXISTS doc_kg NUMERIC(12,3)",
    "ALTER TABLE receptions ADD COLUMN IF NOT EXISTS doc_containers INTEGER",
    # Skan HDI dostawcy przypięty do przyjęcia — dokument do okazania przy
    # kontroli („na podstawie czego przyjęliście ten surowiec").
    "ALTER TABLE receptions ADD COLUMN IF NOT EXISTS hdi_scan TEXT DEFAULT ''",
    "CREATE INDEX IF NOT EXISTS idx_receptions_date ON receptions(received_date)",
    "CREATE INDEX IF NOT EXISTS idx_receptions_supplier ON receptions(supplier_id)",
    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS reception_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_raw_batches_reception ON raw_batches(reception_id)",

    # Partie DOSTAWCY w obrębie przyjęcia. Dotąd ginęły: formularz zbierał
    # pozycje HDI (numer + kg + data uboju), a backend sklejał same numery
    # w jeden string `raw_batches.supplier_batch_no` i gubił kilogramy —
    # nie dało się udowodnić, że A001-A005 (6000 kg) poszły w numer 400.
    # raw_batch_id = do którego numeru porządkowego trafiła dana partia.
    """CREATE TABLE IF NOT EXISTS reception_supplier_batches (
        id                TEXT PRIMARY KEY,
        reception_id      TEXT NOT NULL,
        raw_batch_id      TEXT,
        supplier_batch_no TEXT NOT NULL DEFAULT '',
        kg                NUMERIC(12,3),
        slaughter_date    DATE,
        expiry_date       DATE,
        seq               INTEGER NOT NULL DEFAULT 0
    )""",
    # Rozbicie wsadów surowca NA SESJĘ masowania (jedna sesja = jedna partia
    # przyprawionego). Operator wpisuje je przy potwierdzaniu masowania, ale
    # dotąd ginęło: ruch zużycia zapisuje source_id=zlecenie, więc gdy jedno
    # zlecenie rodziło kilka partii, nie dało się powiedzieć ile kg poszło do
    # której. Bez tego karta 2.5.1 nie odpowiada na pytanie weterynarii,
    # skąd wzięła się partia PP.
    """CREATE TABLE IF NOT EXISTS mixing_session_lots (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL REFERENCES mixing_sessions(id) ON DELETE CASCADE,
        meat_stock_id TEXT,
        raw_batch_no  TEXT,
        kg            NUMERIC(12,3) NOT NULL DEFAULT 0
    )""",
    "CREATE INDEX IF NOT EXISTS idx_msl_session ON mixing_session_lots(session_id)",
    # Numer karty realizacji produkcji (PK/N/MM/RR wg instrukcji 2.5). Numer
    # NADAJEMY RAZ i przechowujemy: to numer dokumentu HACCP, który spina
    # numery przyjęć surowca, dodatków i opakowań — nie może się przesunąć,
    # gdy w minionym dniu dojdzie kolejna receptura.
    """CREATE TABLE IF NOT EXISTS production_cards (
        id         TEXT PRIMARY KEY,
        plan_date  DATE NOT NULL,
        recipe_id  TEXT NOT NULL,
        card_no    TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (plan_date, recipe_id)
    )""",

    # Numery zwolnione anulowaniem — wracają do puli, żeby seria była CIĄGŁA
    # (decyzja właściciela 20.08.2026). Rejestr zamiast szukania dziur w całej
    # historii: wolno użyć ponownie tylko numeru, który MY zwolniliśmy, a nie
    # takiego, który zniknął przy dawnych ręcznych porządkach (416, 448-450).
    """CREATE TABLE IF NOT EXISTS numery_zwolnione (
        seria      TEXT NOT NULL,
        seq        INTEGER NOT NULL,
        zwolniony  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (seria, seq)
    )""",

    # Układ palety u dostawcy: ile pojemników wchodzi na jedną paletę.
    # KOKO układa 9 na warstwę × 4 warstwy = 36, inni po 8 = 32. Biuro drukuje
    # z tego zawieszki na palety, więc liczba musi siedzieć przy dostawcy.
    # NULL = nieustawiony, wtedy ekran bierze DEFAULT_CONTAINERS_PER_PALLET.
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS containers_per_pallet INTEGER",

    # Numery WZ wracają do puli po anulowaniu (21.08.2026), więc o pomyłkę
    # łatwiej niż dotąd — unikat jest ostatnią linią obrony przed dwoma
    # dokumentami o tym samym numerze. Anulowane siedzą poza serią (seq >= 9000)
    # i też są unikalne, więc indeks przechodzi na istniejących danych.
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_wz_ym_seq ON wz_documents(year_month, seq)",

    "CREATE INDEX IF NOT EXISTS idx_rsb_reception ON reception_supplier_batches(reception_id)",
    "CREATE INDEX IF NOT EXISTS idx_rsb_raw_batch ON reception_supplier_batches(raw_batch_id)",

    # ── Prognoza zakończenia produkcji ────────────────────────────────
    #
    # Log zapisów sztuk. Bez niego po dniu produkcyjnym nie zostaje ŻADEN
    # ślad czasowy: `progress_updated_at` trzyma tylko ostatni zapis, a
    # `worker_entries[].addedAt` tylko pierwszy wpis osoby na pozycji.
    """CREATE TABLE IF NOT EXISTS production_work_events (
        id           TEXT PRIMARY KEY,
        plan_id      TEXT NOT NULL,
        plan_line_id TEXT NOT NULL,
        recipe_id    TEXT,
        recipe_name  TEXT,
        kg_per_unit  NUMERIC NOT NULL DEFAULT 0,
        pieces_delta INTEGER NOT NULL,
        worker_id    TEXT,
        worker_name  TEXT,
        crew_size    INTEGER NOT NULL DEFAULT 0,
        at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_work_events_plan ON production_work_events (plan_id, at)",

    # Przerwy. Do tej pory żyły w `useState` ekranu i ginęły przy odświeżeniu
    # — razem z blokadą zapisu sztuk, która na nich stoi.
    """CREATE TABLE IF NOT EXISTS production_breaks (
        id         TEXT PRIMARY KEY,
        plan_id    TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ended_at   TIMESTAMPTZ
    )""",
    "CREATE INDEX IF NOT EXISTS idx_breaks_plan ON production_breaks (plan_id, started_at)",

    # Próbki tempa — JEDNA na (dzień, receptura). Trzymamy próbki, a nie
    # gotową średnią: `tablet_reopen` pozwala cofnąć zamknięcie dnia, a
    # średniej doliczanej przyrostowo nie da się cofnąć.
    """CREATE TABLE IF NOT EXISTS production_rate_samples (
        plan_id      TEXT NOT NULL,
        recipe_id    TEXT NOT NULL DEFAULT '',
        plan_date    DATE,
        kg           NUMERIC NOT NULL DEFAULT 0,
        person_hours NUMERIC NOT NULL DEFAULT 0,
        computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (plan_id, recipe_id)
    )""",

    # Zakres dostaw dostawcy — kolumna karty 1.3.2 oPRP („Lista dostawców
    # opakowań, przypraw, dodatków technologicznych…"). Wpisywana ręcznie
    # w kartotece, bo to deklaracja zakresu współpracy, a nie historia dostaw.
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supply_scope TEXT",

    # Nazwa rodzaju NA DOKUMENTACH (HDI). Rodzaj w MES nazywa się tak, jak go
    # planuje produkcja („KEBAB MIX 95/5"), a klient ma na dokumencie widzieć
    # nazwę handlową („KEBAB MIX") — proporcji składu nie pokazujemy odbiorcy.
    # NULL/puste = na dokumencie idzie zwykła nazwa rodzaju.
    "ALTER TABLE product_types ADD COLUMN IF NOT EXISTS document_name TEXT",

    # Ziarno prognozy: 120 kg/h na osobę układającą (wartość od właściciela,
    # 27.08.2026) i planowana przerwa. W app_settings, żeby biuro mogło je
    # poprawić bez wdrożenia.
    """INSERT INTO app_settings (key, value)
       VALUES ('production.seed_kg_per_person_hour', '120'::jsonb)
       ON CONFLICT (key) DO NOTHING""",
    """INSERT INTO app_settings (key, value)
       VALUES ('production.planned_break_minutes', '30'::jsonb)
       ON CONFLICT (key) DO NOTHING""",

    # ── Stan surowca: chłodzony / mrożony (mięso czerwone, 30.08.2026) ──
    # Cecha DOSTAWY, nie rodzaju surowca: ta sama wołowina 80/20 i ten sam łój
    # otokowy przyjeżdżają raz świeże, raz w blokach. Podwojenie słownika
    # zmusiłoby recepturę (product_types.components) do wyboru między
    # mrożonym a świeżym, a instrukcja 2.5 pkt 5.1.1 i tak każe blok
    # rozdrobnić na wilku i wymieszać z mięsem chłodzonym.
    # Stan decyduje o progu temperatury na karcie 1.1.1 i o magazynie:
    # chłodzony → pom. 3 (+3 °C), mrożony → pom. 6 (−18 °C).
    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS storage_state TEXT NOT NULL DEFAULT 'chlodzony'",
    "ALTER TABLE meat_stock ADD COLUMN IF NOT EXISTS storage_state TEXT NOT NULL DEFAULT 'chlodzony'",

    # ── Przyjęcie DDFiP: przyprawy, dodatki, opakowania (instrukcja 1.3) ──
    #
    # DOKUMENT dostawy artykułów pomocniczych — odpowiednik `receptions` dla
    # surowca. Osobna seria numerów „DF/1/08" (litera odróżnia go od numeru
    # przyjęcia mięsa „1/08") i osobna karta 1.3.1.
    #
    # Kolumny odwzorowują karta 1.3.1 (a-k):
    #   a reception_no · b supplier_name · c assortment · d received_date
    #   e document_no · f visual_check · g compliance_check · h notes
    #   i decision · j done_by · k checked_by
    #
    # `assortment` jest DENORMALIZOWANY z pozycji, bo dostawa ODRZUCONA
    # (decision='N') nie tworzy żadnych lotów magazynu, a instrukcja 1.3 każe
    # ją mimo to zarejestrować („posłużyć ono może w przyszłości do oceny
    # dostawców"). Bez tej kolumny odrzucona dostawa nie miałaby czym wypełnić
    # kolumny „Asortyment".
    """CREATE TABLE IF NOT EXISTS ingredient_receptions (
        id               TEXT PRIMARY KEY,
        reception_no     TEXT NOT NULL,
        reception_seq    INTEGER NOT NULL DEFAULT 0,
        reception_period TEXT NOT NULL DEFAULT '',
        received_date    DATE,
        supplier_id      TEXT,
        supplier_name    TEXT DEFAULT '',
        assortment       TEXT DEFAULT '',
        document_no      TEXT DEFAULT '',
        visual_check     TEXT DEFAULT 'bz',
        compliance_check TEXT DEFAULT 'bz',
        notes            TEXT DEFAULT '',
        decision         TEXT NOT NULL DEFAULT 'K',
        done_by          TEXT DEFAULT '',
        checked_by       TEXT DEFAULT '',
        created_at       TEXT
    )""",
    # Numer jest unikalny w obrębie MIESIĄCA, nie w skali lat — „DF/1/08"
    # wraca w każdym sierpniu, dokładnie jak numer przyjęcia mięsa.
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_ingredient_receptions_period_seq "
    "ON ingredient_receptions (reception_period, reception_seq)",
    # Kategoria składnika (spice_mix | functional | other). Kolumnę tworzył
    # WYŁĄCZNIE `init_db.py migrate`, a `create_ingredient` wstawia ją zawsze —
    # więc baza postawiona samymi migracjami (tak stawia ją CI i tak stawiał
    # test DB) wywracała się na pierwszym dodanym składniku. Produkcja ma tę
    # kolumnę od dawna, tu tylko domykamy ścieżkę świeżej instalacji.
    "ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'other'",
    # Pozycja dostawy = lot magazynu przypraw. Dokument wiąże je w jedno auto.
    "ALTER TABLE ingredient_stock ADD COLUMN IF NOT EXISTS reception_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_ingredient_stock_reception "
    "ON ingredient_stock (reception_id)",
]


def run_migrations() -> None:
    """Execute all idempotent DDL statements, then seed data.

    Całość pod globalnym advisory lockiem: każdy worker gunicorna odpala
    migracje przy starcie RÓWNOLEGLE — pary zależne od kolejności (DROP+ADD
    constraintu) ścigały się między workerami i sypały fałszywym
    ``statement_failed`` przy każdym boocie, a backfille INSERT-ujące dane
    (np. _reconcile_deboning_ledger) mogłyby wstawić korektę dwa razy.
    Lock trzyma osobne połączenie z puli (min 2) — statementy w środku
    biorą własne, więc nic się nie klinuje; kolejny worker wchodzi po
    zwolnieniu i zastaje wszystko zrobione (idempotencja)."""
    logger.info("migrations.start", extra={"count": len(_DDL)})
    with transaction() as guard:
        cx_execute(guard, "SELECT pg_advisory_xact_lock(202607220000)")
        _run_migrations_locked()


def _run_migrations_locked() -> None:
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
    _backfill_byproduct_containers()
    _backfill_plan_line_position()
    _backfill_mixing_session_lots()
    _backfill_receptions()
    _strip_year_from_reception_no()
    _reconcile_deboning_ledger()
    logger.info("migrations.done")


def _strip_year_from_reception_no() -> None:
    """Ucina rok z numerów przyjęcia sprzed 2026-08-12: ``12/08/2026`` → ``12/08``.

    Zakład zapisuje numer przyjęcia jako numer-w-miesiącu i miesiąc — widać to
    na karcie 1.1.1 („1/08" w kolumnie „Numer przyjęcia") i na 2.5.1
    („01/06 BERG"). MES dopisywał rok i rozjeżdżał się z papierem, więc
    dokument w systemie miał inny numer niż ten sam dokument w segregatorze.

    Sam numer porządkowy się NIE zmienia — 12/08/2026 i 12/08 to ta sama
    dwunasta dostawa sierpnia. Rok nie ginie: trzyma go `reception_period`.
    """
    try:
        ile = int(query_one(
            "SELECT count(*) AS n FROM receptions WHERE reception_no ~ '/[0-9]{4}$'")["n"])
        if ile:
            execute(
                "UPDATE receptions SET reception_no = regexp_replace(reception_no, '/[0-9]{4}$', '') "
                "WHERE reception_no ~ '/[0-9]{4}$'")
            logger.info("migrations.strip_year_from_reception_no.done", extra={"count": ile})
    except Exception as exc:
        logger.warning("migrations.strip_year_from_reception_no.failed", extra={"error": str(exc)})


def _backfill_receptions() -> None:
    """Odtwarza dokument przyjęcia dla partii sprzed tej tabeli.

    Jedna dostawa = (data przyjęcia, dostawca). Tak właśnie wyglądają dane:
    11.08.2026 KOKO przywiozło 9000 kg, które biuro rozbiło na 470 i 471 —
    obie partie dostają teraz wspólny numer „x/08/2026".

    Numery przydzielamy chronologicznie i przez tę samą sekwencję
    (`reception_no:RRRR-MM`), co ścieżka produkcyjna, żeby kolejne przyjęcia
    ciągnęły dalej, a nie zaczynały od 1 i zderzały się z historią.

    Partie dostawcy odtwarzamy z `supplier_batch_no` — sklejonego stringa
    („112819, 112820"). Kilogramów per partia dostawcy tam NIE MA i nie
    wolno ich zmyślać: wiersze powstają z `kg = NULL`.

    Idempotentne: rusza wyłącznie partie z `reception_id IS NULL`.
    """
    from app.utils.batch_numbers import delivery_period, format_delivery_no
    from app.utils.ids import cuid, now_iso

    try:
        rows = query_all(
            """
            SELECT id, internal_batch_seq, supplier_id, supplier_name,
                   supplier_batch_no, invoice_no, slaughter_date, expiry_date,
                   COALESCE(received_date, created_at::date) AS rdate
            FROM raw_batches
            WHERE reception_id IS NULL
              AND COALESCE(received_date, created_at::date) IS NOT NULL
            ORDER BY COALESCE(received_date, created_at::date), internal_batch_seq
            """
        )
        if not rows:
            return

        groups: Dict[tuple, List[Dict]] = {}
        for r in rows:
            groups.setdefault((r["rdate"], r["supplier_id"] or ""), []).append(r)

        created = 0
        for (rdate, _supplier_id), batches in sorted(groups.items(), key=lambda kv: kv[0][0]):
            period = delivery_period(rdate)
            seq_row = query_one(
                """
                INSERT INTO sequences (key, value) VALUES (%s, 1)
                ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1
                RETURNING value
                """,
                (f"reception_no:{period}",),
            )
            seq = int(seq_row["value"])
            head = batches[0]
            rec_id = cuid()
            execute(
                """
                INSERT INTO receptions
                    (id, reception_no, reception_seq, reception_period, received_date,
                     supplier_id, supplier_name, document_no, notes, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'',%s)
                """,
                (rec_id, format_delivery_no(seq, rdate), seq, period, rdate,
                 head.get("supplier_id"), head.get("supplier_name") or "",
                 head.get("invoice_no") or "", now_iso()),
            )
            for b in batches:
                execute("UPDATE raw_batches SET reception_id=%s WHERE id=%s", (rec_id, b["id"]))
                # „112819, 112820" albo „112677 112682" — biuro rozdzielało
                # numery raz przecinkiem, raz spacją.
                parts = [p for p in re.split(r"[,;\s]+", b.get("supplier_batch_no") or "") if p]
                for i, no in enumerate(parts):
                    execute(
                        """
                        INSERT INTO reception_supplier_batches
                            (id, reception_id, raw_batch_id, supplier_batch_no,
                             kg, slaughter_date, expiry_date, seq)
                        VALUES (%s,%s,%s,%s,NULL,%s,%s,%s)
                        """,
                        (cuid(), rec_id, b["id"], no,
                         b.get("slaughter_date"), b.get("expiry_date"), i),
                    )
            created += 1
        logger.info("migrations.backfill_receptions.done", extra={"count": created})
    except Exception as exc:
        logger.warning("migrations.backfill_receptions.error", extra={"error": str(exc)})


def _reconcile_deboning_ledger() -> None:
    """Naprawa danych po audycie 2026-07-22 (wszystko idempotentne — po
    pierwszym przebiegu różnice są zerowe):

    1. Wpisy złożone z >1 ważenia: pola wagi encji (brutto/tary) opisywały
       tylko OSTATNIĄ porcję przy kg_meat=SUMA → NULL (prawda porcji w
       deboning_take_weighings).
    2. Księga ruchów vs wpisy: korekty (biuro/PATCH) zmieniały stany bez
       ruchu — dopisz ruch 'deboning_correction' domykający różnicę
       (surowiec i mięso; tylko wpisy, które mają już ruchy — historyczne
       sprzed rejestru zostawiamy w spokoju).
    3. Anulowane przyjęcia: księga partii ANUL-* zostawała z samym IN —
       dopisz OUT 'cancellation' domykający do zera.
    4. Loty „other" per wpis vs zważone frakcje zbiorcze: skurcz do realnej
       reszty (dublowanie masy ABP ~2×).

    Każdy blok pod pg_advisory_xact_lock (dodatkowo do globalnego locka
    run_migrations): funkcja wstawia WIERSZE, więc dwa równoległe przebiegi
    policzyłyby ten sam dryf i wstawiły korektę dwa razy — lock trzyma też
    przy wywołaniu ręcznym, poza migracjami.
    """
    from app.utils.ids import cuid

    try:
        with transaction() as conn:
            cx_execute(conn, "SELECT pg_advisory_xact_lock(202607220001)")
            cx_execute(
                conn,
                """
                UPDATE deboning_entries de
                SET kg_gross=NULL, tare_cart_kg=NULL, tare_e2_kg=NULL, e2_count=NULL
                WHERE COALESCE(de.status,'complete')='complete'
                  AND de.kg_gross IS NOT NULL
                  AND (SELECT COUNT(*) FROM deboning_take_weighings tw
                       WHERE tw.entry_id=de.id) > 1
                """,
            )
            raw_drift = cx_query_all(
                conn,
                """
                SELECT de.id, de.raw_batch_id,
                       (-de.kg_quarter) - mv.s AS diff
                FROM deboning_entries de
                JOIN LATERAL (
                    SELECT COALESCE(SUM(qty),0) AS s FROM stock_movements sm
                    WHERE sm.product_type='raw' AND sm.source_id=de.id
                      AND sm.source_type IN ('deboning','deboning_correction')
                ) mv ON true
                WHERE COALESCE(de.status,'complete')='complete'
                  AND EXISTS (SELECT 1 FROM stock_movements s2
                              WHERE s2.product_type='raw' AND s2.source_id=de.id
                                AND s2.source_type='deboning')
                  AND abs((-de.kg_quarter) - mv.s) > 0.005
                """,
            )
            for r in raw_drift:
                cx_execute(
                    conn,
                    "INSERT INTO stock_movements (id, product_type, batch_id, qty,"
                    " movement_type, source_type, source_id, created_at)"
                    " VALUES (%s,'raw',%s,%s,%s,'deboning_correction',%s,now())",
                    (cuid(), r["raw_batch_id"], round(float(r["diff"]), 3),
                     "OUT" if float(r["diff"]) < 0 else "IN", r["id"]),
                )
            meat_drift = cx_query_all(
                conn,
                """
                SELECT de.id, mv.batch_id, de.kg_meat - mv.s AS diff
                FROM deboning_entries de
                JOIN LATERAL (
                    SELECT COALESCE(SUM(qty),0) AS s,
                           MAX(batch_id) AS batch_id
                    FROM stock_movements sm
                    WHERE sm.product_type='meat' AND sm.source_id=de.id
                      AND sm.source_type IN ('deboning','deboning_correction')
                ) mv ON true
                WHERE COALESCE(de.status,'complete')='complete'
                  AND mv.batch_id IS NOT NULL
                  AND abs(de.kg_meat - mv.s) > 0.005
                """,
            )
            for r in meat_drift:
                cx_execute(
                    conn,
                    "INSERT INTO stock_movements (id, product_type, batch_id, qty,"
                    " movement_type, source_type, source_id, created_at)"
                    " VALUES (%s,'meat',%s,%s,%s,'deboning_correction',%s,now())",
                    (cuid(), r["batch_id"], round(float(r["diff"]), 3),
                     "IN" if float(r["diff"]) > 0 else "OUT", r["id"]),
                )
            if raw_drift or meat_drift:
                logger.info("migrations.reconcile.movements",
                            extra={"raw": len(raw_drift), "meat": len(meat_drift)})
    except Exception as exc:
        logger.warning("migrations.reconcile.movements.failed",
                       extra={"error": str(exc)})

    try:
        with transaction() as conn:
            cx_execute(conn, "SELECT pg_advisory_xact_lock(202607220001)")
            ghosts = cx_query_all(
                conn,
                """
                SELECT rb.id, led.s
                FROM raw_batches rb
                JOIN LATERAL (
                    SELECT COALESCE(SUM(qty),0) AS s FROM stock_movements sm
                    WHERE sm.product_type='raw' AND sm.batch_id=rb.id
                ) led ON true
                WHERE rb.status='cancelled' AND abs(led.s) > 0.005
                """,
            )
            for g in ghosts:
                cx_execute(
                    conn,
                    "INSERT INTO stock_movements (id, product_type, batch_id, qty,"
                    " movement_type, source_type, source_id, created_at)"
                    " VALUES (%s,'raw',%s,%s,%s,'cancellation',%s,now())",
                    (cuid(), g["id"], round(-float(g["s"]), 3),
                     "OUT" if float(g["s"]) > 0 else "IN", g["id"]),
                )
            if ghosts:
                logger.info("migrations.reconcile.cancelled",
                            extra={"count": len(ghosts)})
    except Exception as exc:
        logger.warning("migrations.reconcile.cancelled.failed",
                       extra={"error": str(exc)})

    try:
        from app.services.batch_byproducts_service import _rescale_other_lots

        rows = query_all(
            "SELECT raw_batch_id FROM batch_byproducts "
            "WHERE backs_kg IS NOT NULL OR bones_kg IS NOT NULL"
        )
        with transaction() as conn:
            cx_execute(conn, "SELECT pg_advisory_xact_lock(202607220001)")
            for r in rows:
                _rescale_other_lots(conn, r["raw_batch_id"])
    except Exception as exc:
        logger.warning("migrations.reconcile.other_lots.failed",
                       extra={"error": str(exc)})


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
        # Produkt rozbioru, robiony rzadko (~30 kg/tydzień). Osobny rodzaj, bo
        # nie może mieszać się z z/s ani w magazynie, ani w planie masowania
        # (Auto-FEFO bierze wyłącznie z/s). Z zewnątrz nieprzyjmowany.
        ("mat-mieso-bs",      "Mięso b/s",           False, "drob", False),

        # ── Mięso czerwone (kategoria 'czerwone', 30.08.2026) ──
        # Instrukcja 1.1 oPRP wymienia je w zakresie razem z drobiem („Mięsa
        # drobne wołowe, cielęce", „Elementy wołowe, cielęce", „Tłuszcz
        # wołowy"), więc idzie tą samą kartą 1.1.1 i tą samą numeracją —
        # to NIE jest osobne przyjęcie. Różni się tylko progiem temperatury
        # (≤ +7 °C zamiast ≤ +4 °C) i magazynem, gdy przyjeżdża mrożone.
        #
        # Żaden z tych rodzajów nie idzie na rozbiór: bloki 80/20 wchodzą
        # wprost do masowania (instrukcja 2.5 pkt 5.1.1 — rozdrobnienie na
        # wilku zamiast rozmrażania), a zrazowa i mostek do kebaba yaprak
        # krojone są dopiero na produkcji.
        #
        # Świeże/mrożone NIE jest tu rodzajem — to stan DOSTAWY
        # (raw_batches.storage_state), inaczej słownik by się podwoił,
        # a receptura musiałaby wybierać między blokiem a świeżym.
        ("mat-wolowina-8020",    "Wołowina 80/20",           False, "czerwone", True),
        ("mat-wolowina-zrazowa", "Dolna zrazowa wołowa",     False, "czerwone", True),
        ("mat-wolowina-mostek",  "Filet z mostka wołowego",  False, "czerwone", True),
        # Łój wchodzi do masowania JAK MIĘSO — udział ustala skład rodzaju
        # (product_types.components), nie receptura przypraw. Dwa gatunki,
        # bo otokowy i zwykły nie są zamienne.
        ("mat-loj-otokowy",      "Łój wołowy otokowy",       False, "czerwone", True),
        ("mat-loj-zwykly",       "Łój wołowy zwykły",        False, "czerwone", True),
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


def _backfill_byproduct_containers() -> None:
    """Nadaje containers_available lotom ubocznych sprzed tej kolumny —
    z sumy palet ważenia zbiorczego (jedyne dostępne źródło; przed tą
    migracją 'containers' na WZ było tylko kosmetyczne, więc pełna suma
    z palet to najlepsze możliwe przybliżenie stanu bieżącego)."""
    try:
        rows = query_all(
            """
            SELECT l.id, l.kind, bb.backs_pallets, bb.bones_pallets
            FROM byproduct_lots l
            JOIN batch_byproducts bb ON bb.raw_batch_id = l.raw_batch_id
            WHERE l.status='open' AND l.kind IN ('backs','bones')
              AND l.deboning_entry_id IS NULL
              AND l.containers_available IS NULL
            """
        )
        for r in rows:
            pallets = r.get("backs_pallets") if r["kind"] == "backs" else r.get("bones_pallets")
            execute(
                "UPDATE byproduct_lots SET containers_available=%s WHERE id=%s",
                (pallet_containers(pallets), r["id"]),
            )
        if rows:
            logger.info("migrations.backfill_byproduct_containers.done", extra={"count": len(rows)})
    except Exception as exc:
        logger.warning(
            "migrations.backfill_byproduct_containers.error", extra={"error": str(exc)}
        )


def _backfill_plan_line_position() -> None:
    """Nadaje position pozycjom planów sprzed tej kolumny.

    Kolejności wpisywania już nie odtworzymy — bierzemy stabilny zastępnik
    (id), żeby stare plany przynajmniej przestały skakać przy każdym
    odczycie. Nowe plany dostają position z kolejności formularza."""
    try:
        execute(
            """
            WITH ordered AS (
              SELECT id, ROW_NUMBER() OVER (PARTITION BY plan_id ORDER BY id) AS nr
              FROM production_plan_lines
              WHERE COALESCE(position, 0) = 0
            )
            UPDATE production_plan_lines l
            SET position = ordered.nr
            FROM ordered
            WHERE ordered.id = l.id
            """
        )
    except Exception as exc:
        logger.warning(
            "migrations.backfill_plan_line_position.error", extra={"error": str(exc)}
        )


def _backfill_mixing_session_lots() -> None:
    """Odtwarza rozbicie wsadów dla sesji masowania sprzed zapisu tabeli.

    Źródłem są RUCHY MAGAZYNOWE OUT mięsa — realne kilogramy zdjęte ze stanu
    w tej samej transakcji co sesja, nie ilości planowane. Ruchy układają się
    w czasie: ruchy powstają PO wpisie sesji (sesja jest zapisywana najpierw,
    potem zdejmowane jest mięso), więc ruch należy do OSTATNIEJ sesji
    zamkniętej nie później niż znacznik ruchu.

    STRAŻNIK: suma odtworzonych kg musi zgadzać się z `kg_meat` sesji (±0,05).
    Gdy się nie zgadza, sesji NIE dotykamy — karta pokaże wtedy uczciwą
    adnotację zamiast zmyślonego rozbicia.
    """
    from app.utils.ids import cuid
    try:
        orders = query_all(
            """
            SELECT DISTINCT s.order_id
            FROM mixing_sessions s
            WHERE NOT EXISTS (
                SELECT 1 FROM mixing_session_lots l WHERE l.session_id = s.id
            )
            """
        )
        odtworzone = pominiete = 0
        for o in orders:
            order_id = o["order_id"]
            sesje = query_all(
                "SELECT id, batch_no, kg_meat, completed_at FROM mixing_sessions "
                "WHERE order_id=%s ORDER BY completed_at, id",
                (order_id,),
            )
            ruchy = query_all(
                """
                SELECT sm.qty, sm.created_at, rb.internal_batch_no AS raw_no,
                       ms.id AS meat_stock_id
                FROM stock_movements sm
                JOIN meat_stock ms ON ms.id = sm.batch_id
                LEFT JOIN raw_batches rb ON rb.id = ms.raw_batch_id
                WHERE sm.source_type='mixing' AND sm.source_id=%s
                  AND sm.movement_type='OUT'
                ORDER BY sm.created_at, sm.id
                """,
                (order_id,),
            )
            if not sesje or not ruchy:
                continue
            # Przypisanie po czasie: ruch → pierwsza sesja zamknięta nie wcześniej
            przydzial = {s["id"]: [] for s in sesje}
            i = 0
            for r in ruchy:
                while (i + 1 < len(sesje)
                       and sesje[i + 1]["completed_at"] <= r["created_at"]):
                    i += 1
                przydzial[sesje[i]["id"]].append(r)
            for s in sesje:
                lots = przydzial.get(s["id"]) or []
                suma = sum(abs(float(l["qty"] or 0)) for l in lots)
                if not lots or abs(suma - float(s["kg_meat"] or 0)) > 0.05:
                    pominiete += 1
                    continue
                for l in lots:
                    execute(
                        "INSERT INTO mixing_session_lots "
                        "(id, session_id, meat_stock_id, raw_batch_no, kg) "
                        "VALUES (%s,%s,%s,%s,%s)",
                        (cuid(), s["id"], l["meat_stock_id"],
                         l.get("raw_no") or "", abs(float(l["qty"] or 0))),
                    )
                odtworzone += 1
        if odtworzone or pominiete:
            logger.info(
                "migrations.backfill_mixing_session_lots.done",
                extra={"sesji_odtworzonych": odtworzone, "sesji_pominietych": pominiete},
            )
    except Exception as exc:
        logger.warning(
            "migrations.backfill_mixing_session_lots.error", extra={"error": str(exc)}
        )
