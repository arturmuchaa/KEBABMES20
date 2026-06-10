from app.services.orders_service import aggregate_order_progress


ORDER_LINES = [
    {"id": "L1", "qty": 20},  # 20 x 40kg
    {"id": "L2", "qty": 30},  # 30 x 30kg
]


def _by_line(result):
    return {r["line_id"]: r for r in result}


def test_cancelled_plan_does_not_count_as_done():
    # Plan pod zamówienie anulowany — nic nie wyprodukowano,
    # całość musi wrócić do qty_remaining.
    plan_lines = [
        {"client_order_line_id": "L1", "qty": 20, "qty_done": 0, "plan_status": "cancelled"},
        {"client_order_line_id": "L2", "qty": 30, "qty_done": 0, "plan_status": "cancelled"},
    ]
    r = _by_line(aggregate_order_progress(ORDER_LINES, plan_lines))
    assert r["L1"] == {"line_id": "L1", "qty_total": 20, "qty_done": 0, "qty_pending": 0, "qty_reported": 0, "qty_remaining": 20}
    assert r["L2"] == {"line_id": "L2", "qty_total": 30, "qty_done": 0, "qty_pending": 0, "qty_reported": 0, "qty_remaining": 30}


def test_cancelled_plan_with_tablet_progress_does_not_count():
    # Nawet jeśli tablet zdążył wpisać postęp, anulowany plan nie liczy się
    # do wykonania (finished_goods nie powstały).
    plan_lines = [
        {"client_order_line_id": "L1", "qty": 20, "qty_done": 5, "plan_status": "cancelled"},
    ]
    r = _by_line(aggregate_order_progress(ORDER_LINES, plan_lines))
    assert r["L1"]["qty_done"] == 0
    assert r["L1"]["qty_remaining"] == 20


def test_done_plan_counts_actual_production_not_planned():
    # Plan zamknięty częściowo: zaplanowano 20, wyprodukowano 12 —
    # liczy się 12, reszta wraca do zaplanowania.
    plan_lines = [
        {"client_order_line_id": "L1", "qty": 20, "qty_done": 12, "plan_status": "done"},
    ]
    r = _by_line(aggregate_order_progress(ORDER_LINES, plan_lines))
    assert r["L1"]["qty_done"] == 12
    assert r["L1"]["qty_remaining"] == 8


def test_done_plan_without_production_frees_whole_line():
    # Plan zamknięty bez produkcji ("Zamknięty (bez produkcji)") —
    # qty_done=0, całość do ponownego zaplanowania.
    plan_lines = [
        {"client_order_line_id": "L1", "qty": 20, "qty_done": 0, "plan_status": "done"},
    ]
    r = _by_line(aggregate_order_progress(ORDER_LINES, plan_lines))
    assert r["L1"]["qty_done"] == 0
    assert r["L1"]["qty_remaining"] == 20


def test_draft_and_active_plans_reserve_pending():
    plan_lines = [
        {"client_order_line_id": "L1", "qty": 10, "qty_done": 0, "plan_status": "draft"},
        {"client_order_line_id": "L1", "qty": 5, "qty_done": 3, "plan_status": "active"},
    ]
    r = _by_line(aggregate_order_progress(ORDER_LINES, plan_lines))
    assert r["L1"]["qty_pending"] == 15
    assert r["L1"]["qty_done"] == 0
    assert r["L1"]["qty_remaining"] == 5


def test_mixed_done_cancelled_and_active():
    # Historia linii: plan anulowany (20), plan done z produkcją 8, aktywny na 6.
    plan_lines = [
        {"client_order_line_id": "L1", "qty": 20, "qty_done": 0, "plan_status": "cancelled"},
        {"client_order_line_id": "L1", "qty": 8, "qty_done": 8, "plan_status": "done"},
        {"client_order_line_id": "L1", "qty": 6, "qty_done": 0, "plan_status": "active"},
    ]
    r = _by_line(aggregate_order_progress(ORDER_LINES, plan_lines))
    assert r["L1"] == {"line_id": "L1", "qty_total": 20, "qty_done": 8, "qty_pending": 6, "qty_reported": 8, "qty_remaining": 6}


def test_lines_without_plans_fully_remaining():
    r = _by_line(aggregate_order_progress(ORDER_LINES, []))
    assert r["L1"]["qty_remaining"] == 20
    assert r["L2"]["qty_remaining"] == 30


def test_reported_counts_active_plans_for_wz_precheck():
    # WZ/HDI z zamówienia biorą qty_done niezależnie od statusu planu —
    # qty_reported musi to odzwierciedlać (tablet wpisał 10 na planie active).
    plan_lines = [
        {"client_order_line_id": "L1", "qty": 10, "qty_done": 10, "plan_status": "active"},
        {"client_order_line_id": "L1", "qty": 5, "qty_done": 5, "plan_status": "cancelled"},
    ]
    r = _by_line(aggregate_order_progress(ORDER_LINES, plan_lines))
    assert r["L1"]["qty_done"] == 0        # plan niezamknięty — postęp formalny 0
    assert r["L1"]["qty_reported"] == 10   # ale na WZ wejdzie 10 (anulowany nie liczy się)


def test_plan_lines_without_order_link_ignored():
    plan_lines = [
        {"client_order_line_id": None, "qty": 50, "qty_done": 50, "plan_status": "done"},
        {"client_order_line_id": "", "qty": 50, "qty_done": 50, "plan_status": "done"},
    ]
    r = _by_line(aggregate_order_progress(ORDER_LINES, plan_lines))
    assert r["L1"]["qty_done"] == 0
