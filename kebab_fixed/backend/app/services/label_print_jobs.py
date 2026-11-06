"""Durable ZPL/A4 preparation and audit, shared with existing unit/reprint logic.

No printer IO here. `submitted` means acknowledged by the local transport, not
physically printed. Frozen payloads are replayed without reading current recipes,
templates or unit data. No operation in this module creates finished_units.
"""
from __future__ import annotations

import hashlib
import json
import zlib
from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import HTTPException

from app.db import transaction, cx_execute, cx_query_one, cx_query_all, query_all
from app.utils.ids import cuid
from app.services.label_unit_selection import (
    select_existing_units, unique_unit_qrs, validate_template_binding, has_unit_qr, one_copy,
    MAX_LABEL_BYTES, MAX_JOB_BYTES, MAX_UNITS,
)

SCOPE = 'legacy-single-company'  # NOT a tenant identifier supplied by a browser.
MAX_STORED_BYTES = 16 * 1024 * 1024
MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024
RECOVERY_DELAY = timedelta(minutes=5)


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, default=str, allow_nan=False)


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def selection(ids: list[str] | None) -> str | None:
    if ids is None:
        return None
    if not ids or len(ids) > MAX_UNITS or any(not isinstance(i, str) or not i.strip() or i != i.strip() or ',' in i or len(i) > 128 for i in ids):
        raise HTTPException(422, 'Nieprawidłowa lista sztuk')
    if len(ids) != len(set(ids)):
        raise HTTPException(422, 'Powtórzone identyfikatory sztuk')
    return ','.join(ids)


def unpack(item: dict) -> str:
    decoder = zlib.decompressobj()
    try:
        raw = decoder.decompress(bytes(item['payload_zlib']), MAX_LABEL_BYTES + 1)
        if len(raw) > MAX_LABEL_BYTES or not decoder.eof or decoder.unused_data:
            raise ValueError('Invalid size')
        if digest(raw) != item['payload_sha256']:
            raise ValueError('Invalid digest')
        return raw.decode('utf-8')
    except (ValueError, zlib.error) as exc:
        raise HTTPException(409, 'Niezgodność integralności zapisanego wydruku — nie wysłano danych') from exc


def _get(conn, job_id: str, *, lock=False) -> dict:
    # Keep metadata/state and subsequent event reads consistent with transitions.
    row = cx_query_one(conn, 'SELECT * FROM label_print_jobs WHERE id=%s AND scope_key=%s' + (' FOR UPDATE' if lock else ' FOR SHARE'), (job_id, SCOPE))
    if not row:
        raise HTTPException(404, 'Nie znaleziono zadania wydruku')
    return row


def _items(conn, job_id: str, ids: list[str] | None = None) -> list[dict]:
    requested = selection(ids)
    rows = cx_query_all(conn, '''SELECT *, unit_id AS id FROM label_print_job_items
        WHERE job_id=%s AND (%s::text[] IS NULL OR unit_id=ANY(%s)) ORDER BY ordinal LIMIT 1001''', (job_id, ids, ids))
    rows = select_existing_units(rows, requested)
    if not rows or len(rows) > MAX_UNITS or sum(len(r['payload_zlib']) for r in rows) > MAX_STORED_BYTES:
        raise HTTPException(409, 'Nieprawidłowa zawartość zapisanego zadania')
    return rows


def _response(conn, row: dict, ids: list[str] | None = None) -> dict:
    items = _items(conn, row['id'], ids)
    payloads, total = [], 0
    for item in items:
        payload = unpack(item)
        total += len(payload.encode('utf-8')) + 1
        if total > MAX_JOB_BYTES:
            raise HTTPException(413, 'Zadanie przekracza limit pamięci')
        payloads.append(payload)
    events = cx_query_all(conn, 'SELECT state,actor,created_at FROM label_print_events WHERE job_id=%s ORDER BY id', (row['id'],))
    result = {
        'id': row['id'], 'state': row['state'], 'revisionId': row['revision_id'],
        'sourceJobId': row['source_job_id'], 'printerName': row['printer_name'],
        'printerUid': row['printer_uid'],
        'transport': row['transport'], 'createdAt': str(row['created_at']),
        'createdBy': row['created_by'], 'language': row['language'],
        'unitIds': [item['unit_id'] for item in items], 'count': len(items),
        'ok': True,
        'events': [{'state': e['state'], 'actor': e['actor'], 'createdAt': str(e['created_at'])} for e in events],
    }
    if row['language'] == 'zpl':
        result['zpl'] = '\n'.join(payloads)
    else:
        from app.services.label_templates_service import _row_to_full
        from app.services.label_a4_snapshot import VERSION, MAX_A4_UNITS
        context = row['render_context']
        if not isinstance(context, dict) or context.get('rendererVersion') != VERSION:
            raise HTTPException(409, 'Nieobsługiwana wersja archiwalnego renderera A4')
        revision = cx_query_one(conn, 'SELECT source,document FROM label_template_revisions WHERE id=%s AND scope_key=%s', (row['revision_id'], SCOPE))
        if not revision or revision['source'] != 'label_templates':
            raise HTTPException(409, 'Brak archiwalnej rewizji A4')
        if row['transport'] == 'file' and not revision['document'].get('background_pdf'):
            raise HTTPException(422, 'Eksport PDF wymaga szablonu z oryginalnym PDF; tło obrazowe drukuje istniejąca ścieżka HTML')
        try:
            decoded = [json.loads(p) for p in payloads]
            if any(d['unit']['id'] != i['unit_id'] for d, i in zip(decoded, items)):
                raise ValueError('unit mismatch')
            per_sheet = context['labelsPerSheet']
            if type(per_sheet) is not int or not 1 <= per_sheet <= 20 or len(decoded) > MAX_A4_UNITS:
                raise ValueError('invalid layout')
            if per_sheet != revision['document']['labels_per_sheet']:
                raise ValueError('layout mismatch')
            occupied = set()
            for d in decoded:
                sheet, slot = d['placement']['sheet'], d['placement']['slot']
                if type(sheet) is not int or sheet < 0 or type(slot) is not int or not 0 <= slot < per_sheet or (sheet, slot) in occupied:
                    raise ValueError('invalid placement')
                occupied.add((sheet, slot))
            result['a4'] = {**context, 'template': _row_to_full(revision['document']),
                            'units': [d['unit'] for d in decoded], 'placements': [d['placement'] for d in decoded]}
        except (KeyError, TypeError, ValueError) as exc:
            raise HTTPException(409, 'Niezgodność danych snapshotu A4') from exc
    return result


def get_job(job_id: str, unit_ids: list[str] | None = None) -> dict:
    with transaction() as conn:
        return _response(conn, _get(conn, job_id), unit_ids)


def find_by_key(key: str) -> dict | None:
    """Recover a lost prepare response; a GET never starts/retries printer IO."""
    with transaction() as conn:
        row = cx_query_one(conn, 'SELECT * FROM label_print_jobs WHERE scope_key=%s AND idempotency_key=%s FOR SHARE', (SCOPE, key))
        return _response(conn, row) if row else None


def _freeze_current(conn, dto: dict) -> tuple[int, str, list[dict], dict]:
    from app.services.zebra_designer_service import design_to_zpl, _design_dict_from_row
    from app.services.zebra_labels_service import unit_zpl_values, merge_zpl

    client, recipe_id, line_id = (dto.get(k) or '' for k in ('client_id', 'recipe_id', 'plan_line_id'))
    if not client or not recipe_id or not line_id:
        raise HTTPException(422, 'Wymagany klient, receptura i linia planu')
    aliases = cx_query_all(conn, 'SELECT id,name,display_name,halal_supervision FROM clients WHERE id=%s OR name=%s OR display_name=%s LIMIT 2 FOR SHARE', (client, client, client))
    if len(aliases) > 1:
        raise HTTPException(409, 'Niejednoznaczny alias klienta — druk zablokowany')
    alias = aliases[0] if aliases else {}
    keys = list({client, alias.get('id') or client, alias.get('name') or client, alias.get('display_name') or client})
    ids = dto.get('unit_ids')
    requested = selection(ids)
    units = cx_query_all(conn, '''SELECT * FROM finished_units WHERE plan_line_id=%s
        AND (%s::text[] IS NULL OR id=ANY(%s)) ORDER BY qr_seq,id LIMIT 1001 FOR SHARE''', (line_id, ids, ids))
    units = select_existing_units(units, requested)
    if not units or len(units) > MAX_UNITS:
        raise HTTPException(422, 'Brak sztuk lub więcej niż 1000 sztuk w zadaniu')
    validate_template_binding(units, keys, recipe_id)
    if not unique_unit_qrs(units):
        raise HTTPException(422, 'Brak unikalnych QR sztuk')
    source = 'zebra_label_designs'
    templates = [] if dto['language'] == 'a4' else cx_query_all(conn, 'SELECT * FROM zebra_label_designs WHERE client_id=ANY(%s) AND recipe_id=%s ORDER BY id FOR SHARE', (keys, recipe_id))
    if dto['language'] == 'a4':
        source = 'label_templates'
        templates = cx_query_all(conn, "SELECT * FROM label_templates WHERE client_id=ANY(%s) AND recipe_id=%s AND kind<>'zpl' ORDER BY id FOR SHARE", (keys, recipe_id))
    elif not templates:
        source = 'label_templates'
        templates = cx_query_all(conn, "SELECT * FROM label_templates WHERE client_id=ANY(%s) AND recipe_id=%s AND kind='zpl' ORDER BY id FOR SHARE", (keys, recipe_id))
    if not templates:
        raise HTTPException(422, 'Brak szablonu wybranego rodzaju dla wskazanych sztuk')
    if len(templates) != 1:
        raise HTTPException(409, 'Kilka szablonów pasuje do aliasów klienta. Ujednolić przypisanie przed drukiem.')
    template = templates[0]
    revision = cx_query_one(conn, "SELECT id FROM label_template_revisions WHERE scope_key=%s AND source=%s AND template_id=%s ORDER BY revision DESC LIMIT 1", (SCOPE, source, template['id']))
    if not revision:
        raise HTTPException(409, 'Brak rewizji szablonu — wymagane migracje historii etykiet')
    recipe = cx_query_one(conn, 'SELECT * FROM recipes WHERE id=%s FOR SHARE', (recipe_id,))
    if not recipe:
        raise HTTPException(422, 'Brak receptury')
    render_context = {}
    if dto['language'] == 'a4':
        from app.services import label_a4_snapshot as a4
        render_context = a4.context(template, recipe, alias, dto.get('org_code'), len(units))
    elif source == 'zebra_label_designs':
        design = _design_dict_from_row(template)
        if not any(el.get('type') == 'qr' and el.get('value') == '[[QR]]' and not el.get('gf') for el in design['elements']):
            raise HTTPException(422, 'Projekt wymaga dynamicznego QR [[QR]]')
        render = lambda values: design_to_zpl(design, values)
    else:
        if not has_unit_qr(template.get('zpl') or ''):
            raise HTTPException(422, 'Szablon wymaga dynamicznego QR [[QR]]')
        render = lambda values: merge_zpl(template['zpl'], values)
    items, total, stored, snapshot_bytes = [], 0, 0, 0
    recipe_size = len(canonical(recipe).encode('utf-8'))
    for ordinal, unit in enumerate(units):
        if dto['language'] == 'a4':
            payload = canonical(a4.item(unit, template, ordinal, render_context['labelsPerSheet'])).encode('utf-8')
        else:
            payload = one_copy(render(unit_zpl_values(unit, recipe))).encode('utf-8')
        compressed = zlib.compress(payload)
        total += len(payload) + 1
        stored += len(compressed)
        snapshot_bytes += recipe_size + len(canonical(unit).encode('utf-8'))
        if len(payload) > MAX_LABEL_BYTES or total > MAX_JOB_BYTES or stored > MAX_STORED_BYTES or snapshot_bytes > MAX_SNAPSHOT_BYTES:
            raise HTTPException(413, 'Seria przekracza limit pamięci. Wybierz mniejszą paczkę sztuk; nic nie wysłano.')
        items.append({'unit_id': unit['id'], 'unit_snapshot': unit, 'recipe_snapshot': recipe,
                      'payload_zlib': compressed, 'payload_sha256': digest(payload)})
    return revision['id'], line_id, items, render_context


def prepare(dto: dict, actor: str) -> dict:
    # Normalize defaults before hashing, including direct service callers.
    from app.models.label_print_jobs import PrepareLabelJob
    dto = PrepareLabelJob.model_validate(dto).model_dump()
    key, printer, printer_uid = (dto.get(k) or '' for k in ('idempotency_key', 'printer_name', 'printer_uid'))
    if not 8 <= len(key) <= 128 or not printer.strip() or len(printer) > 256 or not printer_uid.strip() or len(printer_uid) > 256:
        raise HTTPException(422, 'Wymagany klucz operacji i wybrana drukarka')
    selection(dto.get('unit_ids'))
    if dto['transport'] == 'file' and printer_uid != ('file:pdf' if dto['language'] == 'a4' else 'file:zpl'):
        raise HTTPException(422, 'Eksport wymaga wyjścia plikowego zgodnego z językiem zadania')
    if (dto['language'] == 'a4' and dto['transport'] == 'browserprint') or (dto['language'] == 'zpl' and dto['transport'] == 'browser'):
        raise HTTPException(422, 'A4 nie może trafić do RAW/BrowserPrint; wybierz właściwy transport')
    if dto['transport'] == 'browser' and printer_uid != 'browser:dialog':
        raise HTTPException(422, 'Druk A4 wymaga systemowego okna druku')
    request_hash = digest(canonical(dto).encode('utf-8'))
    with transaction() as conn:
        cx_execute(conn, 'SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', (SCOPE + ':' + key,))
        existing = cx_query_one(conn, 'SELECT * FROM label_print_jobs WHERE scope_key=%s AND idempotency_key=%s FOR SHARE', (SCOPE, key))
        if existing:
            # Keys created before the A4 extension omitted these defaults.
            legacy_hash = digest(canonical({k: v for k, v in dto.items() if k not in ('language', 'org_code')}).encode('utf-8'))
            legacy_retry = dto['language'] == 'zpl' and dto['org_code'] is None and existing['request_hash'] == legacy_hash
            if existing['request_hash'] != request_hash and not legacy_retry:
                raise HTTPException(409, 'Klucz operacji był użyty z innymi parametrami')
            return _response(conn, existing)
        source_id = dto.get('source_job_id')
        if source_id:
            if not dto.get('unit_ids') or any(dto.get(k) for k in ('client_id', 'recipe_id', 'plan_line_id')) or dto.get('org_code') is not None:
                raise HTTPException(422, 'Dodruk historyczny wymaga źródłowego zadania i konkretnych sztuk, nie bieżącego szablonu')
            source = _get(conn, source_id, lock=True)
            if source['language'] != dto['language']:
                raise HTTPException(422, 'Język dodruku nie pasuje do źródłowego zadania')
            if source['state'] not in ('submitted', 'exported', 'dialog_opened', 'uncertain'):
                raise HTTPException(409, 'Źródłowe zadanie nie zostało przekazane lub nadal trwa. Najpierw wyjaśnij jego status.')
            if source['state'] == 'uncertain' and not dto.get('acknowledge_uncertain'):
                raise HTTPException(409, 'Potwierdź sprawdzenie drukarki: źródłowy wydruk ma nieznany wynik')
            revision_id, line_id = source['revision_id'], source['plan_line_id']
            render_context = source['render_context']
            items = _items(conn, source_id, dto['unit_ids'])
            for item in items:
                unpack(item)  # Integrity check before creating another audit record.
        else:
            revision_id, line_id, items, render_context = _freeze_current(conn, dto)
        job_id = cuid()
        row = cx_query_one(conn, """INSERT INTO label_print_jobs
          (id,scope_key,idempotency_key,request_hash,revision_id,source_job_id,plan_line_id,language,printer_name,printer_uid,transport,created_by,render_context)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb) RETURNING *""",
          (job_id, SCOPE, key, request_hash, revision_id, source_id, line_id, dto['language'], printer, printer_uid, dto['transport'], actor, canonical(render_context)))
        for index, item in enumerate(items):
            cx_execute(conn, """INSERT INTO label_print_job_items
              (job_id,ordinal,unit_id,unit_snapshot,recipe_snapshot,payload_zlib,payload_sha256)
              VALUES(%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s)""",
              (job_id,index,item['unit_id'],canonical(item['unit_snapshot']),canonical(item['recipe_snapshot']),item['payload_zlib'],item['payload_sha256']))
        cx_execute(conn, "INSERT INTO label_print_events(job_id,state,actor) VALUES(%s,'prepared',%s)", (job_id, actor))
        return _response(conn, row)


def transition(job_id: str, action: str, actor: str, attempt_token: str | None = None,
               printer_uid: str | None = None, acknowledge_uncertain: bool = False) -> dict:
    with transaction() as conn:
        row = _get(conn, job_id, lock=True)
        state = row['state']
        token = row.get('attempt_token')
        if action == 'begin':
            if not printer_uid or printer_uid != row['printer_uid']:
                raise HTTPException(409, 'Wybrana drukarka nie pasuje do zapisanego zadania')
            if state != 'prepared':
                raise HTTPException(409, 'Nie można ponownie wysłać tego zadania. Sprawdź drukarkę i historię.')
            target, token = 'submitting', cuid()
        elif action == 'cancel':
            if state == 'cancelled':
                return {'id': job_id, 'state': state}
            if state != 'prepared':
                raise HTTPException(409, 'Nie można cofnąć danych przekazanych do transportu')
            target = 'cancelled'
        elif action == 'recover':
            if not acknowledge_uncertain or state != 'submitting':
                raise HTTPException(409, 'Potwierdź zamknięcie poprzedniej próby i sprawdzenie drukarki')
            if datetime.now(timezone.utc) - row['updated_at'] < RECOVERY_DELAY:
                raise HTTPException(409, 'Próba może jeszcze trwać. Odczekaj 5 minut od rozpoczęcia wysyłki.')
            target = 'uncertain'
        elif action in ('submitted', 'exported', 'dialog_opened', 'uncertain'):
            if (action == 'submitted' and row['transport'] != 'browserprint') or (action == 'exported' and row['transport'] != 'file') or (action == 'dialog_opened' and row['transport'] != 'browser'):
                raise HTTPException(409, 'Potwierdzenie nie pasuje do transportu zadania')
            if not token or token != attempt_token:
                raise HTTPException(409, 'Nieprawidłowy identyfikator próby wysłania')
            if state == action:
                return {'id': job_id, 'state': state, 'attemptToken': token}
            if state != 'submitting':
                raise HTTPException(409, 'Stan zadania zmienił się; nie ponawiaj automatycznie')
            target = action
        else:
            raise HTTPException(422, 'Nieznana operacja wydruku')
        cx_execute(conn, 'UPDATE label_print_jobs SET state=%s,attempt_token=%s,updated_at=clock_timestamp() WHERE id=%s', (target, token, job_id))
        cx_execute(conn, 'INSERT INTO label_print_events(job_id,state,actor) VALUES(%s,%s,%s)', (job_id, target, actor))
        return {'id': job_id, 'state': target, 'attemptToken': token}


def unit_history(unit_id: str) -> list[dict]:
    rows = query_all("""SELECT j.id,j.state,j.printer_name,j.transport,j.language,j.created_at,j.created_by,j.revision_id,j.source_job_id
        FROM label_print_jobs j JOIN label_print_job_items i ON i.job_id=j.id
        WHERE j.scope_key=%s AND i.unit_id=%s ORDER BY j.created_at DESC,j.id LIMIT 100""", (SCOPE, unit_id))
    return [{'id': r['id'], 'state': r['state'], 'printerName': r['printer_name'],
             'createdAt': str(r['created_at']), 'createdBy': r['created_by'],
             'transport': r['transport'], 'language': r['language'],
             'revisionId': r['revision_id'], 'sourceJobId': r['source_job_id']} for r in rows]
