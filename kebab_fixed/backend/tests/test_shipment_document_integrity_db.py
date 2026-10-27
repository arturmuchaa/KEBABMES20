"""Final shipment review: immutable reprints and no document-edit bypasses."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.services import cmr_service, hdi_service, loading_service, split_documents_service, wz_service
from tests.partial_loading_helpers import finalize_loading
from tests.test_finalize_loading_db import _zamowienie, _wyrob, _paleta, _sztuki
from tests.test_partial_shipment_documents_db import seed, issue


def _documents():
    return {table: query_all(f"SELECT * FROM {table} ORDER BY id")
            for table in ("wz_documents", "hdi_documents", "cmr_documents", "stock_movements")}


def test_course_retry_does_not_rewrite_historical_documents_from_live_master_data(db):
    seed()
    kurs = finalize_loading("v1", ["o1"])["loading_id"]
    first = issue(kurs, kg=1600)
    before = _documents()
    execute("UPDATE clients SET address='NEW ADDRESS',name='NEW NAME' WHERE id='c1'")
    execute("UPDATE finished_goods SET batch_no='NEW BATCH' WHERE id='f1'")
    execute("UPDATE recipes SET name='NEW RECIPE' WHERE id='r1'")
    again = loading_service.wystaw_z_kursu(
        kurs, [{"order_id": "o1", "cel_kg": 2400, "hdi_fv": True, "invoice_no": "CHANGED"}],
        {"plate": "NEW CAR", "instructions": "NEW INSTRUCTIONS"})["orders"][0]
    assert again["invoice_data"] == first["invoice_data"]
    assert _documents() == before


@pytest.mark.parametrize("scope", ["calosc", "fv"])
def test_cmr_edit_cannot_append_unscanned_goods(db, scope):
    seed()
    kurs = finalize_loading("v1", ["o1"])["loading_id"]
    docs = issue(kurs, kg=1600)
    doc = next(d for d in docs["cmr"] if d["scope"] == scope)
    before = _documents()
    with pytest.raises(HTTPException, match="towar|ilości"):
        cmr_service.update_cmr(doc["id"], {"goods_manual": [{"name": "EXTRA", "qty": 40, "kg": 800}]})
    assert _documents() == before


def test_explicit_cmr_transport_edit_keeps_shipment_quantities(db):
    seed()
    kurs = finalize_loading("v1", ["o1"])["loading_id"]
    doc = issue(kurs, kg=1600)["cmr"][0]
    before = cmr_service.get_cmr(doc["id"])["payload"]
    cmr_service.update_cmr(doc["id"], {"plate": "CORRECTED", "invoice_no": "FV/EXTERNAL", "goods_manual": []})
    after = cmr_service.get_cmr(doc["id"])["payload"]
    assert after["goods"] == before["goods"]
    assert after["gross_kg"] == 2400
    assert after["carrier"]["plate"] == "CORRECTED"
    assert after["attachments"]["invoice_no"] == "FV/EXTERNAL"
    assert query_one("SELECT sum(qty) AS kg FROM stock_movements WHERE movement_type='OUT'")["kg"] == -2400


@pytest.mark.parametrize("entry", ["wm_edit", "wz_edit", "wm_cancel", "wz_cancel", "hdi_from_wm"])
def test_order_document_cannot_use_manual_edit_or_cancel_bypass(db, entry):
    seed()
    kurs = finalize_loading("v1", ["o1"])["loading_id"]
    docs = issue(kurs, kg=1600)
    before = _documents()
    calls = {
        "wm_edit": lambda: wz_service.update_wz_lines(docs["wm"]["id"], [{"index": 0, "qty": 160}]),
        "wz_edit": lambda: wz_service.update_wz_lines(docs["wz"]["id"], [{"index": 0, "qty": 160}]),
        "wm_cancel": lambda: wz_service.cancel_wz(docs["wm"]["id"]),
        "wz_cancel": lambda: wz_service.cancel_wz(docs["wz"]["id"]),
        "hdi_from_wm": lambda: hdi_service.generate_hdi_from_wz(docs["wm"]["id"]),
    }
    with pytest.raises(HTTPException):
        calls[entry]()
    assert _documents() == before


def test_cmr_numbers_are_unique_between_simultaneous_different_orders(db, monkeypatch):
    seed()
    first = finalize_loading("v1", ["o1"])["loading_id"]
    _zamowienie(oid="o2", qty=3, kg=30)
    _wyrob(gid="f2", qty=3, kg=30)
    _paleta(pid="p2", oid="o2")
    execute("INSERT INTO order_pallet_items(id,pallet_id,order_line_id,qty) VALUES ('i2','p2','o2-l1',3)")
    second = finalize_loading("v1", ["o2"])["loading_id"]
    original = cmr_service.build_cmr
    ready = Barrier(2)
    def build(*args, **kwargs):
        data = original(*args, **kwargs)
        ready.wait(timeout=10)
        return data
    monkeypatch.setattr(cmr_service, "build_cmr", build)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(cmr_service.generate_cmr, oid, {}, loading_id=lid)
                   for oid, lid in [("o1", first), ("o2", second)]]
        docs = [f.result(timeout=20) for f in futures]
    assert len({d["number"] for d in docs}) == 2
    assert sorted(d["payload"]["gross_kg"] for d in docs) == [90, 2400]


@pytest.mark.parametrize("contents_known", [True, False])
def test_ambiguous_legacy_courses_never_reuse_other_courses_documents(db, contents_known):
    seed()
    first = finalize_loading("v1", ["o1"])["loading_id"]
    first_docs = issue(first)
    _paleta(pid="p2", nr=2)
    execute("INSERT INTO order_pallet_items(id,pallet_id,order_line_id,qty) VALUES ('i2','p2','o1-l1',40)")
    second = finalize_loading("v1", ["o1"])["loading_id"]
    second_docs = issue(second, kg=800)
    # Historical databases may contain several courses with unscoped papers.
    for table in ("wz_documents", "hdi_documents", "cmr_documents"):
        execute(f"UPDATE {table} SET loading_id=NULL")
    execute("UPDATE loading_orders SET document_snapshot=NULL")
    if not contents_known:
        execute("UPDATE loading_orders SET pozycje='[]'::jsonb")
    before = _documents()
    for course, docs in [(first, first_docs), (second, second_docs)]:
        row = loading_service.zaladunek(course)["pozycje"][0]
        assert [d["id"] for d in row["wz"]] == [docs["wm"]["id"]]
        assert row["hdi"] == row["cmr"] == []
        with pytest.raises(HTTPException, match="historyczn|przypisa"):
            split_documents_service.wystaw_wz_wewnetrzny("o1", loading_id=course)
        # Explicit historical reprints are still available by document ID.
        assert wz_service.get_wz(docs["wm"]["id"])["id"] == docs["wm"]["id"]
    assert _documents() == before


def test_partial_qr_dispatch_preserves_piece_identity_and_history(db):
    seed()
    _sztuki("p1", "f1", ile=120, kg=20)
    execute("INSERT INTO pallet_scans(id,pallet_id,action,operator) VALUES ('scan','p1','load','warehouse')")
    before_units = query_all("SELECT * FROM finished_units ORDER BY id")
    before_scans = query_all("SELECT * FROM pallet_scans ORDER BY id")
    result = finalize_loading("v1", ["o1"])
    docs = issue(result["loading_id"])
    assert result["orders"][0]["coverage"]["missing"][0]["missing_qty"] == 40
    assert docs["wm"]["kg"] == 2400
    assert query_all("SELECT * FROM finished_units ORDER BY id") == [{**u, "status": "shipped"} for u in before_units]
    assert query_all("SELECT * FROM pallet_scans ORDER BY id") == before_scans


def test_delivery_settlement_uses_selected_course_and_keeps_previous_course_debt(db):
    from app.services.rozrachunki_service import rozliczenie_dostawy
    seed()
    execute("UPDATE clients SET settlement_enabled=true WHERE id='c1'")
    execute("INSERT INTO client_opening_balances(client_id,amount,currency,as_of_date) VALUES ('c1',0,'PLN','2026-01-01')")
    first = finalize_loading("v1", ["o1"])["loading_id"]
    first_docs = issue(first, kg=1600)
    wz_service.update_wz_prices(first_docs["wz"]["id"], [{"index": 0, "price": 2}])
    assert rozliczenie_dostawy("o1", {}, loading_id=first)["kg_razem"] == 2400
    _paleta(pid="p2", nr=2)
    execute("INSERT INTO order_pallet_items(id,pallet_id,order_line_id,qty) VALUES ('i2','p2','o1-l1',40)")
    second = finalize_loading("v1", ["o1"])["loading_id"]
    second_docs = issue(second, kg=800)
    result = rozliczenie_dostawy("o1", {}, loading_id=second)
    assert result["kg_razem"] == 800
    assert result["dokument"] == second_docs["wm"]["number"]
    assert result["saldo_przed"] == -1600
    with pytest.raises(HTTPException, match="kurs"):
        rozliczenie_dostawy("o1", {})
    with pytest.raises(HTTPException) as error:
        rozliczenie_dostawy("o1", {}, loading_id="other-course")
    assert error.value.status_code == 404
    # The route must propagate the selected course to the same service.
    from app.routes.rozrachunki import dostawa
    assert dostawa("o1", {"ceny": {}, "loading_id": second})["kg_razem"] == 800
    with pytest.raises(HTTPException) as invalid:
        dostawa("o1", {"loading_id": [second]})
    assert invalid.value.status_code == 400
