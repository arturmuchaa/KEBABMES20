"""ZAGROS/POLAT: warn on missing pallet, issue exactly the scanned shipment."""
import json
import os
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.db import atomic_operation, cx_execute, execute, query_all, query_one, transaction
from app.services import loading_service as loading, split_documents_service as documents
from app.services import hdi_service, cmr_service
from tests.test_finalize_loading_db import _firma, _pojazd, _klient, _receptura, _zamowienie, _wyrob, _paleta, _sztuki
from tests.partial_loading_helpers import finalize_loading


def seed(ordered=160, loaded=120, kg=20):
    _firma(); _pojazd(); _klient(); _receptura()
    _zamowienie(order_no="POLAT/Z/2/10/26", qty=ordered, kg=kg)
    _wyrob(qty=ordered, kg=kg)
    execute("UPDATE clients SET name='POLAT',display_name='POLAT' WHERE id='c1'")
    execute("UPDATE client_orders SET client_name='POLAT' WHERE id='o1'")
    execute("UPDATE finished_goods SET client_name='POLAT' WHERE id='f1'")
    _paleta()
    execute("INSERT INTO order_pallet_items(id,pallet_id,order_line_id,qty) VALUES ('i1','p1','o1-l1',%s)", (loaded,))


def issue(kurs, kg=2400):
    return loading.wystaw_z_kursu(kurs, [{"order_id": "o1", "cel_kg": kg, "hdi_fv": True}], {})["orders"][0]


def export_documents(case, docs):
    """Optional real DB outputs consumed by the browser/PDF acceptance test."""
    root = os.environ.get("SHIPMENT_ARTIFACT_DIR")
    if not root:
        return
    from app.services.wz_service import get_wz
    data = {"wz": [get_wz(docs[k]["id"]) for k in ("wm", "wz") if docs.get(k)],
            "hdi": [hdi_service.get_hdi(docs[k]["id"]) for k in ("hdi_calosc", "hdi_fv") if docs.get(k)],
            "cmr": [cmr_service.get_cmr(d["id"]) for d in docs["cmr"]],
            "invoice_data": docs.get("invoice_data")}
    Path(root).mkdir(parents=True, exist_ok=True)
    (Path(root) / f"{case}.json").write_text(json.dumps(data, default=str, ensure_ascii=False))


def test_polat_partial_is_allowed_warned_and_all_documents_follow_scans(db):
    seed()
    result = finalize_loading("v1", ["o1"], request_id="partial-polat")
    assert result["ok"] is True
    missing = result["orders"][0]["coverage"]["missing"]
    assert [(x["missing_qty"], x["missing_kg"]) for x in missing] == [(40, 800)]
    assert query_one("SELECT status FROM order_pallets WHERE id='p1'")["status"] == "shipped"
    docs = issue(result["loading_id"])
    export_documents("polat", docs)
    assert docs["wm"]["kg"] == 2400
    assert docs["wz"] is None
    assert docs["hdi_calosc"]["totals"] == {"qty": 120, "kg": 2400}
    assert docs["hdi_fv"]["totals"] == {"qty": 120, "kg": 2400}
    assert docs["invoice_data"]["invoice_kg"] == 2400
    assert docs["invoice_data"]["lines"][0]["invoice_qty"] == 120
    for cmr in docs["cmr"]:
        assert cmr["payload"]["gross_kg"] == 2400
        assert sum(g["qty"] for g in cmr["payload"]["goods"]) == 120
    assert query_one("SELECT qty FROM client_order_lines WHERE id='o1-l1'")["qty"] == 160
    assert query_one("SELECT status FROM client_orders WHERE id='o1'")["status"] == "confirmed"
    assert query_one("SELECT qty_available,qty_shipped FROM finished_goods WHERE id='f1'") == {"qty_available": 40, "qty_shipped": 120}
    assert query_one("SELECT sum(qty) AS kg FROM stock_movements WHERE movement_type='OUT'")["kg"] == -2400
    stored = query_one("SELECT response FROM loadings WHERE id=%s", (result["loading_id"],))["response"]
    assert stored["partial_confirmation"] == result["partial_confirmation"]
    json.dumps(result)  # Public responses must remain JSON-serializable.
    assert query_one("SELECT loading_status FROM wz_documents WHERE id=%s", (docs["wm"]["id"],))["loading_status"] == "potwierdzony"
    before = query_all("SELECT id,qty FROM stock_movements ORDER BY id")
    assert issue(result["loading_id"])["wm"]["id"] == docs["wm"]["id"]
    assert query_all("SELECT id,qty FROM stock_movements ORDER BY id") == before
    replay = loading.finalize_loading("v1", ["o1"], request_id="partial-polat")
    assert replay["orders"][0]["coverage"]["missing"] == missing


def test_invoice_and_client_wz_partition_only_the_loaded_quantity(db):
    seed()
    kurs = finalize_loading("v1", ["o1"])["loading_id"]
    docs = issue(kurs, kg=1600)
    export_documents("polat-split", docs)
    assert docs["wm"]["kg"] == 2400
    assert docs["wz"]["kg"] == 800
    assert docs["hdi_fv"]["totals"] == {"qty": 80, "kg": 1600}
    assert docs["cmr"][1]["payload"]["gross_kg"] == 1600
    assert query_one("SELECT qty_invoice FROM client_order_lines WHERE id='o1-l1'")["qty_invoice"] is None


def test_zagros_missing_entire_weight_position_never_appears_on_documents(db):
    seed(ordered=115, loaded=115, kg=20)
    execute("UPDATE client_orders SET order_no='ZAGROS/Z/4/10/26',total_units=327,total_kg=8050 WHERE id='o1'")
    execute("UPDATE clients SET name='ZAGROS',display_name='ZAGROS' WHERE id='c1'")
    execute("UPDATE client_orders SET client_name='ZAGROS' WHERE id='o1'")
    _receptura(rid="r2", nazwa="GOLD")
    for lid, qty, kg, rid in [("delivered-25", 122, 25, "r1"), ("delivered-30", 60, 30, "r2"), ("missing", 30, 30, "r1")]:
        execute("INSERT INTO client_order_lines(id,order_id,recipe_id,product_type_id,recipe_name,qty,kg_per_unit,total_kg) VALUES (%s,'o1',%s,'pt1',%s,%s,%s,%s)", (lid,rid,"KIRMIZI" if rid == "r1" else "GOLD",qty,kg,qty*kg))
        _wyrob(gid=lid, qty=qty, kg=kg)
        execute("UPDATE finished_goods SET recipe_id=%s WHERE id=%s", (rid,lid))
        if lid != "missing":
            execute("INSERT INTO order_pallet_items(id,pallet_id,order_line_id,qty) VALUES (%s,'p1',%s,%s)", (lid,lid,qty))
    result = finalize_loading("v1", ["o1"])
    assert result["orders"][0]["coverage"]["missing"][0]["missing_kg"] == 900
    docs = issue(result["loading_id"], kg=7150)
    export_documents("zagros", docs)
    assert docs["wm"]["kg"] == 7150
    assert docs["hdi_calosc"]["totals"]["qty"] == 297
    assert docs["hdi_calosc"]["totals"]["kg"] == 7150
    assert all(c["payload"]["gross_kg"] == 7150 for c in docs["cmr"])
    assert query_one("SELECT qty_available FROM finished_goods WHERE id='missing'")["qty_available"] == 30


def test_partial_requires_explicit_state_bound_confirmation_without_writes(db):
    seed()
    with pytest.raises(HTTPException) as e:
        loading.finalize_loading("v1", ["o1"], request_id="confirm")
    assert e.value.detail["code"] == "PARTIAL_LOADING_CONFIRMATION_REQUIRED"
    token = e.value.detail["confirmation_token"]
    assert query_all("SELECT id FROM loadings") == []
    assert query_all("SELECT id FROM hdi_documents") == []
    assert query_one("SELECT status FROM order_pallets WHERE id='p1'")["status"] == "loaded"
    execute("UPDATE order_pallet_items SET qty=100 WHERE id='i1'")
    with pytest.raises(HTTPException) as changed:
        loading.finalize_loading("v1", ["o1"], request_id="confirm", partial_confirmation=token)
    assert changed.value.detail["confirmation_token"] != token
    assert changed.value.detail["orders"][0]["coverage"]["missing"][0]["missing_qty"] == 60
    assert query_all("SELECT id FROM loadings") == []


@pytest.mark.parametrize("entry", ["wm", "hdi", "cmr", "legacy_wm", "manual_order", "generic_order"])
def test_no_scans_cannot_issue_new_documents(db, entry):
    seed()
    execute("UPDATE order_pallets SET status='created',loaded_vehicle_id=NULL WHERE id='p1'")
    from app.services.wz_service import create_wz_from_order, create_manual_wz, generate_wz
    calls = {"wm": lambda: documents.wystaw_wz_wewnetrzny("o1"),
             "hdi": lambda: hdi_service.generate_hdi("o1"),
             "cmr": lambda: cmr_service.generate_cmr("o1", {}),
             "legacy_wm": lambda: create_wz_from_order("o1"),
             "manual_order": lambda: create_manual_wz({"name": "POLAT"}, [{"stock_type": "fg", "stock_id": "f1", "qty": 160}], valued=False, order_id="o1"),
             "generic_order": lambda: generate_wz("order", "o1", {"name": "POLAT"}, [{"name": "KIRMIZI", "qty": 160, "unit": "szt"}], valued=False)}
    with pytest.raises(HTTPException):
        calls[entry]()
    assert query_all("SELECT id FROM wz_documents") == []
    assert query_all("SELECT id FROM hdi_documents") == []
    assert query_all("SELECT id FROM cmr_documents") == []
    assert query_all("SELECT id FROM stock_movements") == []


def test_excess_or_wrong_product_is_blocked_not_confirmable(db):
    seed(ordered=160, loaded=161)
    with pytest.raises(HTTPException) as error:
        loading.finalize_loading("v1", ["o1"])
    assert not isinstance(error.value.detail, dict)
    assert "nadmiar" in error.value.detail
    assert query_all("SELECT id FROM loadings") == []


def test_concurrent_issue_uses_one_set_of_numbers_and_movements(db):
    from concurrent.futures import ThreadPoolExecutor
    seed()
    kurs = finalize_loading("v1", ["o1"])["loading_id"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: issue(kurs), range(2)))
    assert results[0]["wm"]["id"] == results[1]["wm"]["id"]
    assert len(query_all("SELECT id FROM wz_documents")) == 1
    assert len(query_all("SELECT id FROM hdi_documents")) == 2
    assert len(query_all("SELECT id FROM cmr_documents")) == 2
    assert query_one("SELECT sum(qty) AS kg FROM stock_movements WHERE movement_type='OUT'")["kg"] == -2400


def test_later_shipment_has_separate_documents_and_finishes_remaining_order(db):
    seed()
    first = finalize_loading("v1", ["o1"])["loading_id"]
    first_docs = issue(first)
    old_hdi = query_one("SELECT * FROM hdi_documents WHERE id=%s", (first_docs["hdi_calosc"]["id"],))
    _paleta(pid="p2", nr=2)
    execute("INSERT INTO order_pallet_items(id,pallet_id,order_line_id,qty) VALUES ('i2','p2','o1-l1',40)")
    with pytest.raises(HTTPException, match="kolejny załadunek"):
        hdi_service.generate_hdi("o1")
    second = loading.finalize_loading("v1", ["o1"], plate="SECOND")
    assert second["orders"][0]["coverage"]["complete"] is True
    second_docs = issue(second["loading_id"], kg=800)
    export_documents("polat-second", second_docs)
    assert second_docs["wm"]["id"] != first_docs["wm"]["id"]
    assert second_docs["wm"]["kg"] == 800
    assert second_docs["pokrycie"]["pelne"] is True
    assert second_docs["pokrycie"]["kg_braku"] == 0
    assert first_docs["pokrycie"]["kg_braku"] == 800
    assert second_docs["hdi_calosc"]["totals"] == {"qty": 40, "kg": 800}
    assert query_one("SELECT * FROM hdi_documents WHERE id=%s", (first_docs["hdi_calosc"]["id"],)) == old_hdi
    assert query_one("SELECT status FROM client_orders WHERE id='o1'")["status"] == "done"
    assert query_one("SELECT sum(qty) AS kg FROM stock_movements WHERE movement_type='OUT'")["kg"] == -3200
    with pytest.raises(HTTPException, match="kilka kursów"):
        documents.wystaw_wz_wewnetrzny("o1")
    for kurs, expected in [(first, first_docs), (second["loading_id"], second_docs)]:
        detail = loading.zaladunek(kurs)
        row = detail["pozycje"][0]
        assert {d["id"] for d in row["hdi"]} == {expected["hdi_calosc"]["id"], expected["hdi_fv"]["id"]}
        assert {d["id"] for d in row["cmr"]} == {d["id"] for d in expected["cmr"]}


def test_atomic_document_failure_leaves_no_half_issued_stock_movement(db, monkeypatch):
    seed()
    kurs = finalize_loading("v1", ["o1"])["loading_id"]
    def fail(*args, **kwargs):
        raise HTTPException(409, "CMR failure")
    monkeypatch.setattr(cmr_service, "generate_cmr", fail)
    with pytest.raises(HTTPException):
        issue(kurs)
    assert query_all("SELECT id FROM wz_documents") == []
    assert query_all("SELECT id FROM stock_movements") == []
    assert query_one("SELECT qty_available FROM finished_goods WHERE id='f1'")["qty_available"] == 160


def test_nested_atomic_savepoint_rolls_back_only_caught_inner_error(db):
    @atomic_operation
    def operation():
        execute("INSERT INTO sequences(key,value) VALUES ('outer',1)")
        try:
            with transaction() as conn:
                cx_execute(conn, "INSERT INTO sequences(key,value) VALUES ('inner',1)")
                raise HTTPException(409, "caught")
        except HTTPException:
            pass
        execute("UPDATE sequences SET value=2 WHERE key='outer'")
    operation()
    assert query_one("SELECT value FROM sequences WHERE key='outer'")["value"] == 2
    assert query_one("SELECT value FROM sequences WHERE key='inner'") is None


@pytest.mark.parametrize("change", ["wrong_recipe", "wrong_stock", "unlinked", "wrong_status"])
def test_unresolved_or_wrong_qr_identity_blocks_departure_before_writes(db, change):
    seed(ordered=1, loaded=1)
    _sztuki("p1", "f1", ile=1, kg=20)
    sql = {"wrong_recipe": "UPDATE finished_units SET recipe_id='foreign' WHERE id='u1'",
           "wrong_stock": "UPDATE finished_goods SET kg_per_unit=30 WHERE id='f1'",
           "unlinked": "UPDATE finished_units SET source_finished_goods_id=NULL WHERE id='u1'",
           "wrong_status": "UPDATE finished_units SET status='created' WHERE id='u1'"}[change]
    execute(sql)
    with pytest.raises(HTTPException):
        loading.finalize_loading("v1", ["o1"])
    assert query_all("SELECT id FROM loadings") == []
    assert query_all("SELECT id FROM stock_movements") == []
    assert query_one("SELECT status FROM order_pallets WHERE id='p1'")["status"] == "loaded"


def test_two_customers_one_course_are_separate_and_rollback_together(db, monkeypatch):
    seed()
    execute("INSERT INTO clients(id,code,name) VALUES ('c2','ZAG','ZAGROS')")
    _zamowienie(oid="o2", order_no="ZAGROS/Z/1", cid="c2", qty=3, kg=30)
    execute("UPDATE client_orders SET client_name='ZAGROS' WHERE id='o2'")
    _wyrob(gid="f2", qty=3, kg=30, cid="c2")
    execute("UPDATE finished_goods SET client_name='ZAGROS' WHERE id='f2'")
    _paleta(pid="p2", oid="o2")
    execute("INSERT INTO order_pallet_items(id,pallet_id,order_line_id,qty) VALUES ('i2','p2','o2-l1',3)")
    kurs = finalize_loading("v1", ["o2", "o1"])["loading_id"]
    decisions = [{"order_id": "o1", "cel_kg": 1600, "invoice_no": "FV-POLAT", "hdi_fv": True},
                 {"order_id": "o2", "cel_kg": 90, "invoice_no": "FV-ZAGROS", "hdi_fv": True}]
    original = cmr_service.generate_cmr
    def fail_second(oid, *args, **kwargs):
        if oid == "o2":
            raise HTTPException(409, "second customer failure")
        return original(oid, *args, **kwargs)
    monkeypatch.setattr(cmr_service, "generate_cmr", fail_second)
    with pytest.raises(HTTPException):
        loading.wystaw_z_kursu(kurs, decisions, {})
    assert query_all("SELECT id FROM wz_documents") == []
    assert query_all("SELECT id FROM stock_movements") == []
    monkeypatch.setattr(cmr_service, "generate_cmr", original)
    docs = loading.wystaw_z_kursu(kurs, decisions, {})["orders"]
    assert [(d["order_id"], d["wm"]["kg"], d["invoice_data"]["invoice_kg"]) for d in docs] == [("o1", 2400, 1600), ("o2", 90, 90)]
    assert docs[0]["wz"]["kg"] == 800
    assert docs[1]["wz"] is None
    assert {l["stock_id"] for l in query_one("SELECT lines FROM wz_documents WHERE id=%s", (docs[1]["wm"]["id"],))["lines"]} == {"f2"}
    with pytest.raises(HTTPException):
        documents.anuluj_dokumenty_podzialu("o1")
    assert query_one("SELECT sum(qty) AS kg FROM stock_movements WHERE movement_type='OUT'")["kg"] == -2490
