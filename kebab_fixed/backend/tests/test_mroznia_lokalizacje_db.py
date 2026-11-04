from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi import HTTPException

from app.db import execute, query_one, query_all
from app.services import mroznia_lokalizacje_service as svc
from app.services.mroznia_wazenie_service import sprawdz, zwaz_i_wstaw, wyjedz_z_mrozni
from tests.test_magazyn_pakowanie_db import _karton, _paleta, _receptury, _sztuka


def seed(kind='stock', suffix='1'):
    _receptury()
    if kind == 'stock':
        cid = _karton('KLIENT' + suffix)['id']
        code = f'SCARTON|{cid}'
    else:
        cid = _paleta('o' + suffix, 'KLIENT' + suffix, carton_no=900 + int(suffix))
        code = f'PAL|o{suffix}|1'
    zwaz_i_wstaw(code, 'euro', 80, 'manual')
    return cid, code


@pytest.mark.parametrize('kind', ['order', 'stock'])
def test_assign_rotate_move_and_retry(db, kind):
    cid, code = seed(kind)
    assert svc.plan()['cartons'][0]['location'] is None
    first = svc.save(kind, cid, 'A1', 0, None, 'Jan')
    assert sprawdz(code)['location'] == first
    assert svc.save(kind, cid, 'A1', 0, None) == first
    rotated = svc.save(kind, cid, 'A1', 90, first['revision'])
    assert rotated['rotation'] == 90
    moved = svc.save(kind, cid, 'I7', 90, rotated['revision'])
    assert query_one('SELECT count(*) AS n FROM cold_storage_positions')['n'] == 1
    assert svc.plan()['cartons'][0]['location'] == moved
    assert svc.plan()['columns'] == list('ABCDEFGHI') and svc.plan()['rows'] == 7


def test_occupied_and_stale_leave_original_placement(db):
    a, _ = seed('order', '1')
    b, _ = seed('stock', '2')
    first = svc.save('order', a, 'A1', 0, None)
    other = svc.save('stock', b, 'B2', 0, None)
    with pytest.raises(HTTPException) as exc:
        svc.save('stock', b, 'A1', 90, other['revision'])
    assert exc.value.status_code == 409
    assert svc.location('stock', b) == other
    svc.save('order', a, 'A2', 0, first['revision'])
    with pytest.raises(HTTPException):
        svc.save('order', a, 'A3', 90, first['revision'])
    assert svc.location('order', a)['slot'] == 'A2'


def test_two_stations_cannot_take_same_slot(db):
    a, _ = seed('order', '1')
    b, _ = seed('stock', '2')
    start = Barrier(2)
    def put(kind, cid):
        start.wait(timeout=5)
        try:
            svc.save(kind, cid, 'C3', 0, None)
            return 200
        except HTTPException as e:
            return e.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(put, 'order', a), pool.submit(put, 'stock', b)]
        assert sorted(j.result(timeout=10) for j in jobs) == [200, 409]
    assert query_one('SELECT count(*) AS n FROM cold_storage_positions')['n'] == 1


@pytest.mark.parametrize('kind', ['order', 'stock'])
def test_exit_and_reentry_do_not_reuse_location(db, kind):
    cid, code = seed(kind)
    svc.save(kind, cid, 'D4', 0, None)
    assert wyjedz_z_mrozni(code)['result'] == 'SUCCESS'
    assert svc.location(kind, cid) is None
    with pytest.raises(HTTPException):
        svc.save(kind, cid, 'D4', 0, None)
    zwaz_i_wstaw(code, 'euro', 80, 'manual')
    assert svc.plan()['cartons'][0]['location'] is None


@pytest.mark.parametrize('kind', ['order', 'stock'])
def test_loading_frees_slot_and_undo_never_resurrects_it(db, kind):
    cid, _ = seed(kind)
    svc.save(kind, cid, 'A1', 0, None)
    if kind == 'order':
        execute("UPDATE order_pallets SET status='loaded' WHERE id=%s", (cid,))
    else:
        vehicle = query_one('SELECT id FROM vehicles LIMIT 1')['id']
        execute('UPDATE stock_cartons SET loaded_vehicle_id=%s WHERE id=%s', (vehicle, cid))
    assert svc.location(kind, cid) is None
    other, _ = seed('stock', '2')
    svc.save('stock', other, 'A1', 0, None)
    if kind == 'order':
        execute("UPDATE order_pallets SET status='cold_storage' WHERE id=%s", (cid,))
    else:
        execute('UPDATE stock_cartons SET loaded_vehicle_id=NULL WHERE id=%s', (cid,))
    assert svc.location(kind, cid) is None
    assert svc.location('stock', other)['slot'] == 'A1'


def test_reweigh_keeps_location_and_plan_contains_tube(db):
    cid, code = seed()
    pos = svc.save('stock', cid, 'B3', 90, None)
    zwaz_i_wstaw(code, 'euro', 80, 'manual')
    assert svc.location('stock', cid) == pos
    line = svc.plan()['cartons'][0]['lines'][0]
    assert line == {'qty': 3, 'kgPerUnit': 15, 'recipeName': 'KIRMIZI', 'productTypeName': 'UDO 100%',
                    'packagingName': 'METAL 80', 'source': 'plan'}


def test_actual_contents_split_tubes_and_do_not_invent_remaining_units(db):
    cid, code = seed()
    for i, tube in enumerate(['METAL 80', 'PAPIER 100']):
        _sztuka(f'u{i}', tuleja=tube)
        execute('UPDATE finished_units SET carton_id=%s WHERE id=%s', (cid, f'u{i}'))
    lines = svc.plan()['cartons'][0]['lines']
    assert len(lines) == 2
    assert {p['packagingName'] for p in lines} == {'METAL 80', 'PAPIER 100'}
    assert all(p['qty'] == 1 and p['source'] == 'scans' for p in lines)
    assert len(sprawdz(code)['lines']) == 2


def test_loading_api_exposes_location_and_releases_it_on_scan(db):
    from app.services import pallets_service, vehicle_loading_service
    from tests.test_vehicle_loading_sync_db import _baza_jednego_auta
    _baza_jednego_auta()
    vehicle_loading_service.add_order('v1', 'o1')
    pallets_service.scan('PAL|o1|1', 'cold_storage')
    pos = svc.save('order', 'p1', 'C4', 90, None)
    state = vehicle_loading_service.vehicle_state('v1')
    assert next(p for p in state['orders'][0]['pallets'] if p['id'] == 'p1')['location'] == pos
    result = pallets_service.scan('PAL|o1|1', 'loaded', vehicle_id='v1')
    assert result['result'] == 'SUCCESS'
    assert svc.location('order', 'p1') is None
    state = vehicle_loading_service.vehicle_state('v1')
    assert next(p for p in state['orders'][0]['pallets'] if p['id'] == 'p1')['location'] is None
    pallets_service.scan('PAL|o1|1', 'undo', vehicle_id='v1')
    assert svc.location('order', 'p1') is None


def test_schema_is_idempotent_and_preserves_positions(db):
    from app.mroznia_schema import DDL
    from app.db import transaction, cx_execute
    cid, _ = seed()
    pos = svc.save('stock', cid, 'A1', 0, None)
    with transaction() as conn:
        for statement in DDL:
            cx_execute(conn, statement)
    assert svc.location('stock', cid) == pos


def test_manual_occupancy_without_carton_and_release(db):
    first = svc.block('A1', '  Łój wołowy  ', None, 'Jan')
    assert first['description'] == 'Łój wołowy' and first['operator'] == 'Jan'
    assert svc.block('A1', 'Łój wołowy', None) == first
    assert svc.plan()['blocked'] == [first]
    assert svc.plan()['cartons'] == []
    assert query_one('SELECT count(*) AS n FROM stock_cartons')['n'] == 0
    assert query_one('SELECT count(*) AS n FROM stock_movements')['n'] == 0
    changed = svc.block('A1', 'Inny towar', first['revision'], 'Ola')
    with pytest.raises(HTTPException):
        svc.unblock('A1', first['revision'])
    assert svc.unblock('A1', changed['revision']) == {'ok': True}
    assert svc.unblock('A1', changed['revision']) == {'ok': True}
    assert svc.plan()['blocked'] == []


def test_manual_and_carton_cannot_overlap(db):
    cid, _ = seed()
    blocked = svc.block('A1', '', None)
    assert blocked['description'] == 'Miejsce zajęte'
    with pytest.raises(HTTPException) as e:
        svc.save('stock', cid, 'A1', 0, None)
    assert e.value.status_code == 409
    svc.save('stock', cid, 'A2', 0, None)
    with pytest.raises(HTTPException):
        svc.block('A2', 'Łój', None)
    assert svc.location('stock', cid)['slot'] == 'A2'
    # Releasing an old manual mark must never remove the newly placed carton.
    svc.unblock('A1', blocked['revision'])
    svc.save('stock', cid, 'A1', 0, svc.location('stock', cid)['revision'])
    svc.unblock('A1', blocked['revision'])
    assert svc.location('stock', cid)['slot'] == 'A1'


@pytest.mark.parametrize('second_manual', [True, False])
def test_manual_putaway_races_are_serialized(db, second_manual):
    cid, _ = seed()
    start = Barrier(2)
    def reserve(manual):
        start.wait(timeout=5)
        try:
            if manual:
                svc.block('C3', manual, None)
            else:
                svc.save('stock', cid, 'C3', 0, None)
            return 200
        except HTTPException as e:
            return e.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(reserve, 'Łój'), pool.submit(reserve, 'Inny towar' if second_manual else None)]
        assert sorted(j.result(timeout=10) for j in jobs) == [200, 409]
    assert query_one('SELECT (SELECT count(*) FROM cold_storage_positions) + '
                     '(SELECT count(*) FROM cold_storage_blocked_slots) AS n')['n'] == 1


@pytest.mark.parametrize('slot,description', [('J1', 'Łój'), ('A1\n', 'Łój'), ('A1', 'x' * 161)])
def test_invalid_manual_mark_rejected(db, slot, description):
    with pytest.raises(HTTPException) as e:
        svc.block(slot, description, None)
    assert e.value.status_code == 400


@pytest.mark.parametrize('slot,rotation', [('J1', 0), ('A8', 0), ('A0', 0), ('A1', 45), ('A1\n', 0)])
def test_invalid_place_rejected_before_write(db, slot, rotation):
    with pytest.raises(HTTPException) as exc:
        svc.save('stock', 'unknown', slot, rotation, None)
    assert exc.value.status_code == 400
    assert query_all('SELECT * FROM cold_storage_positions') == []
