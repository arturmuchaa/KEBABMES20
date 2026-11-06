"""Real PostgreSQL: workflow, stock ledger, idempotency, restart and legacy guards."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.db import execute, query_one, query_all
from app.models.deboning import DeboningTakeCreate, DeboningTakeComplete, DeboningEntryUpdate
from app.models.deboning_settlement import SettlementWeighing, SettlementAdvance
from app.services import take_settlement_service as svc
from app.services import deboning_service as deb
from app.services import batch_byproducts_service as bp


def seed(kg=300):
    execute("""INSERT INTO raw_batches (id,internal_batch_no,internal_batch_seq,supplier_name,
        kg_received,kg_available,status,material_type_id,material_name)
        VALUES ('settle-batch','901',901,'Test',%s,%s,'active','mat-cwiartka','Ćwiartka')""", (kg, kg))


def take(worker='w1', per_worker=True, kg=300, **kw):
    return deb.create_deboning_take(DeboningTakeCreate(
        rawBatchId='settle-batch', workerId=worker, workerName=worker,
        kgTaken=kg, perWorker=per_worker, **kw))['id']


def dto(kind, kg, **kw):
    return SettlementWeighing(**{
        'requestId': str(uuid4()), 'kind': kind, 'kgNet': kg,
        'weighMode': 'auto', 'kgGross': kg + 16, 'tareCartKg': 6,
        'tareE2Kg': 10, 'e2Count': 5, **kw,
    })


def weigh(entry, kind, kg):
    return svc.weigh(entry, dto(kind, kg), 'operator')


def advance(entry, kind):
    return svc.advance(entry, SettlementAdvance(stage=kind), 'operator')


def ready(entry, bones=44):
    weigh(entry, 'meat', 200)
    advance(entry, 'meat')
    weigh(entry, 'backs', 55)
    advance(entry, 'backs')
    weigh(entry, 'bones', bones)
    return advance(entry, 'bones')


def test_complete_flow_preserves_real_weights_and_does_not_invent_loss_stock(db):
    seed(); entry = take()
    state = svc.start(entry)
    assert state['stage'] == 'meat' and state['mode'] == 'worker'
    assert state['kgTaken'] == 300
    ready(entry)
    assert query_one('SELECT status FROM deboning_entries WHERE id=%s', (entry,))['status'] == 'pending'
    result = svc.finish(entry, 'operator')
    assert result['stage'] == 'done'
    assert result['totalKg'] == 299 and result['differenceKg'] == -1
    assert float(query_one("SELECT kg_available FROM meat_stock WHERE lot_no='901'")['kg_available']) == 200
    lots = query_all('SELECT kind,kg,containers_available,deboning_entry_id FROM byproduct_lots ORDER BY kind')
    assert [(r['kind'], float(r['kg'])) for r in lots] == [('backs', 55), ('bones', 44)]
    assert all(r['deboning_entry_id'] == entry and r['containers_available'] == 5 for r in lots)
    assert float(query_one("SELECT SUM(qty) AS kg FROM stock_movements WHERE product_type='byproduct'")['kg']) == 99
    assert bp.get('settle-batch')['backsKg'] == 55
    assert bp.pending() == []  # no invitation to weigh the same bones collectively
    day = date.today().isoformat()
    stats = deb.deboning_stats(day, day)
    assert stats['summary']['kgBacks'] == 55
    assert stats['summary']['kgBones'] == 44
    assert len(bp.list_weighings(day, day)['data']) == 2
    assert bp.today_totals()['bonesKg'] == 44
    assert bp.list_weighings(day, day)['data'][0]['workerName'] == 'w1'
    from app.services.cost_service import get_averages
    costs = get_averages('all')
    assert costs['backsPct'] == 18.33
    assert costs['bonesPct'] == 14.67


@pytest.mark.parametrize('bones,accepted', [(43.5, True), (49.5, True), (43.49, False), (49.51, False)])
def test_finish_enforces_tolerance_on_server(db, bones, accepted):
    seed(); entry = take(); ready(entry, bones)
    if accepted:
        assert svc.finish(entry)['status'] == 'complete'
    else:
        with pytest.raises(HTTPException, match=r'\+1.5% / −0.5%'):
            svc.finish(entry)
        assert svc.get(entry)['stage'] == 'balance'
        assert not query_all('SELECT * FROM byproduct_lots')


def test_each_step_required_and_resume_does_not_close_on_meat(db):
    seed(); entry = take()
    with pytest.raises(HTTPException): advance(entry, 'meat')
    with pytest.raises(HTTPException): weigh(entry, 'bones', 44)
    weigh(entry, 'meat', 100); weigh(entry, 'meat', 100)
    advance(entry, 'meat')
    restarted = svc.start(entry)
    assert restarted['stage'] == 'backs' and restarted['meatKg'] == 200
    assert len(restarted['weighings']) == 2
    with pytest.raises(HTTPException): svc.finish(entry)
    with pytest.raises(HTTPException): advance(entry, 'bones')


def test_retry_of_same_measurement_and_finish_never_doubles_stock(db):
    seed(); entry = take()
    measurement = dto('meat', 200)
    svc.weigh(entry, measurement); svc.weigh(entry, measurement)
    assert svc.get(entry)['meatKg'] == 200
    advance(entry, 'meat'); weigh(entry, 'backs', 55); advance(entry, 'backs')
    weigh(entry, 'bones', 44); advance(entry, 'bones')
    svc.finish(entry); svc.finish(entry)
    assert len(query_all('SELECT * FROM byproduct_lots')) == 2
    assert len(query_all("SELECT * FROM stock_movements WHERE product_type='meat'")) == 1
    # Retry after completion is safe as well.
    assert svc.weigh(entry, measurement)['status'] == 'complete'
    changed = measurement.model_copy(update={'kg_net': 201})
    with pytest.raises(HTTPException): svc.weigh(entry, changed)


def test_parallel_retry_uses_single_receipt(db):
    seed(); entry = take(); measurement = dto('meat', 100)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: svc.weigh(entry, measurement), range(2)))
    assert all(s['meatKg'] == 100 for s in results)
    assert len(query_all('SELECT * FROM deboning_take_weighings')) == 1


def test_two_workers_same_batch_sum_once(db):
    seed(600); one = take(); two = take('w2')
    ready(one); svc.finish(one)
    ready(two, 45); svc.finish(two)
    rec = bp.get('settle-batch')
    assert rec['backsKg'] == 110 and rec['bonesKg'] == 89
    assert rec['quarterKg'] == 600
    assert len(rec['backsPallets']) == 2
    assert {p['workerId'] for p in rec['backsPallets']} == {'w1', 'w2'}


def test_legacy_routes_cannot_bypass_settlement(db):
    seed(); entry = take(); weigh(entry, 'meat', 200)
    actions = [
        lambda: deb.complete_deboning_take(entry, DeboningTakeComplete(kgMeat=200)),
        lambda: deb.weigh_part_deboning_take(entry, DeboningTakeComplete(kgMeat=1)),
        lambda: deb.update_deboning_entry(entry, DeboningEntryUpdate(kgMeat=200)),
        lambda: deb.correct_deboning_entry(entry, worker_id=None, kg_quarter=None, kg_meat=200, reason='test correction'),
        lambda: deb.delete_deboning_entry(entry),
        lambda: bp.record('settle-batch', 'backs', 50, []),
    ]
    for action in actions:
        with pytest.raises(HTTPException) as err: action()
        assert err.value.status_code == 409


def test_old_batch_keeps_legacy_mode_without_rewriting_history(db):
    seed(600); old = take(per_worker=False)
    deb.complete_deboning_take(old, DeboningTakeComplete(kgMeat=200))
    new = take('w2')
    assert svc.start(new)['mode'] == 'legacy'
    assert query_one('SELECT settlement_stage FROM deboning_entries WHERE id=%s', (new,))['settlement_stage'] is None
    assert query_one('SELECT settlement_stage FROM deboning_entries WHERE id=%s', (old,))['settlement_stage'] is None


def test_legacy_partial_meat_can_resume_without_receiving_twice(db):
    seed(); entry = take(per_worker=False)
    deb.weigh_part_deboning_take(entry, DeboningTakeComplete(kgMeat=100))
    assert svc.start(entry)['meatKg'] == 100
    weigh(entry, 'meat', 100); advance(entry, 'meat')
    weigh(entry, 'backs', 55); advance(entry, 'backs')
    weigh(entry, 'bones', 45); advance(entry, 'bones'); svc.finish(entry)
    assert float(query_one("SELECT kg_available FROM meat_stock WHERE lot_no='901'")['kg_available']) == 200


def test_correction_preserves_audit_updates_ledger_and_requires_reconfirming(db):
    seed(); entry = take(); ready(entry)
    measurement = svc.get(entry)['weighings'][0]
    correction = dto('meat', 199.5, reason='Poprawiona tara')
    state = svc.correct(entry, measurement['id'], correction, 'operator')
    assert state['stage'] == 'meat' and state['meatKg'] == 199.5
    svc.correct(entry, measurement['id'], correction, 'operator')
    assert float(query_one("SELECT kg_available FROM meat_stock WHERE lot_no='901'")['kg_available']) == 199.5
    assert float(query_one("SELECT SUM(qty) AS kg FROM stock_movements WHERE product_type='meat'")['kg']) == 199.5
    history = query_one('SELECT corrections FROM deboning_settlement_weighings WHERE id=%s', (measurement['id'],))['corrections']
    assert len(history) == 1 and history[0]['before']['kg_net'] == '200.0'
    with pytest.raises(HTTPException): svc.finish(entry)
    advance(entry, 'meat'); advance(entry, 'backs'); advance(entry, 'bones')
    assert svc.finish(entry)['totalKg'] == 298.5


def test_correction_never_steals_consumed_meat(db):
    seed(); entry = take(); state = weigh(entry, 'meat', 200)
    execute("UPDATE meat_stock SET kg_available=0 WHERE lot_no='901'")
    with pytest.raises(HTTPException, match='zużyte'):
        svc.correct(entry, state['weighings'][0]['id'], dto('meat', 199, reason='Test tary'))
    assert svc.get(entry)['meatKg'] == 200


def test_yield_guard_stays_independent_of_total_mass(db):
    seed(); entry = take(); weigh(entry, 'meat', 100)
    with pytest.raises(HTTPException): advance(entry, 'meat')
    svc.advance(entry, SettlementAdvance(stage='meat', overrideYield=True), 'operator')
    assert query_one('SELECT COUNT(*) AS n FROM deboning_entry_corrections WHERE entry_id=%s', (entry,))['n'] == 1


# ── Wyjątek kierownika: bilans poza tolerancją, kod + powód, ślad ──────────
def out_of_tolerance(entry):
    svc.start(entry)
    return ready(entry, bones=30)          # 200 + 55 + 30 = 285 of 300: -15 kg, tolerance ±3 kg


def test_out_of_tolerance_needs_manager_code_and_reason_and_leaves_trace(db, monkeypatch):
    monkeypatch.setenv('KIOSK_SERVICE_CODE', '4321')
    seed(); entry = take()
    out_of_tolerance(entry)
    with pytest.raises(HTTPException) as e:
        svc.finish(entry, 'operator')
    assert e.value.status_code == 400 and 'kodu kierownika' in e.value.detail
    with pytest.raises(HTTPException) as e:
        svc.finish(entry, 'operator', exception_code='0000', exception_reason='Mięso upadło')
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        svc.finish(entry, 'operator', exception_code='4321', exception_reason=' ')
    assert e.value.status_code == 400
    assert query_one('SELECT status, settlement_stage FROM deboning_entries WHERE id=%s', (entry,)) == {
        'status': 'pending', 'settlement_stage': 'balance'}
    result = svc.finish(entry, 'MARCIN', exception_code='4321', exception_reason='Mięso upadło / odpad')
    assert result['status'] == 'complete' and result['stage'] == 'done'
    exc = result['settlementException']
    assert exc['reason'] == 'Mięso upadło / odpad' and exc['by'] == 'MARCIN'
    assert exc['differenceKg'] == -15 and exc['toleranceKg'] == 1.5
    trail = query_one("SELECT reason, changes FROM deboning_entry_corrections WHERE entry_id=%s", (entry,))
    assert 'poza tolerancją' in trail['reason'] and trail['changes']['differenceKg'] == -15
    # Real weights only: no kilograms are invented to hide the loss.
    lots = {r['kind']: float(r['kg']) for r in query_all('SELECT kind, kg FROM byproduct_lots WHERE deboning_entry_id=%s', (entry,))}
    assert lots == {'backs': 55, 'bones': 30}
    assert svc.finish(entry, 'MARCIN', exception_code='4321', exception_reason='Mięso upadło / odpad')['status'] == 'complete'


def test_within_tolerance_ignores_exception_fields(db, monkeypatch):
    monkeypatch.setenv('KIOSK_SERVICE_CODE', '4321')
    seed(); entry = take()
    svc.start(entry); ready(entry)
    result = svc.finish(entry, 'operator', exception_code='0000', exception_reason='niepotrzebny')
    assert result['status'] == 'complete' and result['settlementException'] is None


def _ledger_ok():
    """Raw stock and meat/byproduct stock must equal the movement ledger after an undo."""
    raw = float(query_one("SELECT kg_available FROM raw_batches WHERE id='settle-batch'")['kg_available'])
    raw_moves = float(query_one("SELECT COALESCE(SUM(qty),0) AS kg FROM stock_movements WHERE product_type='raw'")['kg'])
    assert raw_moves == raw - 300
    meat = float(query_one("SELECT COALESCE(SUM(kg_available),0) AS kg FROM meat_stock")['kg'])
    assert float(query_one("SELECT COALESCE(SUM(qty),0) AS kg FROM stock_movements WHERE product_type='meat'")['kg']) == meat
    abp = float(query_one("SELECT COALESCE(SUM(kg),0) AS kg FROM byproduct_lots")['kg'])
    assert float(query_one("SELECT COALESCE(SUM(qty),0) AS kg FROM stock_movements WHERE product_type='byproduct'")['kg']) == abp


def test_open_take_with_meat_is_deleted_from_the_hall_only_with_service_code(db, monkeypatch):
    monkeypatch.setenv('KIOSK_SERVICE_CODE', '4321')
    seed(); entry = take(kg=120); svc.start(entry); weigh(entry, 'meat', 80)
    with pytest.raises(HTTPException) as err: deb.delete_deboning_entry(entry, hall_correction=True, by_subject='MARCIN')
    assert err.value.status_code == 400
    with pytest.raises(HTTPException) as err:
        deb.delete_deboning_entry(entry, hall_correction=True, by_subject='MARCIN', service_code='1111')
    assert err.value.status_code == 403
    assert float(query_one("SELECT kg_available FROM meat_stock WHERE lot_no='901'")['kg_available']) == 80
    deb.delete_deboning_entry(entry, hall_correction=True, by_subject='MARCIN', service_code='4321')
    assert query_one('SELECT id FROM deboning_entries WHERE id=%s', (entry,)) is None
    assert float(query_one("SELECT kg_available FROM raw_batches WHERE id='settle-batch'")['kg_available']) == 300
    assert query_one("SELECT id FROM meat_stock WHERE lot_no='901'") is None
    assert query_one('SELECT id FROM deboning_settlement_weighings WHERE entry_id=%s', (entry,)) is None
    trace = query_one('SELECT by_subject, changes FROM deboning_entry_corrections WHERE entry_id=%s', (entry,))
    assert trace['by_subject'] == 'MARCIN'
    assert trace['changes']['usuniety']['kgQuarter'] == 120 and trace['changes']['usuniety']['kgMeat'] == 80
    assert len(trace['changes']['usuniety']['weighings']) == 1
    _ledger_ok()


def test_settled_take_with_correction_is_fully_reversed(db, monkeypatch):
    monkeypatch.setenv('KIOSK_SERVICE_CODE', '4321')
    seed(); other = take('w2', kg=100); svc.start(other)
    weigh(other, 'meat', 66); advance(other, 'meat'); weigh(other, 'backs', 18); advance(other, 'backs')
    weigh(other, 'bones', 16); advance(other, 'bones'); svc.finish(other)
    entry = take(kg=200); svc.start(entry)
    first = weigh(entry, 'meat', 130)['weighings'][0]['id']
    svc.correct(entry, first, dto('meat', 132, reason='Poprawiona tara'), 'operator')
    advance(entry, 'meat'); weigh(entry, 'backs', 37); advance(entry, 'backs'); weigh(entry, 'bones', 30); advance(entry, 'bones')
    svc.finish(entry)
    deb.delete_deboning_entry(entry, hall_correction=True, by_subject='MARCIN', service_code='4321')
    assert float(query_one("SELECT kg_available FROM raw_batches WHERE id='settle-batch'")['kg_available']) == 200
    assert float(query_one("SELECT kg_available FROM meat_stock WHERE lot_no='901'")['kg_available']) == 66
    assert [(r['kind'], float(r['kg'])) for r in query_all('SELECT kind, kg FROM byproduct_lots ORDER BY kind')] == [('backs', 18), ('bones', 16)]
    agg = bp.get('settle-batch')
    assert agg['backsKg'] == 18 and agg['bonesKg'] == 16
    row = query_one("SELECT quarter_kg, backs_pallets FROM batch_byproducts WHERE raw_batch_id='settle-batch'")
    assert float(row['quarter_kg']) == 100 and [p['entryId'] for p in row['backs_pallets']] == [other]
    _ledger_ok()


def test_delete_refuses_when_meat_or_byproducts_already_used(db, monkeypatch):
    monkeypatch.setenv('KIOSK_SERVICE_CODE', '4321')
    seed(); entry = take(); svc.start(entry); ready(entry); svc.finish(entry)
    execute("UPDATE byproduct_lots SET status='disposed', destination='WZ-1' WHERE kind='bones'")
    with pytest.raises(HTTPException, match='wydane'):
        deb.delete_deboning_entry(entry, hall_correction=True, service_code='4321')
    execute("UPDATE byproduct_lots SET status='open', destination=NULL")
    execute("UPDATE meat_stock SET kg_reserved=150 WHERE lot_no='901'")
    with pytest.raises(HTTPException, match='zużyte lub zarezerwowane'):
        deb.delete_deboning_entry(entry, hall_correction=True, service_code='4321')
    assert query_one('SELECT status FROM deboning_entries WHERE id=%s', (entry,))['status'] == 'complete'
    assert float(query_one("SELECT kg_available FROM raw_batches WHERE id='settle-batch'")['kg_available']) == 0


def test_take_amount_fixed_with_service_code_after_settlement_started(db, monkeypatch):
    from app.models.deboning import DeboningTakeUpdate
    monkeypatch.setenv('KIOSK_SERVICE_CODE', '4321')
    seed(); entry = take(); svc.start(entry); weigh(entry, 'meat', 170)
    with pytest.raises(HTTPException) as err: deb.update_deboning_take(entry, DeboningTakeUpdate(kgTaken=250))
    assert err.value.status_code == 400
    with pytest.raises(HTTPException) as err: deb.update_deboning_take(entry, DeboningTakeUpdate(kgTaken=160, serviceCode='4321'))
    assert 'zważono już' in err.value.detail
    deb.update_deboning_take(entry, DeboningTakeUpdate(kgTaken=250, serviceCode='4321'), 'MARCIN')
    state = svc.get(entry)
    assert state['kgTaken'] == 250 and state['minKg'] == 248.75 and state['maxKg'] == 253.75
    assert float(query_one("SELECT kg_available FROM raw_batches WHERE id='settle-batch'")['kg_available']) == 50
    trace = query_one('SELECT by_subject, changes FROM deboning_entry_corrections WHERE entry_id=%s', (entry,))
    assert trace['by_subject'] == 'MARCIN' and trace['changes']['kgQuarter'] == {'przed': 300.0, 'po': 250.0}
    _ledger_ok()


def test_settled_take_amount_fixed_with_service_code_keeps_the_weighings(db, monkeypatch):
    """ANATOLII 2026-11-06: declared 300 kg, settled 318 kg with an exception, really took 315 kg."""
    from app.models.deboning import DeboningTakeUpdate
    monkeypatch.setenv('KIOSK_SERVICE_CODE', '4321')
    seed(400); entry = take(kg=300); svc.start(entry)
    weigh(entry, 'meat', 205); advance(entry, 'meat'); weigh(entry, 'backs', 60); advance(entry, 'backs')
    weigh(entry, 'bones', 53); advance(entry, 'bones')
    svc.finish(entry, 'operator', exception_code='4321', exception_reason='Inne — wyjaśnię w biurze')
    with pytest.raises(HTTPException) as err: deb.update_deboning_take(entry, DeboningTakeUpdate(kgTaken=315))
    assert err.value.status_code == 400
    with pytest.raises(HTTPException) as err: deb.update_deboning_take(entry, DeboningTakeUpdate(kgTaken=200, serviceCode='4321'))
    assert 'zważono już' in err.value.detail
    deb.update_deboning_take(entry, DeboningTakeUpdate(kgTaken=315, serviceCode='4321'), 'MARCIN')
    row = query_one('SELECT kg_quarter, kg_meat, kg_backs, kg_bones, kg_remainder, yield_pct, status FROM deboning_entries WHERE id=%s', (entry,))
    assert float(row['kg_quarter']) == 315 and float(row['kg_meat']) == 205 and float(row['kg_backs']) == 60 and row['status'] == 'complete'
    assert float(row['kg_remainder']) == 110 and float(row['yield_pct']) == 65.08
    assert float(query_one("SELECT kg_available FROM raw_batches WHERE id='settle-batch'")['kg_available']) == 85
    raw_moves = float(query_one("SELECT SUM(qty) AS kg FROM stock_movements WHERE product_type='raw'")['kg'])
    assert raw_moves == -315
    assert float(query_one("SELECT quarter_kg FROM batch_byproducts WHERE raw_batch_id='settle-batch'")['quarter_kg']) == 315
    trace = query_one("SELECT by_subject, changes FROM deboning_entry_corrections WHERE entry_id=%s AND reason LIKE 'Zmiana ilości%%'", (entry,))
    assert trace['by_subject'] == 'MARCIN' and trace['changes']['kgQuarter'] == {'przed': 300.0, 'po': 315.0}
    assert trace['changes']['bilans']['sumaKg'] == 318 and trace['changes']['bilans']['wTolerancjiPo'] is True
    assert float(query_one("SELECT kg_available FROM meat_stock WHERE lot_no='901'")['kg_available']) == 205
