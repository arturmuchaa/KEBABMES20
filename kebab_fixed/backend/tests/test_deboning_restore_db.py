"""Usunięte wpisy rozbioru: lista z pełnymi wagami i przywrócenie (także na innego pracownika).

Prod 2026-11-07: pobranie RAJA 5 usunięte kodem serwisowym, bo było na złym
pracowniku. Odtworzenie na IVAN 8 wymagało szukania śladu w bazie i ręcznego
przejścia rozliczenia. Ślad usunięcia ma komplet wag — biuro przywraca jednym
krokiem, tą samą drogą co hala (pobranie → mięso → grzbiety → kości).
"""
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.deboning import DeboningTakeCreate
from app.models.deboning_settlement import SettlementAdvance, SettlementWeighing
from app.services import deboning_restore_service as rs
from app.services import deboning_service as deb
from app.services import take_settlement_service as ts


def _seed(session_status='open'):
    execute("INSERT INTO workers (id, name, role, rate_per_kg) VALUES "
            "('w-raja','RAJA 5','rozbior',0.5), ('w-ivan','IVAN 8','rozbior',0.5) "
            "ON CONFLICT (id) DO NOTHING")
    execute("DELETE FROM settled_days WHERE worker_id IN ('w-raja','w-ivan')")
    execute("DELETE FROM production_sessions WHERE id='s-dzis'")
    execute("INSERT INTO production_sessions (id, session_date, process_type, status, started_at) "
            "VALUES ('s-dzis', (now() AT TIME ZONE 'Europe/Warsaw')::date, 'deboning', %s, now())", (session_status,))
    execute("""INSERT INTO raw_batches (id,internal_batch_no,internal_batch_seq,supplier_name,
        kg_received,kg_available,status,material_type_id,material_name)
        VALUES ('cw-batch','694',694,'Test',1000,1000,'active','mat-cwiartka','Ćwiartka')""")


def _w(kind, kg):
    return SettlementWeighing(requestId=str(uuid4()), kind=kind, kgNet=kg, weighMode='auto',
                              kgGross=kg + 16, tareCartKg=6, tareE2Kg=10, e2Count=5)


def _usuniete_pobranie(worker='w-raja', name='RAJA 5'):
    eid = deb.create_deboning_take(DeboningTakeCreate(
        rawBatchId='cw-batch', sessionId='s-dzis', workerId=worker, workerName=name,
        kgTaken=150, perWorker=True))['id']
    ts.start(eid)
    for kind, kg in (('meat', 97.5), ('backs', 28.0), ('bones', 24.0)):
        ts.weigh(eid, _w(kind, kg), 'operator')
        ts.advance(eid, SettlementAdvance(stage=kind), 'operator')
    ts.finish(eid, 'operator')
    deb.delete_deboning_entry(eid, office_correction=True, by_subject='MARCIN', reason='zły pracownik')
    return eid


def _stany():
    meat = query_one("SELECT kg_available FROM meat_stock WHERE lot_no='694'")
    return (
        float(query_one("SELECT kg_available FROM raw_batches WHERE id='cw-batch'")['kg_available']),
        float(meat['kg_available']) if meat else 0.0,
        sorted((r['kind'], float(r['kg'])) for r in query_all("SELECT kind, kg FROM byproduct_lots")),
    )


def test_lista_usunietych_ma_komplet_wag_i_kto_usunal(db):
    _seed(); eid = _usuniete_pobranie()
    lista = rs.list_deleted(days=7)
    assert len(lista) == 1
    u = lista[0]
    assert u['entryId'] == eid
    assert (u['workerName'], u['rawBatchNo']) == ('RAJA 5', '694')
    assert (u['kgQuarter'], u['kgMeat'], u['kgBacks'], u['kgBones']) == (150, 97.5, 28, 24)
    assert (u['bySubject'], u['reason']) == ('MARCIN', 'zły pracownik')
    assert u['restorable'] is True and u['restoredEntryId'] is None


def test_przywrocenie_na_innego_pracownika_odtwarza_wagi_i_stany(db):
    _seed()
    _usuniete_pobranie()
    po_usunieciu = _stany()
    assert po_usunieciu == (1000, 0, [])
    eid = rs.list_deleted(days=7)[0]['entryId']

    nowy = rs.restore(eid, 'w-ivan', 'pobranie było na złym pracowniku', 'biuro')

    row = query_one("SELECT * FROM deboning_entries WHERE id=%s", (nowy['id'],))
    assert (row['worker_id'], row['worker_name'], row['session_id']) == ('w-ivan', 'IVAN 8', 's-dzis')
    assert (float(row['kg_quarter']), float(row['kg_meat']), float(row['kg_backs']), float(row['kg_bones'])) == (150, 97.5, 28, 24)
    assert (row['status'], row['settlement_stage']) == ('complete', 'done')
    assert _stany() == (850, 97.5, [('backs', 28), ('bones', 24)])
    ważenia = query_all("SELECT kind, weigh_mode, reason FROM deboning_settlement_weighings WHERE entry_id=%s ORDER BY kind", (nowy['id'],))
    assert [w['kind'] for w in ważenia] == ['backs', 'bones', 'meat']
    assert all(w['weigh_mode'] == 'manual' and 'RAJA 5' in w['reason'] for w in ważenia)
    # Ślad: lista pokazuje, dokąd wpis wrócił; drugi raz się nie da.
    u = rs.list_deleted(days=7)[0]
    assert u['restoredEntryId'] == nowy['id'] and u['restoredWorkerName'] == 'IVAN 8' and u['restorable'] is False
    with pytest.raises(HTTPException) as e:
        rs.restore(eid, 'w-ivan', 'drugi raz', 'biuro')
    assert e.value.status_code == 409


def test_przywrocenie_wymaga_powodu_i_istniejacego_pracownika(db):
    _seed(); eid = _usuniete_pobranie()
    with pytest.raises(HTTPException) as e:
        rs.restore(eid, 'w-ivan', '  ', 'biuro')
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        rs.restore(eid, 'nie-ma', 'powód', 'biuro')
    assert e.value.status_code == 400
    assert _stany() == (1000, 0, [])


def test_zmiana_zamknieta_nie_przyjmie_przywrocenia(db):
    _seed(); eid = _usuniete_pobranie()
    # production_sessions nie są czyszczone przez fixture — inne testy zostawiają dzisiejsze otwarte zmiany.
    execute("UPDATE production_sessions SET status='approved' WHERE process_type='deboning' "
            "AND session_date=(now() AT TIME ZONE 'Europe/Warsaw')::date")
    with pytest.raises(HTTPException) as e:
        rs.restore(eid, 'w-ivan', 'powód', 'biuro')
    assert e.value.status_code == 409
    assert 'jest już zamknięta' in e.value.detail
    assert _stany() == (1000, 0, [])
    assert query_one("SELECT COUNT(*) AS n FROM deboning_entries")['n'] == 0


def test_brak_surowca_w_partii_nie_zostawia_pol_wpisu(db):
    _seed(); eid = _usuniete_pobranie()
    execute("UPDATE raw_batches SET kg_available=100 WHERE id='cw-batch'")
    with pytest.raises(HTTPException):
        rs.restore(eid, 'w-ivan', 'powód', 'biuro')
    assert query_one("SELECT COUNT(*) AS n FROM deboning_entries")['n'] == 0
    assert float(query_one("SELECT kg_available FROM raw_batches WHERE id='cw-batch'")['kg_available']) == 100
