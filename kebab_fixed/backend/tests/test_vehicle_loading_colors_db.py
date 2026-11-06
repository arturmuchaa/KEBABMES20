from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from app.db import cx_execute, cx_query_all, execute, query_all, transaction
from app.services import vehicle_loading_service as svc
from app.vehicle_loading_colors_schema import SQL
from tests.test_vehicle_loading_sync_db import _pojazd, _slowniki, _zamowienie


def seed():
    _pojazd(); _slowniki()
    for i in range(6):
        _zamowienie(f'o{i}', f'Z/{i}')


def colors():
    return {o['id']: o['color_index'] for o in svc.vehicle_state('v1')['orders']}


def test_five_orders_keep_colors_across_devices_reordering_and_removal(db):
    seed()
    for i in range(5):
        svc.add_order('v1', f'o{i}')
    initial = colors()
    assert set(initial.values()) == set(range(5))
    svc.reorder('v1', ['o4', 'o3', 'o2', 'o1', 'o0'])
    svc.add_order('v1', 'o2')  # duplicate request never recolours
    assert colors() == initial
    svc.remove_order('v1', 'o1')
    svc.add_order('v1', 'o5')
    after = colors()
    assert len(set(after.values())) == 5
    assert all(after[oid] == index for oid, index in initial.items() if oid != 'o1')
    assert after['o5'] == initial['o1']
    _pojazd('v2')
    assert svc.add_order('v2', 'o5')['orders'][0]['color_index'] == 0


def test_simultaneous_additions_get_distinct_colors(db):
    seed()
    start = Barrier(5)
    def add(i):
        start.wait(timeout=5)
        svc.add_order('v1', f'o{i}')
    with ThreadPoolExecutor(max_workers=5) as pool:
        list(pool.map(add, range(5)))
    assert set(colors().values()) == set(range(5))
    # Legacy migration inserts also go through the allocator.
    execute("INSERT INTO vehicle_loading_orders(id, vehicle_id, order_id) VALUES ('legacy', 'v1', 'o5')")
    assert len({r['color_index'] for r in query_all('SELECT color_index FROM vehicle_loading_orders')}) == 6


def test_legacy_color_migration_is_repeatable_and_preserves_order_sequence(db):
    # A private schema keeps this migration rehearsal isolated from the app tables.
    with transaction() as conn:
        cx_execute(conn, 'CREATE SCHEMA color_migration_test')
        cx_execute(conn, 'SET LOCAL search_path TO color_migration_test')
        cx_execute(conn, 'CREATE TABLE vehicles(id TEXT PRIMARY KEY)')
        cx_execute(conn, 'CREATE TABLE vehicle_loading_orders(id TEXT PRIMARY KEY, vehicle_id TEXT, position INT, created_at TIMESTAMPTZ)')
        cx_execute(conn, "INSERT INTO vehicles VALUES ('v')")
        cx_execute(conn, "INSERT INTO vehicle_loading_orders VALUES ('a','v',10,now()), ('b','v',20,now())")
        for sql in SQL:
            cx_execute(conn, sql)
        first = cx_query_all(conn, 'SELECT id, position, color_index FROM vehicle_loading_orders ORDER BY id')
        assert first == [{'id': 'a', 'position': 10, 'color_index': 0}, {'id': 'b', 'position': 20, 'color_index': 1}]
        for sql in SQL:
            cx_execute(conn, sql)
        assert cx_query_all(conn, 'SELECT id, position, color_index FROM vehicle_loading_orders ORDER BY id') == first
        cx_execute(conn, "INSERT INTO vehicle_loading_orders(id, vehicle_id) VALUES ('c','v')")
        assert cx_query_all(conn, "SELECT color_index FROM vehicle_loading_orders WHERE id='c'")[0]['color_index'] == 2
        cx_execute(conn, 'DROP SCHEMA color_migration_test CASCADE')
