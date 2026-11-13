"""Fixed freezer places A–I / 1–7. One carton or manual mark per place.

Rotation records orientation in that place, never moves neighbouring goods.
"""
import json
import re

from fastapi import HTTPException

from app.db import transaction, cx_execute, cx_query_all, cx_query_one, query_one
from app.services.clients_service import client_short_name_sql
from app.utils.ids import cuid, format_carton_no


def _position(row):
    if not row or not row.get('slot'):
        return None
    return {"slot": row['slot'], "rotation": row['rotation'], "revision": row['revision']}


# Kto może stać na miejscu: paleta zamówienia, karton magazynowy albo paleta
# czekająca na zamówienie (poczekalnia — fizycznie dalej w mroźni).
_OWNERS = {'order': ('order_pallets', 'pallet_id'), 'stock': ('stock_cartons', 'carton_id'),
           'waiting': ('orphan_pallets', 'orphan_id')}


def _in_cold(kind, container):
    if not container:
        return False
    if kind == 'stock':
        return bool(container.get('cold_storage_at') and not container.get('loaded_vehicle_id')
                    and not container.get('shipped_at'))
    return container.get('status') == 'cold_storage'


def location(kind, container_id):
    column = _OWNERS[kind][1]
    return _position(query_one(f'SELECT * FROM cold_storage_positions WHERE {column}=%s', (container_id,)))


def plan():
    with transaction() as conn:
        cx_execute(conn, 'SELECT pg_advisory_xact_lock_shared(202611040001)')
        blocked = cx_query_all(conn, 'SELECT * FROM cold_storage_blocked_slots ORDER BY slot')
        rows = cx_query_all(conn, f"""
            SELECT 'order' AS kind, p.id, p.carton_no, o.client_name, o_cs.short_name AS client_short_name,
                   o.order_no, p.order_id,
                   'PAL|' || p.order_id || '|' || p.pallet_no AS code,
                   pos.slot, pos.rotation, pos.revision
            FROM order_pallets p JOIN client_orders o ON o.id=p.order_id
            {client_short_name_sql('o')}
            LEFT JOIN cold_storage_positions pos ON pos.pallet_id=p.id
            WHERE p.status='cold_storage'
            UNION ALL
            SELECT 'stock', c.id, c.carton_no, c.client_name, c_cs.short_name, c.linked_order_no, c.linked_order_id,
                   'SCARTON|' || c.id, pos.slot, pos.rotation, pos.revision
            FROM stock_cartons c
            {client_short_name_sql('c')}
            LEFT JOIN cold_storage_positions pos ON pos.carton_id=c.id
            WHERE c.cold_storage_at IS NOT NULL AND c.loaded_vehicle_id IS NULL AND c.shipped_at IS NULL
            UNION ALL
            SELECT 'waiting', w.id, w.carton_no, w.client_name, w_cs.short_name, '', NULL,
                   'PAL|' || w.source_order_id || '|' || w.pallet_no, pos.slot, pos.rotation, pos.revision
            FROM orphan_pallets w
            {client_short_name_sql('w')}
            LEFT JOIN cold_storage_positions pos ON pos.orphan_id=w.id
            WHERE w.status='cold_storage'
            ORDER BY carton_no, id
        """)
        waiting = {r['id']: r['items'] for r in cx_query_all(
            conn, "SELECT id, items FROM orphan_pallets WHERE status='cold_storage'")}
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
    for wid, items in waiting.items():
        for it in (items if isinstance(items, list) else json.loads(items or '[]')):
            contents.setdefault(('waiting', wid), []).append({
                'qty': int(it.get('qty') or 0), 'kgPerUnit': float(it.get('kg_per_unit') or 0),
                'recipeName': it.get('recipe_name') or '', 'productTypeName': it.get('product_type_name') or '',
                'packagingName': it.get('packaging_name') or '', 'source': 'plan'})
    for source, lines in [('scans', actual), ('plan', planned)]:
        for line in lines:
            contents.setdefault((line['kind'], line['id']), []).append({
                'qty': line['qty'], 'kgPerUnit': line['kg'], 'recipeName': line['recipe'] or '',
                'productTypeName': line['product'] or '', 'packagingName': line['packaging'] or '', 'source': source,
            })
    return {
        'columns': list('ABCDEFGHI'), 'rows': 7,
        'blocked': [_blocked(r) for r in blocked],
        'cartons': [{
            'kind': r['kind'], 'id': r['id'], 'code': r['code'],
            'cartonNo': format_carton_no(r['carton_no']) if r['carton_no'] else '',
            'clientName': r['client_name'] or '', 'clientShortName': r['client_short_name'] or '',
            'orderNo': r['order_no'] or '', 'orderId': r['order_id'],
            'location': _position(r), 'lines': contents.get((r['kind'], r['id']), []),
        } for r in rows],
    }


def save(kind, container_id, slot, rotation, expected_revision, operator=''):
    if kind not in _OWNERS or not re.fullmatch(r'[A-I][1-7]', slot or '') or rotation not in (0, 90):
        raise HTTPException(400, 'Nieprawidłowe miejsce lub obrót palety')
    table, column = _OWNERS[kind]
    with transaction() as conn:
        # Serializes competing put-aways; row lock also protects against loading/exit.
        cx_execute(conn, 'SELECT pg_advisory_xact_lock(202611040001)')
        container = cx_query_one(conn, f'SELECT * FROM {table} WHERE id=%s FOR UPDATE', (container_id,))
        if not _in_cold(kind, container):
            raise HTTPException(409, 'Karton nie stoi już w mroźni. Odśwież listę.')
        current = cx_query_one(conn, f'SELECT * FROM cold_storage_positions WHERE {column}=%s', (container_id,))
        if current and current['slot'] == slot and current['rotation'] == rotation:
            return _position(current)  # lost response: safe retry of the same placement
        if (current['revision'] if current else None) != expected_revision:
            raise HTTPException(409, 'Lokalizacja zmieniła się na innym stanowisku. Wybierz miejsce ponownie.')
        if cx_query_one(conn, 'SELECT slot FROM cold_storage_blocked_slots WHERE slot=%s', (slot,)):
            raise HTTPException(409, f'Miejsce {slot} jest oznaczone jako zajęte przez inny towar. Wybierz inne.')
        if (cx_query_one(conn, 'SELECT slot FROM cold_storage_positions WHERE slot=%s', (slot,))
                and (not current or current['slot'] != slot)):
            raise HTTPException(409, f'Miejsce {slot} jest już zajęte. Wybierz inne lub zamień kartony miejscami.')
        cx_execute(conn, f'DELETE FROM cold_storage_positions WHERE {column}=%s', (container_id,))
        revision = cuid()
        cx_execute(conn, f'''INSERT INTO cold_storage_positions (slot, {column}, rotation, revision, operator)
                            VALUES (%s,%s,%s,%s,%s)''', (slot, container_id, rotation, revision, operator))
        return {'slot': slot, 'rotation': rotation, 'revision': revision}


def swap(first_kind, first_id, first_revision, second_kind, second_id, second_revision, operator=''):
    """Swap two occupied places atomically, including the destination's rotation.

    No free staging slot needed. Reusing old revisions must NOT swap them back.
    Both parent locks also serialize this with loading/exit from cold storage.
    """
    requests = [(first_kind, first_id, first_revision), (second_kind, second_id, second_revision)]
    if (any(k not in _OWNERS or not cid or not rev for k, cid, rev in requests)
            or (first_kind, first_id) == (second_kind, second_id)):
        raise HTTPException(400, 'Wybierz dwa różne kartony z aktualnym położeniem.')
    with transaction() as conn:
        cx_execute(conn, 'SELECT pg_advisory_xact_lock(202611040001)')
        positions = {}
        for kind, cid, revision in sorted(requests):
            table, column = _OWNERS[kind]
            container = cx_query_one(conn, f'SELECT * FROM {table} WHERE id=%s FOR UPDATE', (cid,))
            if not _in_cold(kind, container):
                raise HTTPException(409, 'Jeden z kartonów nie stoi już w mroźni. Odczytaj plan ponownie.')
            row = cx_query_one(conn, f'SELECT * FROM cold_storage_positions WHERE {column}=%s', (cid,))
            if not row or row['revision'] != revision:
                raise HTTPException(409, 'Położenie jednego z kartonów zmieniło się. Wybierz parę ponownie.')
            if not re.fullmatch(r'[A-I][1-7]', row['slot']):
                raise HTTPException(409, 'Najpierw przypisz oba kartony do stałych miejsc.')
            positions[(kind, cid)] = row
        a, b = positions[(first_kind, first_id)], positions[(second_kind, second_id)]
        # Delete and reinsert under one transaction; nobody can observe half a swap.
        # This avoids temporary fake slots and immediate unique-slot violations.
        cx_execute(conn, 'DELETE FROM cold_storage_positions WHERE slot=ANY(%s)', ([a['slot'], b['slot']],))
        result = {}
        for name, kind, cid, destination in [('first', first_kind, first_id, b), ('second', second_kind, second_id, a)]:
            column = _OWNERS[kind][1]
            row = cx_query_one(conn, f'''
                INSERT INTO cold_storage_positions(slot, {column}, rotation, revision, operator)
                VALUES (%s,%s,%s,%s,%s) RETURNING *''',
                (destination['slot'], cid, destination['rotation'], cuid(), operator))
            result[name] = _position(row)
        return result


def _blocked(row):
    return {'slot': row['slot'], 'revision': row['revision'], 'description': row['description'],
            'operator': row['operator'], 'updatedAt': row['updated_at'].isoformat()}


def block(slot: str, description: str, expected_revision: str | None, operator: str = ''):
    description = description.strip() or 'Miejsce zajęte'
    if not re.fullmatch(r'[A-I][1-7]', slot or '') or len(description) > 160:
        raise HTTPException(400, 'Nieprawidłowe miejsce lub opis (maks. 160 znaków)')
    with transaction() as conn:
        # Same lock as put-away: neither operation can race past the other.
        cx_execute(conn, 'SELECT pg_advisory_xact_lock(202611040001)')
        current = cx_query_one(conn, 'SELECT * FROM cold_storage_blocked_slots WHERE slot=%s', (slot,))
        if current and current['description'] == description:
            return _blocked(current)  # safe retry after losing the response
        if (current['revision'] if current else None) != expected_revision:
            raise HTTPException(409, 'Oznaczenie miejsca zmieniło się na innym stanowisku. Odczytaj je ponownie.')
        if cx_query_one(conn, 'SELECT slot FROM cold_storage_positions WHERE slot=%s', (slot,)):
            raise HTTPException(409, f'Miejsce {slot} jest zajęte przez karton. Nie można go zablokować ręcznie.')
        row = cx_query_one(conn, '''
            INSERT INTO cold_storage_blocked_slots (slot, description, revision, operator)
            VALUES (%s,%s,%s,%s) ON CONFLICT (slot) DO UPDATE
            SET description=EXCLUDED.description, revision=EXCLUDED.revision,
                operator=EXCLUDED.operator, updated_at=now()
            RETURNING *''', (slot, description, cuid(), operator))
        return _blocked(row)


def unblock(slot: str, expected_revision: str):
    if not re.fullmatch(r'[A-I][1-7]', slot or '') or not expected_revision:
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
