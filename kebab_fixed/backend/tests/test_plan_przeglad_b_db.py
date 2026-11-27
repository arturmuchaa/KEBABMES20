"""Poprawki po przeglądzie planu B (I2–I4): edycja aktywnego planu w trakcie dnia.

Zmiana planu po wydruku etykiet nie może przejść po cichu — serwer sam,
w tej samej transakcji co zapis, dopasowuje sztuki i mówi, które etykiety
są do przedruku, a które do wyrzucenia.
"""
import threading

import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one, raw_connection
from app.models.production import ProductionPlanCreate
from app.services import finished_units_service as fu
from app.services import production_plans_service as svc
from tests.test_plan_palety_zapis_db import DZIEN, paleta, partia, pozycja, receptury  # noqa: F401

pytestmark = pytest.mark.usefixtures("db")


def _aktywny(*pozycje):
    plan = svc.create_plan(ProductionPlanCreate(planDate=DZIEN, palletGate=True, lines=list(pozycje)))
    svc.update_plan_status(plan["id"], "active")
    for ln in plan["lines"]:
        fu.generate_units_from_plan_line(ln["id"])
    fu.mark_labels_printed([u["id"] for u in fu.units_for_plan(plan["id"])])
    return plan


def _dto(*pozycje):
    return ProductionPlanCreate(planDate=DZIEN, lines=list(pozycje))


def _palety_pozycji(line_id):
    return [r["pallet_id"] for r in query_all(
        "SELECT pallet_id FROM plan_line_pallets WHERE plan_line_id=%s ORDER BY position", (line_id,))]


def test_rozpoczeta_pozycja_przyjmuje_dolozona_palete():
    sm = partia()
    p1, p2 = paleta(sm, kg=600.0), paleta(sm, kg=598.0)
    plan = _aktywny(pozycja([p1], qty=10))
    lid = plan["lines"][0]["id"]
    execute("UPDATE production_plan_lines SET qty_done=3 WHERE id=%s", (lid,))
    svc.update_plan(plan["id"], _dto(pozycja([p1, p2], qty=10, id=lid)))
    assert _palety_pozycji(lid) == [p1, p2]


def test_rozpoczeta_pozycja_nie_gubi_palet_po_cichu():
    sm = partia()
    p1, p2 = paleta(sm, kg=600.0), paleta(sm, kg=598.0)
    plan = _aktywny(pozycja([p1], qty=10))
    lid = plan["lines"][0]["id"]
    execute("UPDATE production_plan_lines SET qty_done=3 WHERE id=%s", (lid,))
    with pytest.raises(HTTPException) as e:
        svc.update_plan(plan["id"], _dto(pozycja([p2], qty=10, id=lid)))
    assert e.value.status_code == 400 and "nie można z niej zdejmować" in e.value.detail
    assert _palety_pozycji(lid) == [p1]


def test_zmiana_partii_aktywnego_planu_synchronizuje_sztuki_na_serwerze():
    p1 = paleta(partia("724"), kg=600.0)
    p2 = paleta(partia("725", kg=600.0), batch_no="725", kg=600.0)
    plan = _aktywny(pozycja([p1], qty=10))
    lid = plan["lines"][0]["id"]
    out = svc.update_plan(plan["id"], _dto(pozycja([p2], qty=10, id=lid)))
    assert len(out["unitsSync"]["reprint"]) == 10
    rows = query_all("SELECT batch_no, label_printed_at FROM finished_units WHERE plan_line_id=%s", (lid,))
    assert {r["batch_no"] for r in rows} == {"725"} and all(r["label_printed_at"] is None for r in rows)


def test_zmiana_wagi_po_wydruku_do_przedruku():
    p1 = paleta(partia("724"), kg=600.0)
    plan = _aktywny(pozycja([p1], qty=10))
    lid = plan["lines"][0]["id"]
    out = svc.update_plan(plan["id"], _dto(pozycja([p1], qty=10, kg=35, id=lid)))
    assert len(out["unitsSync"]["reprint"]) == 10
    assert {float(r["weight_kg"]) for r in query_all("SELECT weight_kg FROM finished_units WHERE plan_line_id=%s", (lid,))} == {35.0}


def test_zmniejszenie_ilosci_nazywa_wyrzucone_etykiety():
    p1 = paleta(partia("724"), kg=600.0)
    plan = _aktywny(pozycja([p1], qty=10))
    lid = plan["lines"][0]["id"]
    out = svc.update_plan(plan["id"], _dto(pozycja([p1], qty=8, id=lid)))
    assert sorted(x["qrSeq"] for x in out["unitsSync"]["invalidated"]) == [9, 10]
    assert query_one("SELECT count(*) AS n FROM finished_units WHERE plan_line_id=%s", (lid,))["n"] == 8


def test_usunieta_pozycja_kasuje_sztuki_i_nazywa_etykiety():
    sm = partia()
    p1, p2 = paleta(sm, kg=600.0), paleta(sm, kg=598.0)
    plan = _aktywny(pozycja([p1], qty=5), pozycja([p2], qty=3))
    l1, l2 = plan["lines"]
    out = svc.update_plan(plan["id"], _dto(pozycja([p1], qty=5, id=l1["id"])))
    assert len(out["unitsSync"]["invalidated"]) == 3
    assert query_one("SELECT count(*) AS n FROM finished_units WHERE plan_line_id=%s", (l2["id"],))["n"] == 0


def test_nowa_pozycja_aktywnego_planu_dostaje_sztuki_od_razu():
    sm = partia()
    p1, p2 = paleta(sm, kg=600.0), paleta(sm, kg=598.0)
    plan = _aktywny(pozycja([p1], qty=5))
    l1 = plan["lines"][0]
    out = svc.update_plan(plan["id"], _dto(pozycja([p1], qty=5, id=l1["id"]), pozycja([p2], qty=4)))
    assert out["unitsSync"]["added"] == 4
    assert len(fu.units_for_plan(plan["id"])) == 9


def test_zeskanowana_sztuka_zamraza_pozycje():
    sm = partia()
    p1, p2 = paleta(sm, kg=600.0), paleta(sm, kg=598.0)
    plan = _aktywny(pozycja([p1], qty=10))
    lid = plan["lines"][0]["id"]
    execute("UPDATE finished_units SET status='produced' WHERE plan_line_id=%s AND qr_seq=1", (lid,))
    with pytest.raises(HTTPException) as e:
        svc.update_plan(plan["id"], _dto(pozycja([p2], qty=10, id=lid)))
    assert "nie można z niej zdejmować" in e.value.detail
    assert query_one("SELECT count(*) AS n FROM finished_units WHERE plan_line_id=%s", (lid,))["n"] == 10


def test_dopasowanie_ilosci_nie_kasuje_sztuki_zeskanowanej_w_tej_chwili():
    """Skan na hali trzyma wiersz sztuki; dopasowanie ilości czeka i jej nie kasuje."""
    p1 = paleta(partia("724"), kg=600.0)
    plan = _aktywny(pozycja([p1], qty=10))
    lid = plan["lines"][0]["id"]
    execute("UPDATE production_plan_lines SET qty=8 WHERE id=%s", (lid,))
    ostatnia = query_one("SELECT id FROM finished_units WHERE plan_line_id=%s AND qr_seq=10", (lid,))["id"]
    with raw_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM finished_units WHERE id=%s FOR UPDATE", (ostatnia,))
        cur.execute("UPDATE finished_units SET status='produced' WHERE id=%s", (ostatnia,))
        t = threading.Thread(target=lambda: fu.generate_units_from_plan_line(lid))
        t.start()
        t.join(1.5)
        conn.commit()
        t.join(10)
    assert query_one("SELECT status FROM finished_units WHERE id=%s", (ostatnia,))["status"] == "produced"
