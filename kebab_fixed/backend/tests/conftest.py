"""Fixture testowej bazy dla testów INTEGRACYJNYCH (dotykających SQL).

Bezpieczeństwo: testy DB uruchamiają się TYLKO gdy ustawiony `TEST_DATABASE_URL`
wskazujący na OSOBNĄ bazę testową (nazwa musi zawierać `kebab_mes_test`).
Bez tej zmiennej testy z fixture `db` są pomijane (`skip`), więc domyślne
`pytest` (czyste funkcje) działa bez bazy. NIGDY nie dotyka prod (5433).

Budowa schematu bazy testowej (jednorazowo, poza pytest):
    docker exec kebab-op psql -U postgres -c "CREATE DATABASE kebab_mes_test"
    export TEST_DATABASE_URL="postgresql://postgres:PASS@localhost:55437/kebab_mes_test"
    python3 -c "import psycopg2, init_db; c=psycopg2.connect('$TEST_DATABASE_URL'); \
        c.autocommit=True; c.cursor().execute(init_db.SCHEMA)"
    DATABASE_URL="$TEST_DATABASE_URL" python3 -c "from app.migrations import run_migrations; run_migrations()"
Uruchomienie: `TEST_DATABASE_URL=... python3 -m pytest tests/test_*_db.py`
"""
import os
import pytest

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
# Przekieruj pulę aplikacji na bazę testową ZANIM zaimportujemy app.* w testach.
if TEST_DATABASE_URL:
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL

# Tabele czyszczone przed każdym testem integracyjnym (CASCADE łapie zależne).
_TRUNCATE = [
    # Nośniki zwrotne — od ruchów w stronę partnerów (FK), żeby CASCADE
    # nie zostawił sierot po dokumentach.
    "container_movements", "container_docs", "container_partner_links", "container_partners",
    "kpi_monthly_snapshots",
    "deboning_entry_corrections",
    "stock_movements", "stock_cartons", "stock_carton_lines", "finished_units", "finished_goods",
    "production_plan_lines", "production_plans",
    "seasoned_meat", "mixing_sessions", "mixing_order_lots", "mixing_orders",
    "byproduct_weighing_corrections",
    "meat_pallet_corrections", "meat_pallet_lots", "meat_pallets",
    # Dokumenty WZ czyszczone od 21.08.2026: numeracja WZ liczy się z tabeli
    # (MAX(seq) w miesiącu), więc dokumenty z poprzedniego przebiegu podbijały
    # numer i testy serii dostawały 1871 zamiast 1.
    "wz_documents",
    # `hdi_documents` dopisane 2026-08-27: numeracja HDI liczy się z tabeli
    # (MAX(seq) w miesiącu), więc dokumenty z poprzedniego przebiegu podbijały
    # numer, a test wstawiający dokument po stałym id padał na duplicate key.
    "hdi_documents",
    # `ingredient_receptions` dopisane 2026-08-30: numeracja DDFiP liczy się
    # z sekwencji, ale UNIKALNOŚĆ pilnuje indeks (period, seq) na tej tabeli —
    # dokument z poprzedniego przebiegu wywracał kolejny test na duplicate key.
    # `ingredient_stock` jawnie, a nie tylko przez CASCADE od `ingredients`:
    # loty muszą zniknąć razem z dokumentem, który je stworzył.
    # `ingredient_reception_packaging` i `packaging` z tego samego powodu:
    # opakowaniowa pozycja dokumentu DOKŁADA do magazynu scalanego po nazwie,
    # więc pozostałość z poprzedniego testu podbijała stan następnemu.
    "ingredient_stock", "ingredient_reception_packaging", "ingredient_receptions",
    # Kontrola HACCP dostawy — czyszczona razem z przyjęciami.
    "reception_checks",
    "meat_stock", "reception_supplier_batches", "receptions", "raw_batches",
    # `product_catalog` przed `recipes`/`product_types`: rejestr trzyma
    # nazwy rodzajów i receptur, więc pozostałość podbijała licznik
    # kolizji kodów następnemu testowi.
    "product_catalog",
    "recipe_ingredients", "recipes",
    "order_pallet_items", "order_pallets", "client_order_lines", "client_orders",
    # `clients` dopisane 2026-07-29: kartoteka odbiorców przeciekała między
    # testami (suppliers czyszczono, clients nie), więc test seedujący tego
    # samego klienta co poprzedni padał na duplicate key.
    # `packaging` dopisane 2026-08-25: kartoteka tulei/folii przeciekała między
    # testami. Test seedujący tuleję po stałym id (t-metal) padał na duplicate
    # key przy drugim teście w pliku, a stan z poprzedniego testu (kg_available)
    # fałszowałby asercje magazynowe.
    "packaging",
    # `client_recipe_names` czyszczone RAZEM z klientami: własne nazwy receptur
    # odbiorcy przeciekały między testami (klienci po stałym id), więc dokument
    # kolejnego testu dostawał nazwę z poprzedniego.
    "client_recipe_names",
    "product_types", "machine_locks", "sequences", "suppliers", "clients",
    # Grupy odbiorców — czyszczone RAZEM z klientami, inaczej `clients.group_id`
    # wskazywałby na grupę z poprzedniego przebiegu.
    "client_groups", "ingredients",
    # Pula numerów zwolnionych anulowaniem — czyszczona razem z `sequences`.
    # Bez tego numer zwolniony w jednym teście wyskakiwał w następnym
    # (kolejna partia dostawała 1 zamiast 2) i testy zależały od kolejności.
    "numery_zwolnione",
    # Płace: dotąd nieczyszczone, bo żaden test ich nie dotykał. Rozliczenia
    # i potrącenia przeciekałyby między testami (settled_days blokuje dzień
    # na zawsze, więc drugi przebieg tego samego testu padałby na 400).
    # `workers` dopisane 2026-08-25: kartoteka przeciekała między testami.
    # Testy radziły sobie z tym `ON CONFLICT (id) DO UPDATE` po stałych id,
    # ale test szukający pracownika po NAZWISKU dostawał kilku „VLAD-ów"
    # z poprzednich przebiegów i czytał znacznik nie tego, którego założył.
    # Podpisy i wzory — czyszczone PRZED kartoteką pracowników (FK).
    "document_signatures", "signature_samples",
    "workers",
    "worker_hours", "worker_deductions", "payroll_kg_adjustments",
    "settlement_deductions", "settled_days", "payroll_settlements",
    "production_day_materials",
    "production_wrapping",
    # Prognoza zakończenia — log zapisów, przerwy i próbki tempa przeciekałyby
    # między testami (próbka po (plan_id, recipe_id) trafiałaby na duplikat).
    "production_work_events", "production_breaks", "production_rate_samples",
    "production_worker_moves",
]


@pytest.fixture
def db():
    """Czysta baza testowa per test. Pomija się bez TEST_DATABASE_URL."""
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL nie ustawiony — testy integracyjne DB pominięte")
    # BEZPIECZNIK: nigdy nie odpalaj TRUNCATE na bazie, która nie jest testową.
    assert "kebab_mes_test" in TEST_DATABASE_URL, (
        "TEST_DATABASE_URL nie wskazuje bazy 'kebab_mes_test' — przerwano dla bezpieczeństwa prod"
    )
    from app.db import execute
    execute("TRUNCATE " + ", ".join(_TRUNCATE) + " RESTART IDENTITY CASCADE")
    yield
