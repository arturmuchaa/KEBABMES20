"""Physical layout in cm, origin at left/door wall. Pallet 120 × 80 cm.

0° = 120 wide × 80 deep; 90° = 80 wide × 120 deep (legacy rotation convention).
Never invent coordinates for legacy inventory or returned pallets.
"""
import re

from fastapi import HTTPException

from app.db import transaction, cx_execute, cx_query_all, cx_query_one, query_one
from app.utils.ids import cuid, format_carton_no

ROOM = {'widthCm': 560, 'depthCm': 1080, 'stepCm': 10}


def _geometry(x, y, rotation):
    if type(x) is not int or type(y) is not int or rotation not in (0, 90):
        raise HTTPException(400, 'Wskaż położenie na nowym planie mroźni (w cm). Odśwież aplikację.')
    w, h = (120, 80) if rotation == 0 else (80, 120)
    if x < 0 or y < 0 or x % 10 or y % 10 or x + w > 560 or y + h > 1080:
        raise HTTPException(400, 'Paleta wychodzi poza mroźnię 560 × 1080 cm lub poza siatkę 10 cm.')
    return x, y, w, h


def _check_overlap(conn, rect, column=None, container_id=None, manual_slot=None):
    # Must hold the shared transaction lock: different anchors can overlap too.
    rows = cx_query_all(conn, 'SELECT * FROM cold_storage_positions WHERE x_cm IS NOT NULL')
    manual = cx_query_all(conn, 'SELECT * FROM cold_storage_blocked_slots WHERE x_cm IS NOT NULL')
    x, y, w, h = rect
    others = [r for r in rows if not column or r.get(column) != container_id]
    others += [r for r in manual if r['slot'] != manual_slot]
    for row in others:
        a, b, c, d = _geometry(row['x_cm'], row['y_cm'], row['rotation'])
        if x < a + c and x + w > a and y < b + d and y + h > b:
            raise HTTPException(409, 'Paleta nachodzi na inny karton lub towar. Wybierz inne położenie albo obrót.')


def _position(row):
    if not row or not row.get('slot'):
        return None
    return {"slot": row['slot'], "rotation": row['rotation'], "revision": row['revision'],
            "xCm": row.get('x_cm'), "yCm": row.get('y_cm')}


def location(kind, container_id):
    column = 'pallet_id' if kind == 'order' else 'carton_id'
    return _position(query_one(f'SELECT * FROM cold_storage_positions WHERE {column}=%s', (container_id,)))


def plan():
    with transaction() as conn:
        cx_execute(conn, 'SELECT pg_advisory_xact_lock_shared(202611040001)')
        blocked = cx_query_all(conn, 'SELECT * FROM cold_storage_blocked_slots ORDER BY slot')
        rows = cx_query_all(conn, """
            SELECT 'order' AS kind, p.id, p.carton_no, o.client_name, o.order_no, p.order_id,
                   'PAL|' || p.order_id || '|' || p.pallet_no AS code,
                   pos.slot, pos.rotation, pos.revision, pos.x_cm, pos.y_cm
            FROM order_pallets p JOIN client_orders o ON o.id=p.order_id
            LEFT JOIN cold_storage_positions pos ON pos.pallet_id=p.id
            WHERE p.status='cold_storage'
            UNION ALL
            SELECT 'stock', c.id, c.carton_no, c.client_name, c.linked_order_no, c.linked_order_id,
                   'SCARTON|' || c.id, pos.slot, pos.rotation, pos.revision, pos.x_cm, pos.y_cm
            FROM stock_cartons c LEFT JOIN cold_storage_positions pos ON pos.carton_id=c.id
            WHERE c.cold_storage_at IS NOT NULL AND c.loaded_vehicle_id IS NULL AND c.shipped_at IS NULL
            ORDER BY carton_no, id
        """)
        # Three bulk reads, never a request/query per carton on a busy freezer.
        ids = [r['id'] for r in rows]
        actual = cx_query_all(conn, """
            SELECT CASE WHEN fu.carton_id IS NOT NULL THEN 'stock' ELSE 'order' END AS kind,
                   COALESCE(fu.carton_id, fu.pallet_id) AS id, COUNT(*)::int AS qty,
                   fu.weight_kg::float AS kg, r.name AS recipe, pt.name AS product, fu.tuleja AS packaging
            FROM finished_units fu LEFT JOIN recipes r ON r.id=fu.recipe_id
            LEFT JOIN product_types pt ON pt.id=fu.product_type_id
            WHERE (fu.carton_id=ANY(%s) OR fu.pallet_id=ANY(%s))
              AND fu.status <> 'shipped' AND fu.dispatch_id IS NULL
            GROUP BY fu.carton_id, fu.pallet_id, fu.weight_kg, r.name, pt.name, fu.tuleja
            ORDER BY kg DESC, recipe, product, packaging
        """, (ids, ids)) if ids else []
        planned = cx_query_all(conn, """
            SELECT 'order' AS kind, pi.pallet_id AS id, pi.qty, l.kg_per_unit::float AS kg,
                   l.recipe_name AS recipe, l.product_type_name AS product, l.packaging_name AS packaging
            FROM order_pallet_items pi JOIN client_order_lines l ON l.id=pi.order_line_id
            WHERE pi.pallet_id=ANY(%s)
              AND NOT EXISTS (SELECT 1 FROM finished_units fu WHERE fu.pallet_id=pi.pallet_id)
              AND NOT EXISTS (SELECT 1 FROM warehouse_events e WHERE e.container_id=pi.pallet_id AND e.action='unpack')
            UNION ALL
            SELECT 'stock', l.carton_id, l.target_qty, l.kg_per_unit::float,
                   l.recipe_name, l.product_type_name, l.packaging_name
            FROM stock_carton_lines l WHERE l.carton_id=ANY(%s)
              AND NOT EXISTS (SELECT 1 FROM finished_units fu WHERE fu.carton_id=l.carton_id)
              AND NOT EXISTS (SELECT 1 FROM warehouse_events e WHERE e.container_id=l.carton_id AND e.action='unpack')
            ORDER BY kg DESC, recipe, product, packaging
        """, (ids, ids)) if ids else []
    contents = {}
    for source, lines in [('scans', actual), ('plan', planned)]:
        for line in lines:
            contents.setdefault((line['kind'], line['id']), []).append({
                'qty': line['qty'], 'kgPerUnit': line['kg'], 'recipeName': line['recipe'] or '',
                'productTypeName': line['product'] or '', 'packagingName': line['packaging'] or '', 'source': source,
            })
    return {
        'columns': list('ABCDEFGHI'), 'rows': 7, 'room': ROOM,
        'blocked': [_blocked(r) for r in blocked],
        'cartons': [{
            'kind': r['kind'], 'id': r['id'], 'code': r['code'],
            'cartonNo': format_carton_no(r['carton_no']) if r['carton_no'] else '',
            'clientName': r['client_name'] or '', 'orderNo': r['order_no'] or '', 'orderId': r['order_id'],
            'location': _position(r), 'lines': contents.get((r['kind'], r['id']), []),
        } for r in rows],
    }


def save(kind, container_id, slot, rotation, expected_revision, operator='', *, x_cm=None, y_cm=None):
    if kind not in ('order', 'stock'):
        raise HTTPException(400, 'Nieprawidłowe miejsce lub obrót palety')
    rect = _geometry(x_cm, y_cm, rotation)
    slot = f'X{x_cm}Y{y_cm}'
    table, column = ('order_pallets', 'pallet_id') if kind == 'order' else ('stock_cartons', 'carton_id')
    with transaction() as conn:
        # Serializes competing put-aways; row lock also protects against loading/exit.
        cx_execute(conn, 'SELECT pg_advisory_xact_lock(202611040001)')
        container = cx_query_one(conn, f'SELECT * FROM {table} WHERE id=%s FOR UPDATE', (container_id,))
        in_cold = container and (container.get('status') == 'cold_storage' if kind == 'order' else
                                container.get('cold_storage_at') and not container.get('loaded_vehicle_id')
                                and not container.get('shipped_at'))
        if not in_cold:
            raise HTTPException(409, 'Karton nie stoi już w mroźni. Odśwież listę.')
        current = cx_query_one(conn, f'SELECT * FROM cold_storage_positions WHERE {column}=%s', (container_id,))
        if current and current['x_cm'] == x_cm and current['y_cm'] == y_cm and current['rotation'] == rotation:
            return _position(current)  # lost response: safe retry of the same placement
        if (current['revision'] if current else None) != expected_revision:
            raise HTTPException(409, 'Lokalizacja zmieniła się na innym stanowisku. Wybierz miejsce ponownie.')
        _check_overlap(conn, rect, column, container_id)
        cx_execute(conn, f'DELETE FROM cold_storage_positions WHERE {column}=%s', (container_id,))
        revision = cuid()
        cx_execute(conn, f'''INSERT INTO cold_storage_positions (slot, {column}, rotation, revision, operator, x_cm, y_cm)
                            VALUES (%s,%s,%s,%s,%s,%s,%s)''', (slot, container_id, rotation, revision, operator, x_cm, y_cm))
        return {'slot': slot, 'rotation': rotation, 'revision': revision, 'xCm': x_cm, 'yCm': y_cm}


def swap(first_kind, first_id, first_revision, second_kind, second_id, second_revision, operator=''):
    """Swap two occupied footprints atomically, including the destination's rotation.

    No free staging slot needed. Reusing old revisions must NOT swap them back.
    Both parent locks also serialize this with loading/exit from cold storage.
    """
    requests = [(first_kind, first_id, first_revision), (second_kind, second_id, second_revision)]
    if (any(k not in ('order', 'stock') or not cid or not rev for k, cid, rev in requests)
            or (first_kind, first_id) == (second_kind, second_id)):
        raise HTTPException(400, 'Wybierz dwa różne kartony z aktualnym położeniem.')
    with transaction() as conn:
        cx_execute(conn, 'SELECT pg_advisory_xact_lock(202611040001)')
        positions = {}
        for kind, cid, revision in sorted(requests):
            table, column = ('order_pallets', 'pallet_id') if kind == 'order' else ('stock_cartons', 'carton_id')
            container = cx_query_one(conn, f'SELECT * FROM {table} WHERE id=%s FOR UPDATE', (cid,))
            in_cold = container and (container.get('status') == 'cold_storage' if kind == 'order' else
                                    container.get('cold_storage_at') and not container.get('loaded_vehicle_id')
                                    and not container.get('shipped_at'))
            if not in_cold:
                raise HTTPException(409, 'Jeden z kartonów nie stoi już w mroźni. Odczytaj plan ponownie.')
            row = cx_query_one(conn, f'SELECT * FROM cold_storage_positions WHERE {column}=%s', (cid,))
            if not row or row['revision'] != revision:
                raise HTTPException(409, 'Położenie jednego z kartonów zmieniło się. Wybierz parę ponownie.')
            if row['x_cm'] is None or row['y_cm'] is None:
                raise HTTPException(409, 'Najpierw wskaż rzeczywiste położenie obu kartonów na mapie.')
            positions[(kind, cid)] = row
        a, b = positions[(first_kind, first_id)], positions[(second_kind, second_id)]
        # Delete and reinsert under one transaction; nobody can observe half a swap.
        # This avoids temporary fake slots and immediate unique-slot violations.
        cx_execute(conn, 'DELETE FROM cold_storage_positions WHERE slot=ANY(%s)', ([a['slot'], b['slot']],))
        result = {}
        for name, kind, cid, destination in [('first', first_kind, first_id, b), ('second', second_kind, second_id, a)]:
            column = 'pallet_id' if kind == 'order' else 'carton_id'
            _check_overlap(conn, _geometry(destination['x_cm'], destination['y_cm'], destination['rotation']))
            row = cx_query_one(conn, f'''
                INSERT INTO cold_storage_positions(slot, {column}, rotation, revision, operator, x_cm, y_cm)
                VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *''',
                (destination['slot'], cid, destination['rotation'], cuid(), operator, destination['x_cm'], destination['y_cm']))
            result[name] = _position(row)
        return result


def _blocked(row):
    return {**_position(row), 'description': row['description'],
            'operator': row['operator'], 'updatedAt': row['updated_at'].isoformat()}


def block(slot: str, description: str, expected_revision: str | None, operator: str = '', *, x_cm=None, y_cm=None, rotation=90):
    description = description.strip() or 'Miejsce zajęte'
    if not re.fullmatch(r'(?:[A-I][1-7]|M[a-zA-Z0-9-]{1,64})', slot or '') or len(description) > 160:
        raise HTTPException(400, 'Nieprawidłowe miejsce lub opis (maks. 160 znaków)')
    rect = _geometry(x_cm, y_cm, rotation)
    with transaction() as conn:
        # Same lock as put-away: neither operation can race past the other.
        cx_execute(conn, 'SELECT pg_advisory_xact_lock(202611040001)')
        current = cx_query_one(conn, 'SELECT * FROM cold_storage_blocked_slots WHERE slot=%s', (slot,))
        if (current and current['description'] == description and current['x_cm'] == x_cm
                and current['y_cm'] == y_cm and current['rotation'] == rotation):
            return _blocked(current)  # safe retry after losing the response
        if (current['revision'] if current else None) != expected_revision:
            raise HTTPException(409, 'Oznaczenie miejsca zmieniło się na innym stanowisku. Odczytaj je ponownie.')
        _check_overlap(conn, rect, manual_slot=slot)
        row = cx_query_one(conn, '''
            INSERT INTO cold_storage_blocked_slots (slot, description, revision, operator, x_cm, y_cm, rotation)
            VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (slot) DO UPDATE
            SET description=EXCLUDED.description, revision=EXCLUDED.revision,
                operator=EXCLUDED.operator, updated_at=now(), x_cm=EXCLUDED.x_cm, y_cm=EXCLUDED.y_cm,
                rotation=EXCLUDED.rotation
            RETURNING *''', (slot, description, cuid(), operator, x_cm, y_cm, rotation))
        return _blocked(row)


def unblock(slot: str, expected_revision: str):
    if not re.fullmatch(r'(?:[A-I][1-7]|M[a-zA-Z0-9-]{1,64})', slot or '') or not expected_revision:
        raise HTTPException(400, 'Wskaż miejsce i aktualną wersję oznaczenia')
    with transaction() as conn:
        cx_execute(conn, 'SELECT pg_advisory_xact_lock(202611040001)')
        current = cx_query_one(conn, 'SELECT * FROM cold_storage_blocked_slots WHERE slot=%s', (slot,))
        if not current:
            return {'ok': True}  # repeated release must not remove a carton
        if current['revision'] != expected_revision:
            raise HTTPException(409, 'Oznaczenie miejsca zmieniło się. Sprawdź towar przed zwolnieniem.')
        cx_execute(conn, 'DELETE FROM cold_storage_blocked_slots WHERE slot=%s', (slot,))
        return {'ok': True}
