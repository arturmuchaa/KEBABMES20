"""Sztuka wchodzi na magazyn tylko z partii, której paleta wyjechała na halę (plan A, zad. 4)."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services import seasoned_pallets_service as sp
from app.services.finished_units_service import generate_units_from_plan_line, scan_produced
from app.utils.ids import cuid
from tests.test_seasoned_pallets_wywoz_db import kod, linia, paleta, partia, plan

pytestmark = pytest.mark.usefixtures("db")


def _sztuka(line_id, batch_no=None):
    generate_units_from_plan_line(line_id)
    sql = "SELECT * FROM finished_units WHERE plan_line_id=%s"
    args = [line_id]
    if batch_no:
        sql += " AND batch_no=%s"; args.append(batch_no)
    return query_one(sql + " ORDER BY qr_seq LIMIT 1", tuple(args))


def _kod_sztuki(u):
    return "U|" + u["id"]


def test_sztuka_przed_wywozem_odbija():
    sm = partia(); paleta(sm); lid = linia(plan(), sm, qty=2)
    u = _sztuka(lid)
    with pytest.raises(HTTPException) as e:
        scan_produced(_kod_sztuki(u))
    assert e.value.status_code == 409
    assert "nie wyjechała na halę" in e.value.detail and "724" in e.value.detail
    assert query_one("SELECT status FROM finished_units WHERE id=%s", (u["id"],))["status"] == "planned"


def test_sztuka_po_wywozie_wchodzi():
    sm = partia(); p = paleta(sm); lid = linia(plan(), sm, qty=2)
    sp.take_pallet(kod(p))
    u = _sztuka(lid)
    out = scan_produced(_kod_sztuki(u))
    assert out["ok"] and out["status"] != "planned"


def test_plan_bez_gate_bez_zmian():
    sm = partia(); lid = linia(plan(gate=False), sm, qty=2)
    u = _sztuka(lid)
    assert scan_produced(_kod_sztuki(u))["ok"]


def test_sztuka_pm_wymaga_wszystkich_koncowek():
    a_sm, b_sm = partia("724", kg=24), partia("731", kg=19)
    a, b = paleta(a_sm, "724", kg=24), paleta(b_sm, "731", kg=19)
    pl = plan()
    lid = linia(pl, a_sm, qty=1, kg=40)
    execute("UPDATE production_plan_lines SET batch_allocation=%s::jsonb, seasoned_batch_nos=%s "
            "WHERE id=%s", ('{"PM12": {"pieces": 1, "kg": 40}}', ["724", "731"], lid))
    execute("INSERT INTO plan_line_pallets (plan_line_id, pallet_id) VALUES (%s,%s),(%s,%s)",
            (lid, a, lid, b))
    u = _sztuka(lid)
    assert u["batch_no"] == "PM12"
    sp.take_pallet(kod(a))
    with pytest.raises(HTTPException) as e:
        scan_produced(_kod_sztuki(u))
    assert e.value.status_code == 409
    sp.take_pallet(kod(b))
    assert scan_produced(_kod_sztuki(u))["ok"]
