"""Testy: 'Mięso z/s' jest osobnym rodzajem surowca (produkt rozbioru),
odrębnym od surowca 'Ćwiartka'.

- Rozbiór ćwiartki produkuje meat_stock otagowany `mat-mieso-zs` (NIE `mat-cwiartka`).
- Surowiec (raw_batches) zostaje ćwiartką — rozbiór nie zmienia partii surowca.
- Słownik rodzajów: `mat-mieso-zs` istnieje, jest masowalny (requires_deboning=False)
  i nieprzyjmowalny (receivable=False); ćwiartka jest przyjmowalna.

Testy DB wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
import json

from app.db import execute, query_one
from app.migrations import _migrate_cwiartka_to_mieso_zs
from app.models.deboning import DeboningEntryCreate
from app.services.deboning_service import create_deboning_entry
from app.utils.ids import now_iso


def _seed_cwiartka_batch(batch_id="rb1", internal_no="500", kg=100.0):
    execute(
        "INSERT INTO raw_batches "
        "(id, internal_batch_no, internal_batch_seq, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (batch_id, internal_no, int(internal_no), "Dostawca", kg, kg, now_iso()),
    )


# ── Rozbiór produkuje mięso z/s ────────────────────────────────────────
def test_deboning_produces_mieso_zs_not_cwiartka(db):
    _seed_cwiartka_batch(internal_no="500", kg=100.0)
    create_deboning_entry(DeboningEntryCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=100.0, kg_meat=70.0,
    ))
    ms = query_one("SELECT material_type_id, material_name FROM meat_stock WHERE lot_no='500'")
    assert ms["material_type_id"] == "mat-mieso-zs"
    assert ms["material_name"] == "Mięso z/s"


def test_deboning_leaves_raw_batch_as_cwiartka(db):
    # Surowiec NIE zmienia rodzaju — ćwiartka zostaje ćwiartką w raw_batches.
    _seed_cwiartka_batch(internal_no="501", kg=100.0, batch_id="rb1")
    create_deboning_entry(DeboningEntryCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=80.0, kg_meat=56.0,
    ))
    rb = query_one("SELECT material_type_id FROM raw_batches WHERE id='rb1'")
    assert rb["material_type_id"] == "mat-cwiartka"


# ── Słownik rodzajów surowca ───────────────────────────────────────────
def test_mieso_zs_seeded_as_seasonable_and_receivable(db):
    # receivable=true od przyjęć zewnętrznych z/s (migracja 891/904):
    # powstaje z rozbioru ORAZ bywa kupowane z zewnątrz → meat_stock.
    mz = query_one(
        "SELECT requires_deboning, receivable FROM raw_material_types WHERE id='mat-mieso-zs'"
    )
    assert mz is not None, "mat-mieso-zs musi być zaseedowany"
    assert mz["requires_deboning"] is False   # masowalny wprost
    assert mz["receivable"] is True           # przyjęcie zewnętrzne z/s → meat_stock


def test_cwiartka_is_receivable_but_not_seasonable(db):
    cw = query_one(
        "SELECT requires_deboning, receivable FROM raw_material_types WHERE id='mat-cwiartka'"
    )
    assert cw["requires_deboning"] is True
    assert cw["receivable"] is True


# ── Migracja istniejących danych ───────────────────────────────────────
def test_migration_retags_meat_and_seasoned_but_not_raw(db):
    execute(
        "INSERT INTO meat_stock (id, lot_no, kg_initial, kg_available, status, "
        "material_type_id, material_name, created_at) "
        "VALUES ('m1','900',50,50,'AVAILABLE','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (now_iso(),),
    )
    execute(
        "INSERT INTO seasoned_meat (id, batch_no, recipe_id, kg_produced, kg_available, "
        "status, material_type_id, material_name) "
        "VALUES ('s1','900','r1',50,50,'available','mat-cwiartka','Ćwiartka z kurczaka')"
    )
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, kg_received, "
        "kg_available, status, material_type_id, material_name, created_at) "
        "VALUES ('rbx','900',900,50,50,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (now_iso(),),
    )

    _migrate_cwiartka_to_mieso_zs()

    assert query_one("SELECT material_type_id FROM meat_stock WHERE id='m1'")["material_type_id"] == "mat-mieso-zs"
    assert query_one("SELECT material_type_id FROM seasoned_meat WHERE id='s1'")["material_type_id"] == "mat-mieso-zs"
    # surowiec ZOSTAJE ćwiartką
    assert query_one("SELECT material_type_id FROM raw_batches WHERE id='rbx'")["material_type_id"] == "mat-cwiartka"


def test_migration_rewrites_product_type_components(db):
    comps = [
        {"id": "a", "pct": 70, "name": "Ćwiartka z kurczaka", "materialTypeId": "mat-cwiartka"},
        {"id": "b", "pct": 30, "name": "Filet z kurczaka", "materialTypeId": "mat-filet-kurczak"},
    ]
    execute(
        "INSERT INTO product_types (id, name, components, active, created_at) "
        "VALUES ('ptm','MIX',%s::jsonb,true,%s)",
        (json.dumps(comps), now_iso()),
    )
    # Stary komponent 'MIĘSO Z/S' bez materialTypeId (rodzaj sprzed słownika)
    execute(
        "INSERT INTO product_types (id, name, components, active, created_at) "
        "VALUES ('ptu','UDO',%s::jsonb,true,%s)",
        (json.dumps([{"id": "x", "pct": 100, "name": "MIĘSO Z/S"}]), now_iso()),
    )

    _migrate_cwiartka_to_mieso_zs()

    mix = query_one("SELECT components FROM product_types WHERE id='ptm'")["components"]
    mats = {c.get("materialTypeId") for c in mix}
    assert mats == {"mat-mieso-zs", "mat-filet-kurczak"}
    udo = query_one("SELECT components FROM product_types WHERE id='ptu'")["components"]
    assert udo[0]["materialTypeId"] == "mat-mieso-zs"
