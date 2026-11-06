"""Real PostgreSQL: immutable payloads, revision triggers and competing sends."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
import json

import psycopg2
import pytest
from fastapi import HTTPException

from app.db import execute, query_one, query_all, transaction, cx_execute, cx_query_all
from app.label_history_schema import DDL
from app.services import label_print_jobs as jobs

ZPL = '^XA^PW799^LL1199^FO10,10^BQN,2,4^FDLA,[[QR]]^FS^FO10,120^FD[[PARTIA]] [[RECEPTURA]] [[BEST_BEFORE]]^FS^PQ99^XZ'


@pytest.fixture
def seeded(db):
    execute("INSERT INTO clients(id,code,name,display_name) VALUES('c1','C1','CLIENT','Client alias')")
    execute("INSERT INTO recipes(id,name,shelf_life_days) VALUES('r1','Original recipe',365)")
    execute("INSERT INTO label_templates(id,client_id,recipe_id,kind,zpl) VALUES('t1','CLIENT','r1','zpl',%s)", (ZPL,))
    for i in range(3):
        execute('''INSERT INTO finished_units(id,qr_code,qr_seq,plan_line_id,client_name,recipe_id,weight_kg,batch_no,produced_date)
            VALUES(%s,%s,%s,'line','CLIENT','r1',20,'151026 401','2026-10-15')''', (f'u{i}', f'U|u{i}', i))
    return {'idempotency_key': 'operation-1', 'printer_name': 'Zebra', 'printer_uid': 'usb-1',
            'plan_line_id': 'line', 'client_id': 'Client alias', 'recipe_id': 'r1'}


def start(job):
    return jobs.transition(job['id'], 'begin', 'office:operator', printer_uid=job['printerUid'])['attemptToken']


def finish(job, state='submitted'):
    return jobs.transition(job['id'], state, 'office:operator', start(job))


def historical(job, **extra):
    return {'idempotency_key': 'reprint-1', 'printer_name': 'Zebra', 'printer_uid': 'usb-1',
            'source_job_id': job['id'], 'unit_ids': ['u1'], **extra}


def test_frozen_reprint_survives_changes_and_deletion_without_creating_units(seeded):
    before = query_all('SELECT * FROM finished_units ORDER BY id')
    original = jobs.prepare(seeded, 'office:first')
    assert query_all('SELECT * FROM finished_units ORDER BY id') == before
    assert original['count'] == 3
    assert original['zpl'].count('^PQ1,0,0,Y') == 3
    assert '^PQ99' not in original['zpl']
    finish(original)
    frozen = jobs.get_job(original['id'], ['u1'])['zpl']
    execute("UPDATE label_templates SET zpl=replace(zpl,'^FO10,10','^FO25,25') WHERE id='t1'")
    execute("UPDATE recipes SET name='Changed',shelf_life_days=7 WHERE id='r1'")
    execute("UPDATE finished_units SET batch_no='NEW',produced_date='2026-10-19' WHERE id='u1'")
    new_before = query_all('SELECT * FROM finished_units ORDER BY id')
    replay = jobs.prepare(historical(original), 'office:second')
    assert replay['zpl'] == frozen
    assert '151026 401 Original recipe 15.10.2027' in replay['zpl']
    assert replay['revisionId'] == original['revisionId']
    assert replay['sourceJobId'] == original['id']
    assert query_all('SELECT * FROM finished_units ORDER BY id') == new_before
    execute("DELETE FROM label_templates WHERE id='t1'")
    execute("DELETE FROM recipes WHERE id='r1'")
    assert jobs.prepare(historical(original, idempotency_key='reprint-2'), 'office:second')['zpl'] == frozen
    history = jobs.unit_history('u1')
    assert len(history) == 3
    assert history[-1]['state'] == 'submitted'
    assert [e['state'] for e in jobs.get_job(original['id'])['events']] == ['prepared', 'submitting', 'submitted']
    item = query_one('SELECT * FROM label_print_job_items WHERE job_id=%s AND unit_id=%s', (replay['id'], 'u1'))
    assert item['unit_snapshot']['batch_no'] == '151026 401'
    assert item['recipe_snapshot']['name'] == 'Original recipe'


def test_revisions_capture_all_parameters_and_noop_saves_do_not_increment(seeded):
    precise = {'qr': {'x': 12.123456789, 'y': 9.87654321, 'size': 22}}
    execute("UPDATE label_templates SET field_positions=%s::jsonb,slot_field_positions=%s::jsonb,print_calib=%s::jsonb WHERE id='t1'",
            (json.dumps(precise), json.dumps({'1': precise}), json.dumps({'fitStretch': True, 'scale': 101.234})))
    execute("UPDATE label_templates SET updated_at=now() WHERE id='t1'")
    with transaction() as conn:
        for _ in range(2):
            for sql in DDL:
                cx_execute(conn, sql)
    rows = query_all("SELECT * FROM label_template_revisions WHERE template_id='t1' ORDER BY revision")
    assert [r['revision'] for r in rows] == [1, 2]
    assert rows[1]['document']['field_positions'] == precise
    assert rows[1]['document']['slot_field_positions'] == {'1': precise}
    assert rows[1]['document']['print_calib']['scale'] == 101.234
    execute("DELETE FROM label_templates WHERE id='t1'")
    assert query_one("SELECT operation FROM label_template_revisions WHERE template_id='t1' ORDER BY revision DESC LIMIT 1")['operation'] == 'delete'


def test_additive_upgrade_preserves_legacy_a4_before_first_edit(db):
    # A transaction-local schema models pre-existing installations, not only
    # rows inserted after the capture triggers were installed. Roll it back.
    with transaction() as conn:
        cx_execute(conn, 'CREATE SCHEMA label_history_legacy_test')
        cx_execute(conn, 'SET LOCAL search_path TO label_history_legacy_test')
        for table in ('label_templates', 'zebra_label_designs'):
            cx_execute(conn, f'CREATE TABLE {table} (LIKE public.{table} INCLUDING ALL)')
        cx_execute(conn, '''INSERT INTO label_templates(id,kind,background_pdf,field_positions,slot_offsets,print_calib)
            VALUES('legacy','overlay','original-pdf','{"qr":{"x":12.123456789}}',
                   '[{"dx":0.000001}]','{"fit":true,"fitStretch":true,"scale":98.12345}')''')
        for _ in range(2):
            for sql in DDL:
                cx_execute(conn, sql)
        cx_execute(conn, "UPDATE label_templates SET background_pdf='new-pdf' WHERE id='legacy'")
        rows = cx_query_all(conn, 'SELECT * FROM label_template_revisions ORDER BY revision')
        assert [(r['revision'], r['operation']) for r in rows] == [(1, 'baseline'), (2, 'update')]
        assert rows[0]['document']['background_pdf'] == 'original-pdf'
        assert rows[0]['document']['field_positions']['qr']['x'] == 12.123456789
        assert rows[0]['document']['slot_offsets'] == [{'dx': 0.000001}]
        assert rows[0]['document']['print_calib'] == {'fit': True, 'fitStretch': True, 'scale': 98.12345}
        conn.rollback()


def test_parallel_template_edits_allocate_distinct_ordered_revisions(seeded):
    barrier = Barrier(2)
    def save(marker):
        barrier.wait(timeout=10)
        execute("UPDATE label_templates SET background_data=background_data || %s WHERE id='t1'", (marker,))
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(save, ['first', 'second']))
    rows = query_all("SELECT * FROM label_template_revisions WHERE template_id='t1' ORDER BY revision")
    assert [r['revision'] for r in rows] == [1, 2, 3]
    assert 'first' in rows[-1]['document']['background_data'] and 'second' in rows[-1]['document']['background_data']


def test_designer_revision_is_used_and_invalid_designer_never_falls_back(seeded):
    execute('''INSERT INTO zebra_label_designs(id,client_id,recipe_id,elements)
        VALUES('d1','CLIENT','r1',%s::jsonb)''', (json.dumps([{'type': 'qr', 'x': 1, 'y': 2, 'value': '[[QR]]'}]),))
    result = jobs.prepare(seeded, 'office:one')
    assert query_one('SELECT source FROM label_template_revisions WHERE id=%s', (result['revisionId'],))['source'] == 'zebra_label_designs'
    execute("UPDATE zebra_label_designs SET elements='[]'::jsonb WHERE id='d1'")
    with pytest.raises(HTTPException, match='dynamicznego QR'):
        jobs.prepare({**seeded, 'idempotency_key': 'operation-bad'}, 'office:one')
    assert query_one('SELECT count(*) AS n FROM label_print_jobs')['n'] == 1


@pytest.mark.parametrize('seed_fixture', ['seeded', 'a4_seeded'])
def test_parallel_prepare_and_parallel_begin_have_exactly_one_winner(request, seed_fixture):
    seeded = request.getfixturevalue(seed_fixture)
    barrier = Barrier(2)
    def prepare():
        barrier.wait(timeout=10)
        return jobs.prepare(seeded, 'office:one')
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: prepare(), range(2)))
    assert results[0]['id'] == results[1]['id']
    assert query_one('SELECT count(*) AS n FROM label_print_job_items')['n'] == 3
    barrier = Barrier(2)
    def begin():
        barrier.wait(timeout=10)
        try:
            return start(results[0])
        except HTTPException as error:
            assert error.status_code == 409
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        attempts = list(pool.map(lambda _: begin(), range(2)))
    assert sum(bool(token) for token in attempts) == 1
    assert [e['state'] for e in jobs.get_job(results[0]['id'])['events']] == ['prepared', 'submitting']


def test_recovery_never_rewinds_or_auto_retries(seeded, monkeypatch):
    original = jobs.prepare(seeded, 'office:one')
    token = start(original)
    with pytest.raises(HTTPException):
        jobs.transition(original['id'], 'recover', 'office:two', acknowledge_uncertain=True)
    with pytest.raises(HTTPException):
        jobs.transition(original['id'], 'submitted', 'office:two', 'wrong-token')
    monkeypatch.setattr(jobs, 'RECOVERY_DELAY', timedelta(0))
    with pytest.raises(HTTPException):
        jobs.transition(original['id'], 'recover', 'office:two')
    jobs.transition(original['id'], 'recover', 'office:two', acknowledge_uncertain=True)
    with pytest.raises(HTTPException):
        jobs.transition(original['id'], 'submitted', 'office:one', token)
    with pytest.raises(HTTPException):
        start(original)
    with pytest.raises(HTTPException):
        jobs.prepare(historical(original), 'office:two')
    assert jobs.prepare(historical(original, acknowledge_uncertain=True), 'office:two')['state'] == 'prepared'


def test_cancellation_export_and_device_binding_are_truthful(seeded):
    job = jobs.prepare(seeded, 'office:one')
    with pytest.raises(HTTPException):
        jobs.transition(job['id'], 'begin', 'office:one', printer_uid='usb-other')
    jobs.transition(job['id'], 'cancel', 'office:one')
    jobs.transition(job['id'], 'cancel', 'office:one')
    with pytest.raises(HTTPException):
        start(job)
    with pytest.raises(HTTPException):
        jobs.prepare(historical(job), 'office:one')
    export = jobs.prepare({**seeded, 'idempotency_key': 'export-1', 'transport': 'file', 'printer_uid': 'file:zpl'}, 'office:one')
    token = start(export)
    with pytest.raises(HTTPException):
        jobs.transition(export['id'], 'submitted', 'office:one', token)
    jobs.transition(export['id'], 'exported', 'office:one', token)
    jobs.transition(export['id'], 'exported', 'office:one', token)
    assert jobs.get_job(export['id'])['state'] == 'exported'
    assert len(jobs.get_job(export['id'])['events']) == 3


@pytest.mark.parametrize('change', [
    {'client_id': 'OTHER'}, {'recipe_id': 'wrong'}, {'unit_ids': []}, {'unit_ids': ['u0', 'u0']},
    {'unit_ids': ['foreign']}, {'unit_ids': ['u0', 'foreign']}, {'unit_ids': [' u0']},
])
def test_invalid_binding_and_selection_write_nothing(seeded, change):
    with pytest.raises(HTTPException):
        jobs.prepare({**seeded, **change}, 'office:one')
    assert query_one('SELECT count(*) AS n FROM label_print_jobs')['n'] == 0


def test_idempotency_conflict_and_key_recovery(seeded):
    job = jobs.prepare(seeded, 'office:one')
    assert jobs.find_by_key(seeded['idempotency_key'])['id'] == job['id']
    assert jobs.find_by_key('not-present') is None
    with pytest.raises(HTTPException):
        jobs.prepare({**seeded, 'unit_ids': ['u1']}, 'office:one')
    assert jobs.prepare(seeded, 'office:one')['id'] == job['id']


def test_ambiguous_template_alias_is_not_picked_arbitrarily(seeded):
    execute("INSERT INTO label_templates(id,client_id,recipe_id,kind,zpl) VALUES('t2','Client alias','r1','zpl',%s)", (ZPL,))
    with pytest.raises(HTTPException) as error:
        jobs.prepare(seeded, 'office:one')
    assert error.value.status_code == 409
    assert query_one('SELECT count(*) AS n FROM label_print_jobs')['n'] == 0


def test_selected_unit_after_first_thousand_is_not_lost_to_query_limit(seeded):
    execute('''INSERT INTO finished_units(id,qr_code,qr_seq,plan_line_id,client_name,recipe_id)
        SELECT 'extra-' || n, 'U|extra-' || n, n+10, 'line','CLIENT','r1' FROM generate_series(1,1001) n''')
    with pytest.raises(HTTPException):
        jobs.prepare(seeded, 'office:one')
    selected = jobs.prepare({**seeded, 'unit_ids': ['extra-1001']}, 'office:one')
    assert selected['unitIds'] == ['extra-1001']
    assert selected['count'] == 1


@pytest.mark.parametrize('limit', ['MAX_JOB_BYTES', 'MAX_LABEL_BYTES', 'MAX_STORED_BYTES', 'MAX_SNAPSHOT_BYTES'])
def test_memory_limits_rollback_the_entire_job(seeded, monkeypatch, limit):
    monkeypatch.setattr(jobs, limit, 10)
    with pytest.raises(HTTPException) as error:
        jobs.prepare(seeded, 'office:one')
    assert error.value.status_code == 413
    assert query_one('SELECT count(*) AS n FROM label_print_jobs')['n'] == 0


@pytest.mark.parametrize('sql', [
    "UPDATE label_template_revisions SET document='{}'::jsonb",
    'DELETE FROM label_template_revisions',
    "UPDATE label_print_job_items SET unit_snapshot='{}'::jsonb",
    'DELETE FROM label_print_job_items', 'DELETE FROM label_print_events',
    "UPDATE label_print_events SET actor='changed'", 'DELETE FROM label_print_jobs',
    "UPDATE label_print_jobs SET printer_uid='other'", "UPDATE label_print_jobs SET state='submitted'",
])
def test_history_is_append_only_even_for_direct_sql(seeded, sql):
    jobs.prepare(seeded, 'office:one')
    with pytest.raises(psycopg2.Error):
        execute(sql)


@pytest.fixture
def a4_seeded(seeded):
    execute("UPDATE clients SET halal_supervision=true WHERE id='c1'")
    execute("UPDATE finished_units SET batch_no='401'")
    execute('''UPDATE label_templates SET kind='overlay',labels_per_sheet=2,zpl='',
        background_pdf='data:application/pdf;base64,JVBERi0xLjc=',
        field_positions='{"qr":{"x":12.123456789,"y":19.987654321,"size":35},"weight":{"x":20,"y":30,"size":22}}',
        slot_offsets='[{"dx":0,"dy":0},{"dx":47.123456789,"dy":1.111111111}]',
        slot_field_positions='{"1":{"qr":{"x":60.123456789,"y":70.987654321,"size":40}}}',
        print_calib='{"fit":true,"fitStretch":true,"dxMm":1.23,"dyMm":-0.45,"scale":98.7654321}'
        WHERE id='t1' ''')
    return {**seeded, 'language': 'a4', 'transport': 'browser', 'printer_uid': 'browser:dialog', 'org_code': 'HALAL-001'}


def test_a4_replay_keeps_original_slots_halal_dates_and_template_without_live_lookups(a4_seeded):
    before = query_all('SELECT * FROM finished_units ORDER BY id')
    original = jobs.prepare(a4_seeded, 'office:original')
    assert original['language'] == 'a4' and 'zpl' not in original
    assert original['a4']['placements'] == [{'sheet': 0, 'slot': 0}, {'sheet': 0, 'slot': 1}, {'sheet': 1, 'slot': 0}]
    assert query_all('SELECT * FROM finished_units ORDER BY id') == before
    finish(original, 'dialog_opened')
    frozen = jobs.get_job(original['id'], ['u1'])['a4']
    execute("UPDATE finished_units SET produced_date='2026-10-20',batch_no='CHANGED',weight_kg=30 WHERE id='u1'")
    execute("DELETE FROM label_templates WHERE id='t1'")
    execute("DELETE FROM recipes WHERE id='r1'")
    execute("DELETE FROM clients WHERE id='c1'")
    changed = query_all('SELECT * FROM finished_units ORDER BY id')
    replay = jobs.prepare({**historical(original), 'language': 'a4', 'transport': 'browser', 'printer_uid': 'browser:dialog'}, 'office:reprint')
    assert replay['a4'] == frozen
    assert replay['a4']['orgCode'] == 'HALAL-001'
    assert replay['a4']['shelfLifeDays'] == 365
    assert replay['a4']['placements'] == [{'sheet': 0, 'slot': 1}]
    assert replay['a4']['units'][0]['qrCode'] == 'U|u1'
    assert replay['a4']['units'][0]['producedDate'] == '2026-10-15'
    assert replay['a4']['template']['printCalib']['scale'] == 98.7654321
    assert replay['a4']['template']['slotFieldPositions']['1']['qr']['x'] == 60.123456789
    assert replay['revisionId'] == original['revisionId']
    assert query_all('SELECT * FROM finished_units ORDER BY id') == changed
    assert jobs.unit_history('u1')[-1]['language'] == 'a4'


@pytest.mark.parametrize('change', [
    {'org_code': ''}, {'org_code': '\n'}, {'transport': 'browserprint'}, {'printer_uid': 'usb-1'},
    {'transport': 'file', 'printer_uid': 'file:zpl'}, {'unit_ids': []}, {'unit_ids': ['foreign']},
])
def test_a4_invalid_input_never_creates_a_job(a4_seeded, change):
    with pytest.raises(HTTPException):
        jobs.prepare({**a4_seeded, **change}, 'office:one')
    assert query_one('SELECT count(*) AS n FROM label_print_jobs')['n'] == 0


def test_a4_missing_date_never_uses_current_day(a4_seeded):
    execute("UPDATE finished_units SET produced_date='' WHERE id='u1'")
    with pytest.raises(HTTPException, match='daty produkcji'):
        jobs.prepare(a4_seeded, 'office:one')


def test_a4_requires_qr_in_every_occupied_slot(a4_seeded):
    execute("UPDATE label_templates SET field_positions='{}' WHERE id='t1'")
    with pytest.raises(HTTPException, match='Slot 1'):
        jobs.prepare(a4_seeded, 'office:one')


def test_a4_export_and_dialog_are_distinct_from_raw_print_acknowledgement(a4_seeded):
    original = jobs.prepare(a4_seeded, 'office:one')
    token = start(original)
    with pytest.raises(HTTPException):
        jobs.transition(original['id'], 'submitted', 'office:one', token)
    jobs.transition(original['id'], 'dialog_opened', 'office:one', token)
    replay = historical(original, language='a4', transport='file', printer_uid='file:pdf')
    exported = jobs.prepare(replay, 'office:two')
    finish(exported, 'exported')
    assert jobs.get_job(exported['id'])['state'] == 'exported'
    with pytest.raises(HTTPException):
        jobs.prepare(historical(original, idempotency_key='wrong-language'), 'office:two')
    with pytest.raises(HTTPException):
        jobs.prepare({**replay, 'idempotency_key': 'tamper-org', 'org_code': 'REPLACED'}, 'office:two')


def test_a4_snapshot_context_is_immutable_and_limits_rollback(a4_seeded, monkeypatch):
    from app.services import label_a4_snapshot as a4
    original = jobs.prepare(a4_seeded, 'office:one')
    with pytest.raises(psycopg2.Error):
        execute("UPDATE label_print_jobs SET render_context='{}' WHERE id=%s", (original['id'],))
    monkeypatch.setattr(a4, 'MAX_A4_UNITS', 2)
    with pytest.raises(HTTPException) as error:
        jobs.prepare({**a4_seeded, 'idempotency_key': 'too-large'}, 'office:one')
    assert error.value.status_code == 413
    assert query_one('SELECT count(*) AS n FROM label_print_jobs')['n'] == 1


def test_zpl_pre_a4_idempotency_keys_remain_valid(seeded):
    from app.models.label_print_jobs import PrepareLabelJob
    first = jobs.prepare(seeded, 'office:one')
    request = PrepareLabelJob.model_validate({**seeded, 'idempotency_key': 'legacy-key'}).model_dump()
    old_hash = jobs.digest(jobs.canonical({k: v for k, v in request.items() if k not in ('language', 'org_code')}).encode())
    execute('''INSERT INTO label_print_jobs(id,scope_key,idempotency_key,request_hash,revision_id,plan_line_id,language,printer_name,printer_uid,transport,created_by)
        SELECT 'legacy-job',scope_key,'legacy-key',%s,revision_id,plan_line_id,language,printer_name,printer_uid,transport,created_by
        FROM label_print_jobs WHERE id=%s''', (old_hash, first['id']))
    execute('''INSERT INTO label_print_job_items
        SELECT 'legacy-job',ordinal,unit_id,unit_snapshot,recipe_snapshot,payload_zlib,payload_sha256
        FROM label_print_job_items WHERE job_id=%s''', (first['id'],))
    assert jobs.prepare({**seeded, 'idempotency_key': 'legacy-key'}, 'office:one')['id'] == 'legacy-job'


def test_image_only_a4_cannot_be_exported_as_pdf_even_via_history(a4_seeded):
    execute("UPDATE label_templates SET background_pdf='' WHERE id='t1'")
    with pytest.raises(HTTPException, match='Eksport PDF'):
        jobs.prepare({**a4_seeded, 'transport': 'file', 'printer_uid': 'file:pdf'}, 'office:one')
    assert query_one('SELECT count(*) AS n FROM label_print_jobs')['n'] == 0
    original = jobs.prepare(a4_seeded, 'office:one')
    finish(original, 'dialog_opened')
    with pytest.raises(HTTPException, match='Eksport PDF'):
        jobs.prepare(historical(original, language='a4', transport='file', printer_uid='file:pdf'), 'office:two')
    assert query_one('SELECT count(*) AS n FROM label_print_jobs')['n'] == 1


@pytest.mark.parametrize('sql', [
    "UPDATE label_templates SET slot_field_positions='[]'::jsonb || '[1]'::jsonb",
    "UPDATE label_templates SET slot_field_positions='{\"1\":{\"qr\":{}}}'",
    "UPDATE label_templates SET print_calib='{\"scale\":0}'",
    "UPDATE label_templates SET print_calib='{\"dxMm\":\"1\"}'",
    "UPDATE label_templates SET slot_offsets='[{\"dx\":0}]'",
    "UPDATE label_templates SET background_data='https://example.invalid/background.png'",
    "UPDATE label_templates SET background_data='data:image/svg+xml,<svg/>'",
    "UPDATE label_templates SET labels_per_sheet=0",
    "UPDATE recipes SET shelf_life_days=-1",
    "DELETE FROM clients WHERE id='c1'",
])
def test_invalid_a4_inputs_fail_closed_before_saving(a4_seeded, sql):
    execute(sql)
    with pytest.raises(HTTPException) as error:
        jobs.prepare(a4_seeded, 'office:one')
    assert error.value.status_code == 422
    assert query_one('SELECT count(*) AS n FROM label_print_jobs')['n'] == 0


def test_a4_image_asset_limit_is_enforced_before_saving(a4_seeded, monkeypatch):
    from app.services import label_a4_snapshot as a4
    monkeypatch.setattr(a4, 'MAX_TEMPLATE_BYTES', 10)
    with pytest.raises(HTTPException) as error:
        jobs.prepare(a4_seeded, 'office:one')
    assert error.value.status_code == 413
    assert query_one('SELECT count(*) AS n FROM label_print_jobs')['n'] == 0


def test_a4_upgrade_preserves_existing_zpl_jobs_and_can_be_repeated(db):
    # Simulate the previous ZPL-only registry inside a transaction-local schema.
    # No public tables, real jobs or deployment schema are altered.
    with transaction() as conn:
        cx_execute(conn, 'CREATE SCHEMA label_history_zpl_upgrade_test')
        cx_execute(conn, 'SET LOCAL search_path TO label_history_zpl_upgrade_test')
        for table in ('label_templates', 'zebra_label_designs'):
            cx_execute(conn, f'CREATE TABLE {table} (LIKE public.{table} INCLUDING ALL)')
        cx_execute(conn, "INSERT INTO label_templates(id,kind) VALUES('legacy','zpl')")
        for sql in DDL:
            if 'CREATE TABLE IF NOT EXISTS label_print_jobs (' in sql:
                old = sql.replace("('zpl','a4')", "('zpl')").replace("('browserprint','file','browser')", "('browserprint','file')")
                old = old.replace(",'dialog_opened'", '').replace("        render_context JSONB NOT NULL DEFAULT '{}',\n", '')
                cx_execute(conn, old)
                break
            cx_execute(conn, sql)
        cx_execute(conn, '''INSERT INTO label_print_jobs(id,scope_key,idempotency_key,request_hash,revision_id,
            plan_line_id,language,printer_name,printer_uid,transport,created_by,state,attempt_token)
            SELECT 'old-job','legacy-single-company','old-operation','hash',id,'line','zpl','Zebra','usb',
            'browserprint','office:legacy','submitted','old-attempt' FROM label_template_revisions LIMIT 1''')
        before = cx_query_all(conn, 'SELECT * FROM label_print_jobs')
        for _ in range(2):
            for sql in DDL:
                cx_execute(conn, sql)
        assert cx_query_all(conn, 'SELECT * FROM label_print_jobs') == [{**before[0], 'render_context': {}}]
        cx_execute(conn, '''INSERT INTO label_print_jobs(id,scope_key,idempotency_key,request_hash,revision_id,
            plan_line_id,language,printer_name,printer_uid,transport,created_by)
            SELECT 'new-a4','legacy-single-company','new-operation','hash',id,'line','a4','Dialog','browser:dialog',
            'browser','office:new' FROM label_template_revisions LIMIT 1''')
        cx_execute(conn, "UPDATE label_print_jobs SET state='submitting',attempt_token='new-attempt' WHERE id='new-a4'")
        cx_execute(conn, "UPDATE label_print_jobs SET state='dialog_opened' WHERE id='new-a4'")
        assert cx_query_all(conn, "SELECT state FROM label_print_jobs WHERE id='new-a4'")[0]['state'] == 'dialog_opened'
        conn.rollback()
