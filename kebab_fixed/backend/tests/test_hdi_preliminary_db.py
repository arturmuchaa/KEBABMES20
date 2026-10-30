"""VATAN: HDI dziś, skanowanie jutro — wyjątek tylko dla jawnej wersji wstępnej."""
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.routes.hdi import generate
from app.services import hdi_service as hdi, loading_service as loading
from tests.test_partial_shipment_documents_db import seed, issue
from tests.test_finalize_loading_db import _paleta, _wz_zamowienia, _wyrob, _sztuki
from tests.partial_loading_helpers import finalize_loading


def before_loading(ordered=160, loaded=120):
    seed(ordered=ordered, loaded=loaded)
    execute("UPDATE clients SET name='VATAN',display_name='VATAN',language='de' WHERE id='c1'")
    execute("UPDATE client_orders SET client_name='VATAN' WHERE id='o1'")
    execute("UPDATE finished_goods SET client_name='VATAN' WHERE id='f1'")
    execute("UPDATE order_pallets SET status='created',loaded_vehicle_id=NULL,loaded_at=NULL WHERE id='p1'")


def scan():
    execute("UPDATE order_pallets SET status='loaded',loaded_vehicle_id='v1',loaded_at=now() WHERE id='p1'")


def warehouse_state():
    return {table: query_all(f"SELECT * FROM {table} ORDER BY id") for table in (
        "finished_goods", "finished_units", "stock_movements", "order_pallets",
        "client_orders", "client_order_lines", "wz_documents", "cmr_documents", "loadings")}


def test_explicit_preliminary_before_any_scan_uses_stock_without_issuing_goods(db):
    before_loading()
    before = warehouse_state()
    result = generate(order_id="o1", preliminary=True)
    assert result["totals"] == {"qty": 160, "kg": 3200}
    assert result["status"] == "wstepny"
    assert result["incomplete"] is False
    doc = hdi.get_hdi(result["id"])
    assert doc["header"]["preliminary"] is True
    assert doc["header"]["reg_number"] == ""
    assert doc["loading_id"] is None
    assert doc["language"] == "de"
    assert "VATAN" in doc["header"]["recipient"]
    assert doc["items"][0]["batches"][0]["partia"] == "080926 500"
    assert warehouse_state() == before
    # Stary endpoint i komplet dokumentów NIE dostają obejścia blokady.
    with pytest.raises(HTTPException, match="zeskanowany towar"):
        hdi.generate_hdi("o1")


def test_preliminary_refreshes_same_number_and_reports_missing_production(db):
    before_loading()
    execute("UPDATE finished_goods SET qty=100,qty_available=100 WHERE id='f1'")
    first = hdi.generate_hdi("o1", preliminary=True)
    assert first["totals"] == {"qty": 100, "kg": 2000}
    assert first["incomplete"] is True
    execute("UPDATE finished_goods SET qty=160,qty_available=160 WHERE id='f1'")
    second = hdi.generate_hdi("o1", preliminary=True)
    assert (second["id"], second["number"]) == (first["id"], first["number"])
    assert second["totals"] == {"qty": 160, "kg": 3200}
    assert second["incomplete"] is False
    assert len(query_all("SELECT id FROM hdi_documents")) == 1
    assert query_one("SELECT value FROM sequences WHERE key LIKE 'hdi_seq:%%'")["value"] == 1


def test_no_production_does_not_invent_order_quantities_or_batches(db):
    before_loading()
    execute("UPDATE finished_goods SET qty_available=0 WHERE id='f1'")
    with pytest.raises(HTTPException, match="Brak wyprodukowanej"):
        hdi.generate_hdi("o1", preliminary=True)
    assert query_all("SELECT id FROM hdi_documents") == []
    assert query_all("SELECT key FROM sequences WHERE key LIKE 'hdi_seq:%%'") == []


def test_reported_production_keeps_batches_expiry_and_packaging(db):
    before_loading()
    execute("UPDATE finished_goods SET qty_available=0 WHERE id='f1'")
    execute("UPDATE recipes SET shelf_life_days=365 WHERE id='r1'")
    execute("INSERT INTO production_plans(id,plan_no,status) VALUES ('plan','P/1','in_progress')")
    execute("""INSERT INTO production_plan_lines
        (id,plan_id,client_order_id,qty,qty_done,kg_per_unit,recipe_id,recipe_name,
         product_type_id,packaging_name,batch_allocation,progress_updated_at)
        VALUES ('line','plan','o1',160,100,20,'r1','KIRMIZI','pt1','METAL 80CM',
                '{"601":{"pieces":60},"602":{"pieces":40}}'::jsonb,'2026-10-29T12:00:00Z')""")
    doc = hdi.get_hdi(hdi.generate_hdi("o1", preliminary=True)["id"])
    assert doc["totals"] == {"qty": 100, "kg": 2000}
    assert doc["incomplete"] is True
    assert doc["items"][0]["name"].endswith("20KG (80cm)")
    assert doc["items"][0]["batches"] == [
        {"partia": "291026 601", "termin": "29.10.2027", "qty": 60},
        {"partia": "291026 602", "termin": "29.10.2027", "qty": 40}]
    execute("UPDATE production_plans SET status='cancelled' WHERE id='plan'")
    with pytest.raises(HTTPException, match="Brak wyprodukowanej"):
        hdi.generate_hdi("o1", preliminary=True)


@pytest.mark.parametrize("live_document", [False, True])
@pytest.mark.parametrize("loaded", [120, 160])
def test_first_course_reuses_number_but_replaces_quantities_from_scans(db, loaded, live_document):
    before_loading(loaded=loaded)
    draft = hdi.generate_hdi("o1", preliminary=True)
    scan()
    if live_document:
        live = hdi.generate_hdi("o1")
        assert live["id"] == draft["id"]
        assert live["totals"]["qty"] == loaded
        assert hdi.get_hdi(live["id"])["header"]["preliminary"] is True
    result = finalize_loading("v1", ["o1"], plate="VATAN 123")
    assert result["orders"][0]["hdi_error"] is None
    assert result["orders"][0]["hdi_id"] == draft["id"]
    doc = hdi.get_hdi(draft["id"])
    assert doc["number"] == draft["number"]
    assert doc["totals"] == {"qty": loaded, "kg": loaded * 20}
    assert doc["loading_id"] == result["loading_id"]
    assert not doc["header"].get("preliminary")
    assert doc["header"]["reg_number"] == "VATAN 123"
    course_date = query_one("SELECT finished_at FROM loadings WHERE id=%s", (result["loading_id"],))["finished_at"]
    assert doc["header"]["shipment_date"] == course_date.strftime("%d.%m.%Y")
    docs = issue(result["loading_id"], kg=loaded * 20)
    assert docs["hdi_calosc"]["id"] == draft["id"]
    assert docs["hdi_fv"]["number"] == draft["number"] + "/1"
    assert docs["wm"]["kg"] == loaded * 20
    # Dokument już wydany pozostaje niezmienny także po zmianie magazynu.
    stored = hdi.get_hdi(draft["id"])
    execute("UPDATE finished_goods SET batch_no='301026 999' WHERE id='f1'")
    assert hdi.generate_hdi("o1", loading_id=result["loading_id"])["frozen"] is True
    assert hdi.get_hdi(draft["id"]) == stored


def test_second_course_never_reuses_first_preliminary_number(db):
    before_loading()
    draft = hdi.generate_hdi("o1", preliminary=True)
    scan()
    first = finalize_loading("v1", ["o1"])["loading_id"]
    issue(first)
    stored = hdi.get_hdi(draft["id"])
    with pytest.raises(HTTPException, match="Załadunek lub wydanie"):
        hdi.generate_hdi("o1", preliminary=True)
    _paleta(pid="p2", nr=2)
    execute("INSERT INTO order_pallet_items(id,pallet_id,order_line_id,qty) VALUES ('i2','p2','o1-l1',40)")
    second = loading.finalize_loading("v1", ["o1"])["loading_id"]
    docs = issue(second, kg=800)
    assert docs["hdi_calosc"]["id"] != draft["id"]
    assert docs["hdi_calosc"]["number"] != draft["number"]
    assert docs["hdi_calosc"]["totals"] == {"qty": 40, "kg": 800}
    assert hdi.get_hdi(draft["id"]) == stored


def test_final_hdi_uses_scanned_batch_not_preliminary_fifo_suggestion(db):
    before_loading(ordered=10, loaded=10)
    draft = hdi.generate_hdi("o1", preliminary=True)
    assert hdi.get_hdi(draft["id"])["items"][0]["batches"][0]["partia"] == "080926 500"
    _wyrob(gid="f2", qty=10, kg=20)
    execute("UPDATE finished_goods SET batch_no='291026 900',produced_date='2026-10-29' WHERE id='f2'")
    _sztuki("p1", "f2", ile=10, kg=20)
    execute("UPDATE finished_units SET batch_no='900'")
    scan()
    result = loading.finalize_loading("v1", ["o1"])
    assert result["orders"][0]["hdi_error"] is None
    assert result["orders"][0]["hdi_id"] == draft["id"]
    assert hdi.get_hdi(draft["id"])["items"][0]["batches"][0]["partia"] == "291026 900"


def test_retry_can_finalize_preliminary_when_first_course_already_closed_order(db, monkeypatch):
    before_loading(ordered=10, loaded=10)
    draft = hdi.generate_hdi("o1", preliminary=True)
    # Wcześniejsza data wystawienia nie staje się datą jutrzejszej wysyłki.
    execute("UPDATE hdi_documents SET issue_date='29.10.2026' WHERE id=%s", (draft["id"],))
    scan()
    monkeypatch.setattr(loading, "_ensure_hdi", lambda *a, **kw: {})
    course = loading.finalize_loading("v1", ["o1"])["loading_id"]
    execute("UPDATE client_orders SET status='done' WHERE id='o1'")
    final = hdi.generate_hdi("o1", loading_id=course)
    assert final["id"] == draft["id"]
    stored = hdi.get_hdi(draft["id"])
    assert not stored["header"].get("preliminary")
    assert stored["loading_id"] == course
    assert stored["issue_date"] == "29.10.2026"
    assert stored["header"]["shipment_date"] == query_one(
        "SELECT finished_at FROM loadings WHERE id=%s", (course,))["finished_at"].strftime("%d.%m.%Y")


@pytest.mark.parametrize("state", ["done", "cancelled", "scanned", "legacy_wz"])
def test_preliminary_cannot_replace_shipped_or_closed_documents(db, state):
    before_loading()
    if state in ("done", "cancelled"):
        execute("UPDATE client_orders SET status=%s WHERE id='o1'", (state,))
    elif state == "scanned":
        scan()
    else:
        _wz_zamowienia()
    before = warehouse_state()
    with pytest.raises(HTTPException):
        hdi.generate_hdi("o1", preliminary=True)
    assert query_all("SELECT id FROM hdi_documents") == []
    assert warehouse_state() == before


def test_cancelled_preliminary_number_is_not_reused(db):
    before_loading()
    first = hdi.generate_hdi("o1", preliminary=True)
    hdi.anuluj_hdi(first["id"])
    second = hdi.generate_hdi("o1", preliminary=True)
    assert second["id"] != first["id"]
    assert second["number"] != first["number"]


def test_concurrent_preliminary_requests_share_one_number(db):
    before_loading()
    with ThreadPoolExecutor(max_workers=2) as pool:
        docs = list(pool.map(lambda _: hdi.generate_hdi("o1", preliminary=True), range(2)))
    assert docs[0]["id"] == docs[1]["id"]
    assert len(query_all("SELECT id FROM hdi_documents")) == 1


@pytest.mark.parametrize("scope", ["fv", "wz"])
def test_preliminary_is_only_for_whole_order(db, scope):
    before_loading()
    with pytest.raises(HTTPException):
        hdi.generate_hdi("o1", scope, preliminary=True)
    assert query_all("SELECT id FROM hdi_documents") == []
