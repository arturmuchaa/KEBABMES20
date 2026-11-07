"""Zmiana pracownika w pobraniu rozliczonym per pracownik (mięso → grzbiety → kości).

Prod 2026-11-07: pobranie zapisane na złego pracownika (RAJA 5 zamiast IVAN 8).
Korekta z biura odmawiała dla pobrań z rozliczeniem, więc jedyną drogą było
usunięcie i ponowne ważenie. Pracownik to przypisanie, nie pomiar — zmienia
się bez ruszania wag, stanów i czasu; kilogramy nadal poprawia tylko waga.
"""
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.deboning import DeboningTakeCreate
from app.models.deboning_settlement import SettlementAdvance, SettlementWeighing
from app.services import batch_byproducts_service as bp
from app.services import deboning_service as deb
from app.services import take_settlement_service as ts


def _seed():
    execute("INSERT INTO workers (id, name, role, rate_per_kg) VALUES "
            "('w-raja','RAJA 5','rozbior',0.5), ('w-ivan','IVAN 8','rozbior',0.5) "
            "ON CONFLICT (id) DO NOTHING")
    execute("DELETE FROM settled_days WHERE worker_id IN ('w-raja','w-ivan')")
    execute("""INSERT INTO raw_batches (id,internal_batch_no,internal_batch_seq,supplier_name,
        kg_received,kg_available,status,material_type_id,material_name)
        VALUES ('cw-batch','694',694,'Test',1000,1000,'active','mat-cwiartka','Ćwiartka')""")


def _w(kind, kg):
    return SettlementWeighing(requestId=str(uuid4()), kind=kind, kgNet=kg, weighMode='auto',
                              kgGross=kg + 16, tareCartKg=6, tareE2Kg=10, e2Count=5)


def _take(settle=True):
    eid = deb.create_deboning_take(DeboningTakeCreate(
        rawBatchId='cw-batch', workerId='w-raja', workerName='RAJA 5', kgTaken=150, perWorker=True))['id']
    ts.start(eid)
    if settle:
        for kind, kg in (('meat', 97.5), ('backs', 28.0), ('bones', 24.0)):
            ts.weigh(eid, _w(kind, kg), 'operator')
            ts.advance(eid, SettlementAdvance(stage=kind), 'operator')
        ts.finish(eid, 'operator')
    return eid


def _stany():
    return (
        float(query_one("SELECT kg_available FROM raw_batches WHERE id='cw-batch'")['kg_available']),
        float(query_one("SELECT kg_available FROM meat_stock WHERE lot_no='694'")['kg_available']),
        sorted((r['kind'], float(r['kg'])) for r in query_all("SELECT kind, kg FROM byproduct_lots")),
        float(query_one("SELECT COALESCE(SUM(qty),0) AS s FROM stock_movements")['s']),
    )


def test_rozliczone_pobranie_zmienia_pracownika_bez_ruszania_wag_i_stanow(db):
    _seed(); eid = _take()
    przed = _stany()
    czas = query_one("SELECT created_at, completed_at FROM deboning_entries WHERE id=%s", (eid,))

    out = deb.correct_deboning_entry(eid, 'w-ivan', None, None, 'pobranie zapisane na złego pracownika', 'biuro')

    assert out['workerName'] == 'IVAN 8'
    row = query_one("SELECT * FROM deboning_entries WHERE id=%s", (eid,))
    assert (row['worker_id'], row['worker_name']) == ('w-ivan', 'IVAN 8')
    assert (float(row['kg_quarter']), float(row['kg_meat']), float(row['kg_backs']), float(row['kg_bones'])) == (150, 97.5, 28, 24)
    assert (row['created_at'], row['completed_at']) == (czas['created_at'], czas['completed_at'])
    assert row['settlement_stage'] == 'done' and row['status'] == 'complete'
    assert _stany() == przed
    # Ważenia ubocznych pokazują pracownika z wpisu (dziennik ważeń, statystyki).
    rec = query_one("SELECT backs_pallets, bones_pallets FROM batch_byproducts WHERE raw_batch_id='cw-batch'")
    assert {p['workerName'] for p in rec['backs_pallets'] + rec['bones_pallets']} == {'IVAN 8'}
    assert {p['workerId'] for p in rec['backs_pallets'] + rec['bones_pallets']} == {'w-ivan'}
    assert len(query_all("SELECT 1 FROM deboning_settlement_weighings WHERE entry_id=%s", (eid,))) == 3
    hist = deb.list_entry_corrections(eid)
    assert hist[0]['changes'] == {'worker': {'from': 'RAJA 5', 'to': 'IVAN 8'}}
    assert hist[0]['reason'] == 'pobranie zapisane na złego pracownika'


def test_rozliczone_pobranie_kilogramy_dalej_tylko_przez_wage(db):
    _seed(); eid = _take()
    with pytest.raises(HTTPException) as e:
        deb.correct_deboning_entry(eid, 'w-ivan', None, 90, 'inne mięso', 'biuro')
    assert e.value.status_code == 409
    assert query_one("SELECT worker_name FROM deboning_entries WHERE id=%s", (eid,))['worker_name'] == 'RAJA 5'


def test_pobranie_w_trakcie_rozliczenia_na_hali_nie_zmienia_pracownika(db):
    _seed(); eid = _take(settle=False)
    with pytest.raises(HTTPException) as e:
        deb.correct_deboning_entry(eid, 'w-ivan', None, None, 'zły pracownik', 'biuro')
    assert e.value.status_code == 409
    assert 'rozlicz' in e.value.detail


@pytest.mark.parametrize('kto', ['w-raja', 'w-ivan'])
def test_dzien_rozliczony_w_wyplacie_blokuje_przeniesienie(db, kto):
    _seed(); eid = _take()
    execute("INSERT INTO settled_days (worker_id, work_date, settlement_id) "
            "VALUES (%s, (now() AT TIME ZONE 'Europe/Warsaw')::date, 'ps-1')", (kto,))
    with pytest.raises(HTTPException) as e:
        deb.correct_deboning_entry(eid, 'w-ivan', None, None, 'zły pracownik', 'biuro')
    assert e.value.status_code == 409
    assert 'rozliczony w wypłacie' in e.value.detail
    assert query_one("SELECT worker_name FROM deboning_entries WHERE id=%s", (eid,))['worker_name'] == 'RAJA 5'
