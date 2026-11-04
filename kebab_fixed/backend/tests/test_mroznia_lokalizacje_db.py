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


def test_plan_exposes_order_identity_for_order_and_linked_stock_cartons(db):
    a, _ = seed('order', '1')
    b, _ = seed('stock', '2')
    cartons = {c['id']: c for c in svc.plan()['cartons']}
    assert cartons[a]['orderId'] == 'o1'
    assert cartons[b]['orderId'] is None
    execute("UPDATE stock_cartons SET linked_order_id='o1' WHERE id=%s", (b,))
    assert {c['orderId'] for c in svc.plan()['cartons']} == {'o1'}


@pytest.mark.parametrize('kind', ['order', 'stock'])
def test_assign_rotate_move_and_retry(db, kind):
    cid, code = seed(kind)
    assert svc.plan()['cartons'][0]['location'] is None
    first = svc.save(kind, cid, '', 0, None, 'Jan', x_cm=0, y_cm=0)
    assert sprawdz(code)['location'] == first
    assert svc.save(kind, cid, '', 0, None, x_cm=0, y_cm=0) == first
    rotated = svc.save(kind, cid, '', 90, first['revision'], x_cm=0, y_cm=0)
    assert rotated['rotation'] == 90
    moved = svc.save(kind, cid, '', 90, rotated['revision'], x_cm=480, y_cm=960)
    assert query_one('SELECT count(*) AS n FROM cold_storage_positions')['n'] == 1
    assert svc.plan()['cartons'][0]['location'] == moved
    assert svc.plan()['room'] == {'widthCm': 560, 'depthCm': 1080, 'stepCm': 10}


def test_occupied_and_stale_leave_original_placement(db):
    a, _ = seed('order', '1')
    b, _ = seed('stock', '2')
    first = svc.save('order', a, '', 0, None, x_cm=0, y_cm=0)
    other = svc.save('stock', b, '', 0, None, x_cm=160, y_cm=160)
    with pytest.raises(HTTPException) as exc:
        svc.save('stock', b, '', 90, other['revision'], x_cm=100, y_cm=0)
    assert exc.value.status_code == 409
    assert svc.location('stock', b) == other
    svc.save('order', a, '', 0, first['revision'], x_cm=0, y_cm=160)
    with pytest.raises(HTTPException):
        svc.save('order', a, '', 90, first['revision'], x_cm=0, y_cm=320)
    assert svc.location('order', a)['yCm'] == 160


def test_two_stations_cannot_take_same_slot(db):
    a, _ = seed('order', '1')
    b, _ = seed('stock', '2')
    start = Barrier(2)
    def put(kind, cid):
        start.wait(timeout=5)
        try:
            svc.save(kind, cid, '', 0, None, x_cm=0 if kind == 'order' else 100, y_cm=0)
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
    svc.save(kind, cid, '', 0, None, x_cm=360, y_cm=480)
    assert wyjedz_z_mrozni(code)['result'] == 'SUCCESS'
    assert svc.location(kind, cid) is None
    with pytest.raises(HTTPException):
        svc.save(kind, cid, '', 0, None, x_cm=360, y_cm=480)
    zwaz_i_wstaw(code, 'euro', 80, 'manual')
    assert svc.plan()['cartons'][0]['location'] is None


@pytest.mark.parametrize('kind', ['order', 'stock'])
def test_loading_frees_slot_and_undo_never_resurrects_it(db, kind):
    cid, _ = seed(kind)
    svc.save(kind, cid, '', 0, None, x_cm=0, y_cm=0)
    if kind == 'order':
        execute("UPDATE order_pallets SET status='loaded' WHERE id=%s", (cid,))
    else:
        vehicle = query_one('SELECT id FROM vehicles LIMIT 1')['id']
        execute('UPDATE stock_cartons SET loaded_vehicle_id=%s WHERE id=%s', (vehicle, cid))
    assert svc.location(kind, cid) is None
    other, _ = seed('stock', '2')
    svc.save('stock', other, '', 0, None, x_cm=0, y_cm=0)
    if kind == 'order':
        execute("UPDATE order_pallets SET status='cold_storage' WHERE id=%s", (cid,))
    else:
        execute('UPDATE stock_cartons SET loaded_vehicle_id=NULL WHERE id=%s', (cid,))
    assert svc.location(kind, cid) is None
    assert svc.location('stock', other)['slot'] == 'X0Y0'


def test_reweigh_keeps_location_and_plan_contains_tube(db):
    cid, code = seed()
    pos = svc.save('stock', cid, '', 90, None, x_cm=160, y_cm=320)
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
    pos = svc.save('order', 'p1', '', 90, None, x_cm=240, y_cm=480)
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
    pos = svc.save('stock', cid, '', 0, None, x_cm=0, y_cm=0)
    with transaction() as conn:
        for statement in DDL:
            cx_execute(conn, statement)
    assert svc.location('stock', cid) == pos


def test_manual_occupancy_without_carton_and_release(db):
    first = svc.block('Mtest', '  Łój wołowy  ', None, 'Jan', x_cm=0, y_cm=0)
    assert first['description'] == 'Łój wołowy' and first['operator'] == 'Jan'
    assert svc.block('Mtest', 'Łój wołowy', None, x_cm=0, y_cm=0) == first
    assert svc.plan()['blocked'] == [first]
    assert svc.plan()['cartons'] == []
    assert query_one('SELECT count(*) AS n FROM stock_cartons')['n'] == 0
    assert query_one('SELECT count(*) AS n FROM stock_movements')['n'] == 0
    changed = svc.block('Mtest', 'Inny towar', first['revision'], 'Ola', x_cm=80, y_cm=0, rotation=0)
    with pytest.raises(HTTPException):
        svc.unblock('Mtest', first['revision'])
    assert svc.unblock('Mtest', changed['revision']) == {'ok': True}
    assert svc.unblock('Mtest', changed['revision']) == {'ok': True}
    assert svc.plan()['blocked'] == []


def test_manual_and_carton_cannot_overlap(db):
    cid, _ = seed()
    blocked = svc.block('Mtest', '', None, x_cm=0, y_cm=0)
    assert blocked['description'] == 'Miejsce zajęte'
    with pytest.raises(HTTPException) as e:
        svc.save('stock', cid, '', 0, None, x_cm=60, y_cm=0)
    assert e.value.status_code == 409
    svc.save('stock', cid, '', 0, None, x_cm=0, y_cm=160)
    with pytest.raises(HTTPException):
        svc.block('Msecond', 'Łój', None, x_cm=100, y_cm=160)
    assert svc.location('stock', cid)['yCm'] == 160
    # Releasing an old manual mark must never remove the newly placed carton.
    svc.unblock('Mtest', blocked['revision'])
    svc.save('stock', cid, '', 0, svc.location('stock', cid)['revision'], x_cm=0, y_cm=0)
    svc.unblock('Mtest', blocked['revision'])
    assert svc.location('stock', cid)['slot'] == 'X0Y0'


@pytest.mark.parametrize('second_manual', [True, False])
def test_manual_putaway_races_are_serialized(db, second_manual):
    cid, _ = seed()
    start = Barrier(2)
    def reserve(manual):
        start.wait(timeout=5)
        try:
            if manual:
                svc.block('M' + ('1' if manual == 'Łój' else '2'), manual, None, x_cm=0 if manual == 'Łój' else 60, y_cm=0)
            else:
                svc.save('stock', cid, '', 0, None, x_cm=60, y_cm=0)
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


@pytest.mark.parametrize('rotation,width,count', [(90, 80, 7), (0, 120, 4)])
def test_actual_room_width_allows_seven_or_four(db, rotation, width, count):
    for i in range(count):
        svc.block(f'M{i}', str(i), None, x_cm=i * width, y_cm=0, rotation=rotation)
    with pytest.raises(HTTPException) as e:
        svc.block('Moverflow', 'Nie zmieści się', None, x_cm=count * width, y_cm=0, rotation=rotation)
    assert e.value.status_code == 400
    assert len(svc.plan()['blocked']) == count


def test_rotation_changes_footprint_and_cannot_shift_neighbors(db):
    a = svc.block('Ma', 'Łój', None, x_cm=0, y_cm=0, rotation=90)
    b = svc.block('Mb', 'Inny towar', None, x_cm=80, y_cm=0, rotation=90)
    with pytest.raises(HTTPException) as e:
        svc.block('Ma', 'Łój', a['revision'], x_cm=0, y_cm=0, rotation=0)
    assert e.value.status_code == 409
    assert svc.plan()['blocked'] == [a, b]
    # A touching edge is fine, and rotating into a free area is fine.
    moved = svc.block('Ma', 'Łój', a['revision'], x_cm=160, y_cm=0, rotation=0)
    assert moved['rotation'] == 0 and moved['xCm'] == 160


@pytest.mark.parametrize('x,y,rotation', [(-10, 0, 90), (0, -10, 90), (490, 0, 90), (0, 970, 90),
                                         (450, 0, 0), (0, 1010, 0), (1, 0, 90), (0, 0, 45)])
def test_walls_and_snap_enforced_by_server(db, x, y, rotation):
    with pytest.raises(HTTPException) as e:
        svc.block('Mtest', 'Towar', None, x_cm=x, y_cm=y, rotation=rotation)
    assert e.value.status_code == 400


def test_old_slots_are_preserved_without_inventing_coordinates(db):
    from app.mroznia_schema import DDL
    from app.db import transaction, cx_execute
    cid, _ = seed()
    execute("INSERT INTO cold_storage_positions(slot, carton_id, rotation, revision) VALUES ('I7', %s, 0, 'old')", (cid,))
    execute("INSERT INTO cold_storage_blocked_slots(slot, description, revision) VALUES ('A1', 'Łój', 'old')")
    with transaction() as conn:
        for statement in DDL:
            cx_execute(conn, statement)
    old = svc.plan()
    assert old['cartons'][0]['location']['slot'] == 'I7'
    assert old['cartons'][0]['location']['xCm'] is None
    assert old['blocked'][0]['xCm'] is None
    fixed = svc.save('stock', cid, '', 90, 'old', x_cm=480, y_cm=960)
    assert fixed['xCm'] == 480 and fixed['yCm'] == 960
    svc.block('A1', 'Łój', 'old', x_cm=0, y_cm=0)
    assert svc.plan()['blocked'][0]['xCm'] == 0


def test_swap_via_route_in_a_completely_full_freezer(db):
    from starlette.requests import Request
    from app.routes.magazyn import ZamianaMiejsc, mroznia_zamiana
    a, _ = seed('order', '1')
    b, _ = seed('stock', '2')
    first = svc.save('order', a, '', 90, None, x_cm=0, y_cm=0)
    second = svc.save('stock', b, '', 90, None, x_cm=80, y_cm=0)
    for i in range(2, 63):
        svc.block(f'M{i}', 'Towar', None, x_cm=(i % 7) * 80, y_cm=(i // 7) * 120)
    body = ZamianaMiejsc(first={'kind': 'order', 'container_id': a, 'expected_revision': first['revision']},
                        second={'kind': 'stock', 'container_id': b, 'expected_revision': second['revision']})
    result = mroznia_zamiana(body, Request({'type': 'http', 'state': {'subject': {'name': 'Jan'}}}))
    assert result['first']['xCm'] == 80 and result['second']['xCm'] == 0
    assert len(svc.plan()['blocked']) == 61
    assert query_one('SELECT count(*) AS n FROM cold_storage_positions')['n'] == 2
    assert query_one('SELECT operator FROM cold_storage_positions WHERE pallet_id=%s', (a,))['operator'] == 'Jan'
    # Lost response / double submit cannot silently swap back.
    with pytest.raises(HTTPException) as e:
        mroznia_zamiana(body, Request({'type': 'http'}))
    assert e.value.status_code == 409
    assert svc.location('order', a) == result['first']
    assert svc.location('stock', b) == result['second']


@pytest.mark.parametrize('kind', ['order', 'stock'])
def test_swap_keeps_each_destination_footprint_and_orientation(db, kind):
    a, _ = seed(kind, '1')
    b, _ = seed(kind, '2')
    first = svc.save(kind, a, '', 0, None, x_cm=0, y_cm=0)
    second = svc.save(kind, b, '', 90, None, x_cm=240, y_cm=160)
    neighbor = svc.block('Mnear', 'Blisko', None, x_cm=120, y_cm=0)
    result = svc.swap(kind, a, first['revision'], kind, b, second['revision'])
    assert (result['first']['xCm'], result['first']['yCm'], result['first']['rotation']) == (240, 160, 90)
    assert (result['second']['xCm'], result['second']['yCm'], result['second']['rotation']) == (0, 0, 0)
    assert svc.plan()['blocked'] == [neighbor]


def test_swap_rolls_back_both_locations_if_second_write_fails(db, monkeypatch):
    a, _ = seed('order', '1')
    b, _ = seed('stock', '2')
    first = svc.save('order', a, '', 90, None, x_cm=0, y_cm=0)
    second = svc.save('stock', b, '', 90, None, x_cm=80, y_cm=0)
    original = svc.cx_query_one
    inserts = 0
    def fail_second(conn, sql, params=None):
        nonlocal inserts
        if 'INSERT INTO cold_storage_positions' in sql:
            inserts += 1
            if inserts == 2:
                raise RuntimeError('Simulated write failure')
        return original(conn, sql, params)
    monkeypatch.setattr(svc, 'cx_query_one', fail_second)
    with pytest.raises(RuntimeError, match='Simulated write failure'):
        svc.swap('order', a, first['revision'], 'stock', b, second['revision'])
    assert svc.location('order', a) == first
    assert svc.location('stock', b) == second


def test_simultaneous_swaps_cannot_swap_back(db):
    a, _ = seed('order', '1')
    b, _ = seed('stock', '2')
    first = svc.save('order', a, '', 90, None, x_cm=0, y_cm=0)
    second = svc.save('stock', b, '', 90, None, x_cm=80, y_cm=0)
    start = Barrier(2)
    def run(reverse):
        start.wait(timeout=5)
        args = [('order', a, first['revision']), ('stock', b, second['revision'])]
        if reverse:
            args.reverse()
        try:
            svc.swap(*args[0], *args[1])
            return 200
        except HTTPException as e:
            return e.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(run, False), pool.submit(run, True)]
        assert sorted(j.result(timeout=10) for j in jobs) == [200, 409]
    assert svc.location('order', a)['xCm'] == 80
    assert svc.location('stock', b)['xCm'] == 0


def test_swap_rejects_departed_and_unpositioned_cartons(db):
    a, code = seed('order', '1')
    b, _ = seed('stock', '2')
    first = svc.save('order', a, '', 90, None, x_cm=0, y_cm=0)
    execute("INSERT INTO cold_storage_positions(slot, carton_id, rotation, revision) VALUES ('A1', %s, 0, 'old')", (b,))
    with pytest.raises(HTTPException) as e:
        svc.swap('order', a, first['revision'], 'stock', b, 'old')
    assert e.value.status_code == 409
    assert svc.location('order', a) == first
    second = svc.save('stock', b, '', 90, 'old', x_cm=80, y_cm=0)
    wyjedz_z_mrozni(code)
    with pytest.raises(HTTPException) as e:
        svc.swap('order', a, first['revision'], 'stock', b, second['revision'])
    assert e.value.status_code == 409
    assert svc.location('stock', b) == second
