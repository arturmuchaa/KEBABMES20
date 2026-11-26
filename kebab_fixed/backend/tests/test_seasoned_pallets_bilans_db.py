"""Biuro potwierdza plan dopiero po zwrotach palet + bilans partii (plan A, zad. 6).

Przykład z rozmowy z właścicielem 26.11.2026: paleta 724 598 kg, 14 × 40 kg
zrobione, końcówka 24 kg → strata 598 − 560 − 24 = 14 kg.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.services import production_plans_service as pps
from app.services import seasoned_pallets_service as sp
from app.services.finished_units_service import generate_units_from_plan_line, scan_produced
from tests.test_seasoned_pallets_wywoz_db import kod, linia, paleta, partia, plan

pytestmark = pytest.mark.usefixtures("db")


def _dzien(kg_palety=598.0, sztuk=14, kg_sztuki=40, gate=True, zwrot=24.0, wywiez=True):
    sm = partia(kg=kg_palety)
    p = paleta(sm, kg=kg_palety)
    pl = plan(gate=gate)
    lid = linia(pl, sm, qty=sztuk, kg=kg_sztuki)
    generate_units_from_plan_line(lid)
    if wywiez and gate:
        sp.take_pallet(kod(p))
    for u in query_all("SELECT id FROM finished_units WHERE plan_line_id=%s", (lid,)):
        scan_produced("U|" + u["id"])
    if zwrot is not None and wywiez and gate:
        sp.return_pallet(kod(p), zwrot)
    pps.tablet_finish(pl, [{
        "planLineId": lid, "qty": sztuk, "workerNames": ["Jan"], "kgPerUnit": kg_sztuki,
        "recipeId": "r-kirmizi", "recipeName": "KIRMIZI", "seasonedBatchNos": ["724"],
    }])
    return sm, p, pl


def test_bilans_palety_724():
    sm, _, pl = _dzien()
    pps.office_confirm(pl)
    [b] = query_all("SELECT * FROM plan_batch_balance WHERE plan_id=%s", (pl,))
    assert b["batch_no"] == "724"
    assert float(b["kg_in"]) == 598.0
    assert float(b["kg_goods"]) == 560.0
    assert float(b["kg_returned"]) == 24.0
    assert float(b["kg_loss"]) == 14.0
    assert float(query_one("SELECT kg_available FROM seasoned_meat WHERE id=%s", (sm,))["kg_available"]) == 24.0
    ruchy = query_all("SELECT * FROM stock_movements WHERE batch_id=%s AND source_type='reconcile'", (sm,))
    assert ruchy, "korekta stanu ma zostawić ślad w ruchach magazynowych"
    out = pps_balance(pl)
    assert out[0]["kgLoss"] == 14.0


def pps_balance(plan_id):
    return sp.plan_balance(plan_id)


def test_brak_zwrotu_blokuje_potwierdzenie():
    _, _, pl = _dzien(zwrot=None)
    with pytest.raises(HTTPException) as e:
        pps.office_confirm(pl)
    assert e.value.status_code == 409 and "nie ma zwrotu końcówki" in e.value.detail
    assert query_one("SELECT status FROM production_plans WHERE id=%s", (pl,))["status"] != "done"


def test_plan_bez_gate_potwierdza_jak_dzis():
    _, _, pl = _dzien(gate=False)
    pps.office_confirm(pl)
    assert query_one("SELECT status FROM production_plans WHERE id=%s", (pl,))["status"] == "done"
    assert query_all("SELECT * FROM plan_batch_balance WHERE plan_id=%s", (pl,)) == []


def test_zwrot_zero_zamyka_partie():
    sm, _, pl = _dzien(kg_palety=560.0, zwrot=0.0)
    pps.office_confirm(pl)
    row = query_one("SELECT kg_available, status FROM seasoned_meat WHERE id=%s", (sm,))
    assert float(row["kg_available"]) == 0.0 and row["status"] == "closed"


def test_rezerwacja_innego_planu_czytelny_blad():
    sm, _, pl = _dzien()
    execute("UPDATE seasoned_meat SET kg_reserved=100 WHERE id=%s", (sm,))
    out = pps.office_confirm(pl)
    assert "724" in out["balanceError"] and "zarezerwowane" in out["balanceError"]


def test_blokade_wlacza_sie_tylko_w_szkicu():
    szkic = plan(gate=False, status="draft")
    assert pps.set_pallet_gate(szkic, True)["palletGate"] is True
    assert query_one("SELECT pallet_gate FROM production_plans WHERE id=%s", (szkic,))["pallet_gate"]
    aktywny = plan(gate=False, status="active")
    with pytest.raises(HTTPException) as e:
        pps.set_pallet_gate(aktywny, True)
    assert e.value.status_code == 409


def test_trasy_bilansu_i_blokady():
    from app.main import app
    paths = {r.path for r in app.routes}
    assert "/api/production-plans/{plan_id}/balance" in paths
    assert "/api/production-plans/{plan_id}/pallet-gate" in paths
