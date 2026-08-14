"""Mięso b/s (bez skóry) z rozbioru — rzadka ścieżka obok mięsa z/s.

Operator przełącza rodzaj na wadze; mięso musi trafić na OSOBNY lot i osobny
rodzaj surowca, żeby nie mieszało się z z/s w magazynie ani w planie
masowania (ta sama zasada co filet). Uzysk b/s to ~50–55%, nie 63–68%.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
from datetime import date, timedelta
from types import SimpleNamespace

from app.db import query_all, query_one
from app.services.deboning_service import (
    complete_deboning_take,
    create_deboning_take,
    weigh_part_deboning_take,
)
from app.utils.ids import now_iso


def _seed_batch(batch_id="rb1", internal_no="441", kg=1000.0):
    from app.db import execute
    execute(
        "INSERT INTO raw_batches "
        "(id, internal_batch_no, internal_batch_seq, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, created_at) "
        "VALUES (%s,%s,%s,'Dostawca',%s,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (batch_id, internal_no, int(internal_no), kg, kg, now_iso()),
    )


def _take(kg, worker="DENYS"):
    return create_deboning_take(SimpleNamespace(
        raw_batch_id="rb1", worker_id="w1", worker_name=worker,
        kg_taken=kg, kg_quarter=None, session_id=None))


def _meat(kg, meat_type=None):
    return SimpleNamespace(kg_meat=kg, kg_gross=None, tare_cart_kg=None,
                           tare_e2_kg=None, e2_count=None, weigh_mode="auto",
                           meat_type=meat_type)


def test_bs_trafia_na_osobny_lot_i_osobny_rodzaj(db):
    """Scenariusz z hali: pobranie 15 kg ćwiartki, operator przełącza na b/s,
    waga pokazuje 7,5 kg → na magazyn wchodzi „Mięso b/s", nie z/s."""
    _seed_batch()
    e = _take(15.0)
    complete_deboning_take(e["id"], _meat(7.5, "bs"))

    lot = query_one("SELECT * FROM meat_stock WHERE raw_batch_no='441' AND material_type_id='mat-mieso-bs'")
    assert lot is not None, "mięso b/s nie trafiło na magazyn"
    assert float(lot["kg_available"]) == 7.5
    assert lot["material_name"] == "Mięso b/s"
    assert lot["lot_no"] == "441-BS", "lot b/s musi mieć własny numer, inaczej scali się z z/s"


def test_bs_nie_miesza_sie_z_zs_tej_samej_partii(db):
    """Najgroźniejszy błąd: lot_no jest unikatowy i ON CONFLICT dolicza kg —
    bez osobnego numeru b/s wpadłoby do lotu z/s i poszłoby do masowania."""
    _seed_batch()
    a = _take(150.0)
    complete_deboning_take(a["id"], _meat(99.0))          # domyślnie z/s
    b = _take(15.0)
    complete_deboning_take(b["id"], _meat(7.5, "bs"))

    lots = {l["material_type_id"]: l for l in
            query_all("SELECT * FROM meat_stock WHERE raw_batch_no='441'")}
    assert set(lots) == {"mat-mieso-zs", "mat-mieso-bs"}
    assert float(lots["mat-mieso-zs"]["kg_available"]) == 99.0
    assert float(lots["mat-mieso-bs"]["kg_available"]) == 7.5


def test_rodzaj_zapisany_na_wpisie_i_na_porcji(db):
    """Biuro musi widzieć, że niski uzysk to b/s, a nie zła praca — rodzaj
    siedzi na wpisie ORAZ na każdej porcji ważenia."""
    _seed_batch()
    e = _take(30.0)
    weigh_part_deboning_take(e["id"], _meat(8.0, "bs"))
    complete_deboning_take(e["id"], _meat(7.0, "bs"))

    entry = query_one("SELECT meat_type, kg_meat FROM deboning_entries WHERE id=%s", (e["id"],))
    assert entry["meat_type"] == "bs"
    assert float(entry["kg_meat"]) == 15.0
    kinds = [w["meat_type"] for w in query_all(
        "SELECT meat_type FROM deboning_take_weighings WHERE entry_id=%s ORDER BY weighed_at", (e["id"],))]
    assert kinds == ["bs", "bs"]


def test_bs_stoi_w_kolejce_OBOK_otwartego_zs_a_nie_dolicza_sie(db):
    """Zamówienie na b/s wpada nagle, gdy ludzie mają już pobrane z/s.
    Drugie pobranie tego samego pracownika z tej samej partii normalnie
    DOLICZA się do otwartego (żeby nie robić niewidocznych wierszy), ale
    b/s to inny produkt — musi stanąć jako OSOBNE pobranie w kolejce."""
    _seed_batch()
    zs = _take(150.0)
    bs = create_deboning_take(SimpleNamespace(
        raw_batch_id="rb1", worker_id="w1", worker_name="DENYS",
        kg_taken=15.0, kg_quarter=None, session_id=None, meat_type="bs"))

    assert bs["id"] != zs["id"], "b/s doliczyło się do pobrania z/s zamiast stanąć obok"
    rows = query_all("SELECT meat_type, kg_quarter FROM deboning_entries "
                     "WHERE status='pending' ORDER BY meat_type")
    assert [(r["meat_type"], float(r["kg_quarter"])) for r in rows] == [("bs", 15.0), ("zs", 150.0)]


def test_dobranie_tego_samego_rodzaju_nadal_dolicza(db):
    """Odwrotna strona reguły: dobranie z/s do otwartego z/s ma nadal
    powiększać jedno pobranie, nie mnożyć wierszy."""
    _seed_batch()
    a = _take(150.0)
    b = _take(60.0)
    assert a["id"] == b["id"]
    assert float(query_one("SELECT kg_quarter FROM deboning_entries WHERE id=%s",
                           (a["id"],))["kg_quarter"]) == 210.0


def test_wazenie_bierze_rodzaj_z_pobrania_gdy_kiosk_go_nie_poda(db):
    """Operator przełącza rodzaj przy POBRANIU; przy domykaniu może już o tym
    nie pamiętać — rodzaj pobrania musi wygrać z domyślnym 'zs'."""
    _seed_batch()
    e = create_deboning_take(SimpleNamespace(
        raw_batch_id="rb1", worker_id="w1", worker_name="DENYS",
        kg_taken=15.0, kg_quarter=None, session_id=None, meat_type="bs"))
    complete_deboning_take(e["id"], _meat(7.5))          # DTO bez meat_type
    lot = query_one("SELECT material_type_id FROM meat_stock WHERE raw_batch_no='441'")
    assert lot["material_type_id"] == "mat-mieso-bs"


def test_bs_dziala_takze_przy_wpisie_jednorazowym(db):
    """Druga ścieżka HMI: pobranie i mięso zapisane JEDNYM wpisem
    (POST /deboning/entries), nie przez pobranie+domknięcie."""
    from app.models.deboning import DeboningEntryCreate
    from app.services.deboning_service import create_deboning_entry
    _seed_batch()
    create_deboning_entry(DeboningEntryCreate(
        rawBatchId="rb1", workerId="w1", workerName="DENYS",
        kgTaken=15.0, kgMeat=7.5, meatType="bs"))
    lot = query_one("SELECT lot_no, material_type_id, kg_available FROM meat_stock "
                    "WHERE raw_batch_no='441' AND material_type_id='mat-mieso-bs'")
    assert lot and lot["lot_no"] == "441-BS" and float(lot["kg_available"]) == 7.5
    assert query_one("SELECT meat_type FROM deboning_entries")["meat_type"] == "bs"


def test_domyslnie_zs_gdy_operator_nie_przelaczyl(db):
    """Brak pola w DTO (stary kiosk) = z/s — przełącznik jest rzadkością,
    nie może zmieniać zachowania domyślnej ścieżki."""
    _seed_batch()
    e = _take(150.0)
    complete_deboning_take(e["id"], SimpleNamespace(
        kg_meat=99.0, kg_gross=None, tare_cart_kg=None, tare_e2_kg=None,
        e2_count=None, weigh_mode="auto"))
    lot = query_one("SELECT material_type_id, lot_no FROM meat_stock WHERE raw_batch_no='441'")
    assert lot["material_type_id"] == "mat-mieso-zs"
    assert lot["lot_no"] == "441"
    assert query_one("SELECT meat_type FROM deboning_entries WHERE id=%s", (e["id"],))["meat_type"] == "zs"


def test_wz_stempluje_daty_uboju_i_waznosci_takze_dla_lotu_bs(db):
    """Lot b/s ma numer z sufiksem („440-BS"), a partia ćwiartki nazywa się
    „440" — stemplowanie dat na WZ musi to znormalizować, inaczej dokument
    wychodzi bez daty uboju i ważności (prod 2026-07-28, WZ/38)."""
    from app.db import execute
    from app.services.wz_service import create_manual_wz

    _seed_batch()
    # Daty WZGLĘDEM DZIŚ, nie zaszyte: rozbiór ma strażnika przeterminowania
    # (HACCP), więc stała data ważności psuje ten test w dniu, w którym mija
    # (2026-08-01: expiry '2026-07-31' → 400 „Partia przeterminowana").
    slaughter = (date.today() - timedelta(days=7)).isoformat()
    expiry = (date.today() + timedelta(days=2)).isoformat()
    execute("UPDATE raw_batches SET slaughter_date=%s, expiry_date=%s WHERE id='rb1'",
            (slaughter, expiry))
    e = _take(15.0)
    complete_deboning_take(e["id"], _meat(7.5, "bs"))
    lot = query_one("SELECT id, lot_no FROM meat_stock WHERE material_type_id='mat-mieso-bs'")

    wz = create_manual_wz(
        buyer={"name": "Klient", "address": "", "nip": ""},
        selections=[{"stock_type": "meat", "stock_id": lot["id"], "name": "Mięso b/s",
                     "unit": "kg", "qty": 7.5, "price": 1.0, "batch_no": lot["lot_no"]}],
        valued=True,
    )
    line = wz["lines"][0]
    assert line["batch_no"] == "441-BS"
    assert line["slaughter_date"] == slaughter, "brak daty uboju na pozycji b/s"
    assert line["expiry_date"] == expiry, "brak daty ważności na pozycji b/s"


def test_wpis_jednoetapowy_ma_godzine_zwazenia(db):
    """Kartoteka pracownika pokazuje kolumnę „Zważono" z completed_at.

    Zapis „za jednym razem" (ZAPISZ na HMI) zostawiał tam NULL, więc ważenie
    zrobione na wadze wyglądało w biurze na niezważone (prod 2026-08-14,
    DAWID 75 kg). Wpis jednoetapowy JEST zważony w chwili zapisu.
    """
    from app.models.deboning import DeboningEntryCreate
    from app.services.deboning_service import create_deboning_entry
    _seed_batch()
    create_deboning_entry(DeboningEntryCreate(
        rawBatchId="rb1", workerId="w1", workerName="DAWID",
        kgTaken=75.0, kgMeat=50.0, kgGross=56.0, tareE2Kg=6.0, e2Count=3, weighMode="auto"))
    row = query_one("SELECT completed_at, created_at FROM deboning_entries")
    assert row["completed_at"] is not None
