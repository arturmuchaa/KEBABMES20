"""WZ towaru zdejmuje nośniki z salda odbiorcy (znak ujemny)."""
from app.db import execute, query_all, transaction
from app.services.container_ledger_service import partner_balance_cx
from app.services.container_partners_service import resolve_partner, resolve_partner_by_nip
from app.services.wz_service import cancel_wz, create_manual_wz, stock_raw, update_wz_lines
from app.utils.ids import now_iso


def _bal(d, *keys):
    """Saldo zawężone do sprawdzanych nośników — od 2026-07-30 rodzajów jest
    siedem (siatka E1, europaleta…), więc porównywanie całego słownika
    psułoby testy przy każdym dodaniu rodzaju."""
    return {k: d[k] for k in (keys or ("e2", "pallet_h1", "pallet_other"))}


BUYER = {"name": "ODBIORCA SP. Z O.O.", "address": "Kraków", "nip": "1111111111"}


def _seed_raw_batch(bid="rb1", no="900", kg=6000.0, container_kg=15, containers=None):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, container_kg, "
        " containers_count, created_at) "
        "VALUES (%s,%s,'KOKO',%s,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',%s,%s,%s)",
        (bid, no, kg, kg, container_kg, containers, now_iso()))


def _partner():
    with transaction() as conn:
        return resolve_partner_by_nip(conn, BUYER["nip"], BUYER["name"])


def _wz(containers=20, qty=300.0, h1=0, other=0):
    return create_manual_wz(
        buyer=BUYER,
        selections=[{"stock_type": "raw", "stock_id": "rb1", "name": "Ćwiartka",
                     "unit": "kg", "qty": qty, "price": 5.0, "batch_no": "900",
                     "containers": containers}],
        valued=True, pallets_h1=h1, pallets_other=other)


def test_wz_zdejmuje_nosniki_ze_znakiem_ujemnym(db):
    _seed_raw_batch()
    _wz(containers=20, h1=2)
    with transaction() as conn:
        assert _bal(partner_balance_cx(conn, _partner())) == {
            "e2": -20, "pallet_h1": -2, "pallet_other": 0}


def test_edycja_pojemnikow_ksieguje_roznice(db):
    _seed_raw_batch()
    doc = _wz(containers=20)
    update_wz_lines(doc["id"], [{"index": 0, "containers": 18}])
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner())["e2"] == -18
    qtys = [int(r["qty"]) for r in query_all(
        "SELECT qty FROM container_movements WHERE asset_type='e2' ORDER BY created_at, qty")]
    assert qtys == [-20, 2], "korekta dopisuje różnicę, nie nadpisuje"


def test_anulowanie_wz_zwraca_nosniki_na_saldo(db):
    _seed_raw_batch()
    doc = _wz(containers=20, h1=2)
    cancel_wz(doc["id"])
    with transaction() as conn:
        assert _bal(partner_balance_cx(conn, _partner())) == {
            "e2": 0, "pallet_h1": 0, "pallet_other": 0}


def test_wz_bez_nosnikow_nie_tworzy_ruchow(db):
    _seed_raw_batch()
    _wz(containers=0)
    assert query_all("SELECT id FROM container_movements") == []


def test_odbiorca_z_kartoteki_scala_sie_z_dostawca_po_nip(db):
    _seed_raw_batch()
    execute("INSERT INTO suppliers (id, code, name, nip, active, created_at) "
            "VALUES ('sup9','SUP9','ODBIORCA SP. Z O.O.','111-111-11-11',true,%s)", (now_iso(),))
    with transaction() as conn:
        sup_partner = resolve_partner(conn, "supplier", "sup9")
    _wz(containers=20)
    with transaction() as conn:
        assert partner_balance_cx(conn, sup_partner)["e2"] == -20


# ── stock_raw: kaliber partii zamiast twardych 15 kg ─────────────────
def test_stock_raw_liczy_pojemniki_z_kalibru_partii(db):
    _seed_raw_batch(kg=6000.0, container_kg=20)
    row = next(r for r in stock_raw() if r["id"] == "rb1")
    assert row["containers"] == 300


def test_stock_raw_partia_niekalibrowana_proporcjonalnie(db):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, container_kg, "
        " containers_count, created_at) "
        "VALUES ('rb2','901','KOKO',6000,3000,'active','mat-cwiartka','Ćwiartka',"
        " NULL,400,%s)", (now_iso(),))
    row = next(r for r in stock_raw() if r["id"] == "rb2")
    assert row["containers"] == 200  # połowa masy → połowa pojemników


def test_stock_raw_uboczne_maja_liczbe_palet(db):
    _seed_raw_batch()
    execute("INSERT INTO byproduct_lots (id, raw_batch_id, raw_batch_no, kind, kg, "
            " status, containers_available, created_at) "
            "VALUES ('lot1','rb1','900','bones',300,'open',12,%s)", (now_iso(),))
    # batch_byproducts ma raw_batch_id jako PRIMARY KEY i NIE ma kolumny created_at.
    execute("INSERT INTO batch_byproducts (raw_batch_id, raw_batch_no, bones_pallets) "
            "VALUES ('rb1','900','[{\"containers\":6},{\"containers\":6}]') "
            "ON CONFLICT (raw_batch_id) DO UPDATE SET bones_pallets=EXCLUDED.bones_pallets")
    row = next(r for r in stock_raw() if r["id"] == "lot1")
    assert row["containers"] == 12
    assert row["pallets"] == 2


# ── Liczba pojemników wpisana na WZ rządzi SALDEM, nie tylko drukiem ──
# Prod 2026-07-30: operator wpisał 0 pojemników w polu dokumentu, a saldo
# i tak zeszło o −1741, bo księgowała się suma z POZYCJI. Dwa pola, jedno
# widoczne — drugie po cichu decydowało.
def _wz_total(containers_total, line_containers=111):
    return create_manual_wz(
        buyer=BUYER,
        selections=[{"stock_type": "raw", "stock_id": "rb1", "name": "Ćwiartka",
                     "unit": "kg", "qty": 300.0, "price": 1.0, "batch_no": "900",
                     "containers": line_containers}],
        valued=True, containers_total=containers_total)


def test_zero_pojemnikow_na_dokumencie_NIE_rusza_salda(db):
    _seed_raw_batch()
    _wz_total(0)
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner())["e2"] == 0, \
            "operator wpisał 0 — saldo ma stać w miejscu"


def test_reczna_liczba_wygrywa_z_suma_pozycji(db):
    _seed_raw_batch()
    _wz_total(20, line_containers=111)
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner())["e2"] == -20


def test_brak_wpisu_bierze_sume_z_pozycji(db):
    _seed_raw_batch()
    _wz_total(None, line_containers=111)
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner())["e2"] == -111


def test_edycja_pozycji_nie_nadpisuje_recznej_liczby(db):
    """Po korekcie pozycji ręczna liczba z dokumentu ma zostać."""
    _seed_raw_batch()
    doc = _wz_total(20, line_containers=111)
    update_wz_lines(doc["id"], [{"index": 0, "containers": 90}])
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner())["e2"] == -20
