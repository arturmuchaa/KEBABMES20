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
    # internal_batch_no odpowiada seq — tak jak w produkcji („470", „55U”).
    # Numer partii przyprawionego bierze się z internal_batch_no, więc
    # sztuczne „RB-…” rozjeżdżałoby test z rzeczywistością.
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, status) "
        "VALUES (%s,%s,%s,'active')",
        (rb_id, str(seq), seq),
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


def test_cofniecie_dziala_takze_dla_zlecenia_W_TRAKCIE(db):
    """Panel masowni zostawia zlecenia W TRAKCIE z zamkniętymi sesjami.

    Operator miesza wsad po wsadzie, więc zlecenie na 1000 kg z jednym wsadem
    400 kg stoi jako `in_progress` z prawdziwą sesją — to normalny stan, nie
    awaria. Gdy biuro zauważy, że wsad zapisano przez pomyłkę, musi mieć czym
    go cofnąć; bramka „tylko done" odsyłała je wtedy do gołego SQL-a.
    """
    _seed_raw_batch("rb-wt", 611)
    _seed_stock("ms-wt", "611", 1000, 400, "rb-wt")
    _seed_order("ou-wt", "r-wt", "WsadCzesciowy", meat_kg=1000)
    _finish("ou-wt", "ms-wt", 400)

    w_trakcie = query_one("SELECT status, kg_done FROM mixing_orders WHERE id=%s", ("ou-wt",))
    assert w_trakcie["status"] == "in_progress", "wsad czesciowy ma zostawic zlecenie w trakcie"
    przed = query_one("SELECT kg_available, kg_used FROM meat_stock WHERE id=%s", ("ms-wt",))

    undo_mixing_confirmation("ou-wt")

    o = query_one("SELECT status, kg_done FROM mixing_orders WHERE id=%s", ("ou-wt",))
    assert o["status"] == "confirmed"
    assert float(o["kg_done"]) == 0.0
    po = query_one("SELECT kg_available, kg_used FROM meat_stock WHERE id=%s", ("ms-wt",))
    assert float(po["kg_available"]) == float(przed["kg_available"]) + 400
    assert float(po["kg_used"]) == float(przed["kg_used"]) - 400
    assert query_all("SELECT id FROM mixing_sessions WHERE order_id=%s", ("ou-wt",)) == []


def test_cofniecie_zlecenia_bez_sesji_jest_odrzucane(db):
    # Bez tej bramki zlecenie swiezo rozpoczete (0 kg) cicho wracaloby do
    # „potwierdzone" i wygladalo, jakby cos odkrecono.
    _seed_order("ou-brak", "r-brak", "BezSesji", meat_kg=500)
    with pytest.raises(HTTPException) as ei:
        undo_mixing_confirmation("ou-brak")
    assert ei.value.status_code == 400
    assert "nie ma czego cofać" in str(ei.value.detail).lower()


def test_anulowanie_zlecenia_w_trakcie_bez_zapisanego_masowania(db):
    """Zlecenie rozpoczete, ale nic z niego nie wyszlo — musi dac sie anulowac.

    Panel masowni stawia zlecenie w stan `in_progress` juz przy zaladunku
    pierwszego wsadu. Gdy wsad zostanie anulowany (pomylka maszyny), zlecenie
    zostaje „w trakcie" z zerem zrobionych kilogramow — a bramka „tylko
    planned/confirmed" nie pozwalala go zamknac i wisialo, trzymajac
    rezerwacje miesa.
    """
    from app.services.mixing_service import cancel_mixing_order

    _seed_raw_batch("rb-wt2", 612)
    _seed_stock("ms-wt2", "612", 1000, 300, "rb-wt2")
    _seed_order("ou-wt2", "r-wt2", "PustyWTrakcie", meat_kg=1000)
    execute("INSERT INTO mixing_order_lots (id, order_id, meat_stock_id, kg_planned) "
            "VALUES (%s,%s,%s,%s)", ("mol-wt2", "ou-wt2", "ms-wt2", 300))

    cancel_mixing_order("ou-wt2")

    o = query_one("SELECT status FROM mixing_orders WHERE id=%s", ("ou-wt2",))
    assert o["status"] == "cancelled"
    # Rezerwacja wraca do puli.
    assert float(query_one("SELECT kg_reserved FROM meat_stock WHERE id=%s",
                           ("ms-wt2",))["kg_reserved"]) == 0.0


def test_zlecenie_w_trakcie_Z_SESJA_dalej_nie_da_sie_anulowac(db):
    # Tu masowanie juz sie odbylo — najpierw trzeba je cofnac, inaczej
    # anulowanie rozjechaloby stan z wyrobem, ktory powstal.
    _seed_raw_batch("rb-wt3", 613)
    _seed_stock("ms-wt3", "613", 1000, 400, "rb-wt3")
    _seed_order("ou-wt3", "r-wt3", "ZSesja", meat_kg=1000)
    _finish("ou-wt3", "ms-wt3", 400)
    from app.services.mixing_service import cancel_mixing_order
    with pytest.raises(HTTPException) as ei:
        cancel_mixing_order("ou-wt3")
    assert ei.value.status_code == 400
