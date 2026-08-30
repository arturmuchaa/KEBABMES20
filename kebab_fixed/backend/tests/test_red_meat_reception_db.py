"""Przyjęcie mięsa czerwonego — wołowina i łój tą samą ścieżką co drób.

Instrukcja 1.1 oPRP wymienia w zakresie „Mięsa drobne wołowe, cielęce",
„Elementy wołowe, cielęce" i „Tłuszcz wołowy" razem z drobiem, więc czerwone
NIE ma osobnego przyjęcia: ten sam dokument, ta sama karta 1.1.1, ta sama
numeracja. Różni je stan dostawy (chłodzony / mrożony), bo od niego zależy
próg temperatury i magazyn (pom. 3 +3 °C albo pom. 6 −18 °C).
"""
from app.db import execute, query_all, query_one
from app.models.receptions import ReceptionCreate, ReceptionUpdate
from app.services.receptions_service import create_reception, update_reception
from app.utils.ids import now_iso


def _seed_supplier():
    execute("INSERT INTO suppliers (id, code, name, nip, active, created_at) "
            "VALUES ('sup-wol','WOL','ZM WOŁOWINA','5130064480',true,%s) "
            "ON CONFLICT (id) DO NOTHING", (now_iso(),))


def _dto(material="mat-wolowina-8020", state="mrozony", **kw):
    base = dict(
        receivedDate="2026-08-30",
        supplierId="sup-wol",
        materialTypeId=material,
        documentNo="WZ-WOL-1",
        pricePerKg=18.0,
        storageState=state,
        groups=[dict(kgReceived=900.0, supplierBatches=[
            dict(supplierBatchNo="B001", kg=900.0, expiryDate="2027-02-01"),
        ])],
    )
    base.update(kw)
    return ReceptionCreate.model_validate(base)


def test_slownik_ma_wolowine_i_loj(db):
    """Migracja zasiewa pięć rodzajów czerwonych, wszystkie przyjmowalne."""
    rows = query_all(
        "SELECT id, requires_deboning, receivable FROM raw_material_types "
        "WHERE category='czerwone' ORDER BY id")
    ids = [r["id"] for r in rows]
    assert ids == [
        "mat-loj-otokowy", "mat-loj-zwykly", "mat-wolowina-8020",
        "mat-wolowina-mostek", "mat-wolowina-zrazowa",
    ]
    # Żadna z nich nie idzie na rozbiór: bloki wchodzą wprost do masowania
    # (instrukcja 2.5 pkt 5.1.1), a płaty kroi się dopiero na produkcji.
    assert all(r["requires_deboning"] is False for r in rows)
    assert all(r["receivable"] is True for r in rows)


def test_wolowina_idzie_zwyklym_przyjeciem(db):
    """Ten sam dokument i ta sama seria numerów co drób — bez osobnej ścieżki."""
    _seed_supplier()
    out = create_reception(_dto())
    assert out["reception"]["reception_no"] == "1/08"
    partia = out["batches"][0]
    assert partia["material_type_id"] == "mat-wolowina-8020"
    assert partia["storage_state"] == "mrozony"


def test_blok_mrozony_laduje_na_magazynie_ze_stanem(db):
    """Lot magazynu mięsa dziedziczy stan — inaczej nie wiadomo, gdzie leży."""
    _seed_supplier()
    numer = create_reception(_dto())["batches"][0]["internal_batch_no"]
    lot = query_one("SELECT * FROM meat_stock WHERE lot_no=%s", (numer,))
    assert lot is not None, "surowiec bez rozbioru trafia od razu na magazyn mięsa"
    assert lot["storage_state"] == "mrozony"
    assert float(lot["kg_available"]) == 900.0


def test_loj_swiezy_zostaje_chlodzony(db):
    """Stan bierze się z dokumentu, nie z rodzaju — łój bywa i taki, i taki."""
    _seed_supplier()
    numer = create_reception(
        _dto(material="mat-loj-otokowy", state="chlodzony"))["batches"][0]["internal_batch_no"]
    lot = query_one("SELECT * FROM meat_stock WHERE lot_no=%s", (numer,))
    assert lot["storage_state"] == "chlodzony"
    assert lot["material_type_id"] == "mat-loj-otokowy"


def test_nieznany_stan_czyta_sie_jak_chlodzony(db):
    """Stara wersja formularza nie przyśle stanu — nie wolno jej odrzucić."""
    _seed_supplier()
    out = create_reception(_dto(state="jakis-smiec"))
    assert out["batches"][0]["storage_state"] == "chlodzony"


def test_poprawka_stanu_idzie_na_partie_i_lot(db):
    """Operator pomylił stan; poprawka musi ruszyć też magazyn."""
    _seed_supplier()
    out = create_reception(_dto(state="chlodzony"))
    partia = out["batches"][0]
    update_reception(out["reception"]["id"], ReceptionUpdate.model_validate(dict(
        receivedDate="2026-08-30",
        materialTypeId="mat-wolowina-8020",
        documentNo="WZ-WOL-1",
        pricePerKg=18.0,
        storageState="mrozony",
        groups=[dict(batchId=partia["id"], kgReceived=900.0, supplierBatches=[
            dict(supplierBatchNo="B001", kg=900.0, expiryDate="2027-02-01"),
        ])],
    )))
    po = query_one("SELECT storage_state FROM raw_batches WHERE id=%s", (partia["id"],))
    lot = query_one("SELECT storage_state FROM meat_stock WHERE raw_batch_id=%s",
                    (partia["id"],))
    assert po["storage_state"] == "mrozony"
    assert lot["storage_state"] == "mrozony", "lot bez poprawki wskazywałby zły magazyn"


def test_drob_nietkniety_domyslnie_chlodzony(db):
    """Regres: ćwiartka nie dostaje stanu z formularza i ma zostać chłodzona."""
    _seed_supplier()
    out = create_reception(ReceptionCreate.model_validate(dict(
        receivedDate="2026-08-30",
        supplierId="sup-wol",
        materialTypeId="mat-cwiartka",
        documentNo="WZ-DROB-1",
        pricePerKg=5.0,
        groups=[dict(kgReceived=1000.0, supplierBatches=[
            dict(supplierBatchNo="C001", kg=1000.0, expiryDate="2026-09-06"),
        ])],
    )))
    assert out["batches"][0]["storage_state"] == "chlodzony"
