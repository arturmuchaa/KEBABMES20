"""Stan etykiet sztuk i palet, teoria i czas masowania palety (plan B, zad. 3).

Biuro drukuje etykiety wieczorem z PROTRIMA. Zmiana partii po wydruku nie
może przejść po cichu — sztuki wracają na listę „do przedruku”.
"""
import pytest

from app.db import execute, query_all, query_one
from app.models.masownia import ChargeCreate, ChargeFinish, ChargeMeatDto, SpiceWeighDto
from app.models.production import PlanLineCreate, ProductionPlanCreate
from app.routes.seasoned_pallets import list_pallets
from app.services import finished_units_service as fu
from app.services import masownia_service as mas
from app.services import production_plans_service as svc
from app.services import seasoned_pallets_service as sp
from tests.test_plan_palety_zapis_db import DZIEN, paleta, partia, pozycja, receptury  # noqa: F401
from tests.test_seasoned_pallets_masownia_db import _partia as surowiec, _zlecenie

pytestmark = pytest.mark.usefixtures("db")


def _plan_dwie_pozycje():
    a = paleta(partia("724"), kg=600.0)
    b = paleta(partia("725", kg=600.0), batch_no="725", kg=600.0)
    plan = svc.create_plan(ProductionPlanCreate(planDate=DZIEN, palletGate=True, lines=[
        pozycja([a], qty=3), pozycja([b], qty=2)]))
    for ln in plan["lines"]:
        fu.generate_units_from_plan_line(ln["id"])
    return plan, a, b


def test_sztuki_planu_w_kolejnosci_pozycji_i_palet():
    plan, _, _ = _plan_dwie_pozycje()
    out = fu.units_for_plan(plan["id"])
    assert [(u["linePosition"], u["qrSeq"]) for u in out] == [(1, 1), (1, 2), (1, 3), (2, 1), (2, 2)]
    assert [u["batchNo"] for u in out] == ["724"] * 3 + ["725"] * 2
    assert all(u["labelPrintedAt"] is None for u in out)
    assert out[0]["qrCode"].startswith("U|") and out[0]["recipeName"] == "KIRMIZI"
    assert out[0]["weightKg"] == 40.0


def test_oznaczenie_wydruku_tylko_dla_planned():
    plan, _, _ = _plan_dwie_pozycje()
    ids = [u["id"] for u in fu.units_for_plan(plan["id"])][:3]
    execute("UPDATE finished_units SET status='produced' WHERE id=%s", (ids[0],))
    assert fu.mark_labels_printed(ids) == {"marked": 2}
    druk = {r["id"]: r["label_printed_at"] for r in query_all(
        "SELECT id, label_printed_at FROM finished_units WHERE id = ANY(%s)", (ids,))}
    assert druk[ids[0]] is None and druk[ids[1]] is not None


def test_zmiana_partii_po_wydruku_wraca_do_przedruku():
    a = paleta(partia("724"), kg=600.0)
    b = paleta(partia("725", kg=600.0), batch_no="725", kg=600.0)
    plan = svc.create_plan(ProductionPlanCreate(planDate=DZIEN, palletGate=True, lines=[pozycja([a], qty=10)]))
    lid = plan["lines"][0]["id"]
    fu.generate_units_from_plan_line(lid)
    fu.mark_labels_printed([u["id"] for u in fu.units_for_plan(plan["id"])])
    svc.update_plan(plan["id"], ProductionPlanCreate(planDate=DZIEN, lines=[pozycja([b], qty=10, id=lid)]))
    out = fu.generate_units_from_plan_line(lid)
    assert len(out["reprint"]) == 10
    rows = query_all("SELECT batch_no, label_printed_at FROM finished_units WHERE plan_line_id=%s", (lid,))
    assert {r["batch_no"] for r in rows} == {"725"}
    assert all(r["label_printed_at"] is None for r in rows)


def test_zmiana_ilosci_przed_produkcja_dopisuje_i_usuwa_sztuki():
    a = paleta(partia("724"), kg=600.0)
    plan = svc.create_plan(ProductionPlanCreate(planDate=DZIEN, palletGate=True, lines=[pozycja([a], qty=10)]))
    lid = plan["lines"][0]["id"]
    fu.generate_units_from_plan_line(lid)
    svc.update_plan(plan["id"], ProductionPlanCreate(planDate=DZIEN, lines=[pozycja([a], qty=12, id=lid)]))
    out = fu.generate_units_from_plan_line(lid)
    assert out["added"] == 2
    seqs = [r["qr_seq"] for r in query_all(
        "SELECT qr_seq FROM finished_units WHERE plan_line_id=%s ORDER BY qr_seq", (lid,))]
    assert seqs == list(range(1, 13))
    svc.update_plan(plan["id"], ProductionPlanCreate(planDate=DZIEN, lines=[pozycja([a], qty=9, id=lid)]))
    out = fu.generate_units_from_plan_line(lid)
    assert out["removed"] == 3
    seqs = [r["qr_seq"] for r in query_all(
        "SELECT qr_seq FROM finished_units WHERE plan_line_id=%s ORDER BY qr_seq", (lid,))]
    assert seqs == list(range(1, 10))


def test_paleta_z_masownicy_ma_teorie_i_czas_masowania():
    oid, ms = _zlecenie(), surowiec("511")
    ch = mas.load_charge(ChargeCreate(orderId=oid, machineId=1, waterL=10, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=240)], spices=[
        SpiceWeighDto(seq=1, name="Sól", unit="kg", qty=6, weighed=6),
        SpiceWeighDto(seq=2, name="Pieprz", unit="g", qty=500, weighed=0)]))
    mas.start_charge(ch["id"])
    out = mas.finish_charge(ch["id"], ChargeFinish(kgOutput=255))
    p = query_one("SELECT * FROM seasoned_pallets WHERE id=%s", (out["pallet_id"],))
    charge = query_one("SELECT finished_at FROM mixing_charges WHERE id=%s", (ch["id"],))
    assert float(p["kg_theory"]) == 256.5
    assert p["mixed_at"] == charge["finished_at"]
    execute("UPDATE seasoned_pallets SET status='on_hall' WHERE id=%s", (p["id"],))
    k = sp.return_pallet(p["id"], 30)
    kon = query_one("SELECT * FROM seasoned_pallets WHERE parent_id=%s", (p["id"],))
    assert kon["mixed_at"] == charge["finished_at"]
    assert kon["kg_theory"] is None
    assert k


def test_lista_palet_pokazuje_plany_z_paleta():
    a = paleta(partia("724"), kg=600.0)
    plan = svc.create_plan(ProductionPlanCreate(planDate=DZIEN, palletGate=True, lines=[pozycja([a], qty=10)]))
    [p] = [x for x in list_pallets(status="in_cold")["data"] if x["id"] == a]
    assert p["planIds"] == [plan["id"]]
    assert p["expiryDate"] == "2026-12-05"
    assert "materialName" in p and "mixedAt" in p and "kgTheory" in p
    assert sp.mark_pallet_labels_printed([a]) == {"marked": 1}
    [p] = [x for x in list_pallets(status="in_cold")["data"] if x["id"] == a]
    assert p["labelPrintedAt"] is not None
