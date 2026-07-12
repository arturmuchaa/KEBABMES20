"""Testy INTEGRACYJNE undo_mixing_confirmation (prawdziwy SQL na bazie testowej).

Cofnięcie potwierdzenia = odwrócenie finish_mixing_session: usunięcie partii
przyprawionego, przywrócenie mięsa i przypraw, powrót zlecenia do kolejki.
Guard: undo tylko gdy partia przyprawionego niezużyta (kg_used=0).
"""
import pytest
from fastapi import HTTPException

from app.db import query_one, query_all, execute
from app.models.mixing import FinishMixingSessionDto, FinishMixingLotAlloc
from app.services.mixing_service import finish_mixing_session, undo_mixing_confirmation


def _seed_raw_batch(rb_id, seq):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, status) "
        "VALUES (%s,%s,%s,'active')",
        (rb_id, f"RB-{rb_id}", seq),
    )


def _seed_stock(ms_id, lot_no, kg_available, kg_reserved, raw_batch_id):
    execute(
        "INSERT INTO meat_stock "
        "(id, lot_no, kg_available, kg_reserved, status, raw_batch_id, material_type_id, material_name) "
        "VALUES (%s,%s,%s,%s,'AVAILABLE',%s,'mat-A','Łopatka')",
        (ms_id, lot_no, kg_available, kg_reserved, raw_batch_id),
    )


def _seed_order(order_id, recipe_id, recipe_name, meat_kg=200):
    execute(
        "INSERT INTO mixing_orders (id, order_no, recipe_id, recipe_name, meat_kg, status, machine_id) "
        "VALUES (%s,%s,%s,%s,%s,'in_progress',1)",
        (order_id, f"MAS/{order_id}", recipe_id, recipe_name, meat_kg),
    )


def _finish(order_id, ms_id, kg):
    dto = FinishMixingSessionDto(
        kg_actual=kg, batch_no="",
        lot_allocations=[FinishMixingLotAlloc(meat_lot_id=ms_id, kg=kg)],
    )
    return finish_mixing_session(order_id, dto)


def test_undo_reverses_finish(db):
    _seed_raw_batch("rb500", 500)
    _seed_stock("msu1", "LOT-U1", 1000, 200, "rb500")   # 200 zarezerwowane pod zlecenie
    _seed_order("ou1", "r-gold2", "Gold2", meat_kg=200)

    _finish("ou1", "msu1", 200)
    # po finish: partia powstała, mięso zużyte, zlecenie done
    assert query_one("SELECT status FROM mixing_orders WHERE id=%s", ("ou1",))["status"] == "done"
    assert query_one("SELECT id FROM seasoned_meat WHERE batch_no=%s AND recipe_id=%s", ("500", "r-gold2")) is not None

    undo_mixing_confirmation("ou1")

    # partia przyprawionego usunięta
    assert query_one("SELECT id FROM seasoned_meat WHERE batch_no=%s AND recipe_id=%s", ("500", "r-gold2")) is None
    # mięso przywrócone (available z powrotem, used=0, rezerwacja wraca)
    ms = query_one("SELECT kg_available, kg_reserved, kg_used FROM meat_stock WHERE id=%s", ("msu1",))
    assert float(ms["kg_available"]) == 1000.0
    assert float(ms["kg_reserved"]) == 200.0
    assert float(ms["kg_used"]) == 0.0
    # zlecenie wróciło do kolejki, rezerwacja lotu przywrócona
    o = query_one("SELECT status, kg_done FROM mixing_orders WHERE id=%s", ("ou1",))
    assert o["status"] == "confirmed"
    assert float(o["kg_done"]) == 0.0
    lot = query_one("SELECT kg_planned, kg_actual FROM mixing_order_lots WHERE order_id=%s AND meat_stock_id=%s", ("ou1", "msu1"))
    assert float(lot["kg_planned"]) == 200.0 and float(lot["kg_actual"]) == 0.0
    # ślad ruchów i sesji usunięty
    assert query_all("SELECT id FROM stock_movements WHERE source_type='mixing' AND source_id=%s", ("ou1",)) == []
    assert query_all("SELECT id FROM mixing_sessions WHERE order_id=%s", ("ou1",)) == []


def test_undo_blocked_when_seasoned_used(db):
    _seed_raw_batch("rb501", 501)
    _seed_stock("msu2", "LOT-U2", 1000, 200, "rb501")
    _seed_order("ou2", "r-gold2", "Gold2", meat_kg=200)
    _finish("ou2", "msu2", 200)

    # symuluj zużycie downstream
    execute("UPDATE seasoned_meat SET kg_used=50 WHERE batch_no=%s AND recipe_id=%s", ("501", "r-gold2"))

    with pytest.raises(HTTPException) as ei:
        undo_mixing_confirmation("ou2")
    assert ei.value.status_code == 400
    # nic nie cofnięte — zlecenie nadal done
    assert query_one("SELECT status FROM mixing_orders WHERE id=%s", ("ou2",))["status"] == "done"


def test_undo_rejects_non_done(db):
    _seed_order("ou3", "r-gold2", "Gold2", meat_kg=200)
    execute("UPDATE mixing_orders SET status='confirmed' WHERE id=%s", ("ou3",))
    with pytest.raises(HTTPException) as ei:
        undo_mixing_confirmation("ou3")
    assert ei.value.status_code == 400
