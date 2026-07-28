"""Mięso b/s (bez skóry) z rozbioru — rzadka ścieżka obok mięsa z/s.

Operator przełącza rodzaj na wadze; mięso musi trafić na OSOBNY lot i osobny
rodzaj surowca, żeby nie mieszało się z z/s w magazynie ani w planie
masowania (ta sama zasada co filet). Uzysk b/s to ~50–55%, nie 63–68%.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
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
