"""Test: łańcuch partii (backward) domyka się do WYROBU GOTOWEGO również wtedy,
gdy wejściem jest partia przyprawionego (mięso przyprawione), nie wyrób.

Wcześniej skaner przepływu urywał się na mięsie przyprawionym. Ostatni krok ma
być wyrób gotowy (etykieta ddmmrr nrpartii budowana na froncie z produced_date
+ batch_no).

Testy DB wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
from app.db import execute
from app.services.traceability_service import traceability


def _seed_seasoned(sm_id, batch_no):
    execute(
        "INSERT INTO seasoned_meat (id, batch_no, recipe_id, kg_produced, kg_available, status) "
        "VALUES (%s,%s,'r1',100,100,'available')",
        (sm_id, batch_no),
    )


def _seed_finished_goods(fg_id, batch_no, seasoned_batch_nos, produced_date="2026-06-18"):
    execute(
        "INSERT INTO finished_goods (id, batch_no, produced_date, seasoned_batch_nos) "
        "VALUES (%s,%s,%s::date,%s)",
        (fg_id, batch_no, produced_date, seasoned_batch_nos),
    )


def test_backward_from_seasoned_reaches_finished_goods(db):
    _seed_seasoned("sm500", "000500")
    _seed_finished_goods("fg1", "000777", ["000500"])
    res = traceability("000500", "backward")
    fg_batches = {fg.get("batch_no") for fg in res["finishedGoods"]}
    assert "000777" in fg_batches
    # i nadal mamy partię przyprawionego w łańcuchu
    sm_batches = {sm.get("batch_no") for sm in res["seasonedBatches"]}
    assert "000500" in sm_batches


def test_backward_from_seasoned_without_finished_goods_is_empty(db):
    # Partia przyprawionego jeszcze nie zużyta w produkcji → brak wyrobu (bez błędu).
    _seed_seasoned("sm501", "000501")
    res = traceability("000501", "backward")
    assert res["finishedGoods"] == []
    assert {sm.get("batch_no") for sm in res["seasonedBatches"]} == {"000501"}
