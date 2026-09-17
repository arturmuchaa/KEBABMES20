"""Mięso dla panelu masowania: palety, partie i to, co zdjęły wsady."""
import pytest

from app.db import execute
from app.services import masownia_service as svc
from app.utils.ids import cuid

pytestmark = pytest.mark.usefixtures("db")


def _partia(lot_no, material="Mięso z/s", kg_free=1000.0, kg_reserved=0.0):
    ms_id = cuid()
    execute(
        "INSERT INTO meat_stock (id, lot_no, material_name, kg_initial, kg_available, "
        "kg_reserved, production_date, expiry_date) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        (ms_id, lot_no, material, kg_free + kg_reserved, kg_free + kg_reserved,
         kg_reserved, "2026-09-17", "2026-10-01"),
    )
    return ms_id


def _paleta(pallet_no, kg_net, lots):
    pid = cuid()
    execute(
        "INSERT INTO meat_pallets (id, pallet_no, target_kg, kg_net, containers, "
        "production_date, expiry_date) VALUES (%s,%s,%s,%s,%s,%s,%s)",
        (pid, pallet_no, kg_net, kg_net, 0, "2026-09-17", "2026-10-01"),
    )
    for i, (lot_no, kg) in enumerate(lots):
        execute(
            "INSERT INTO meat_pallet_lots (id, pallet_id, lot_no, kg, seq) VALUES (%s,%s,%s,%s,%s)",
            (cuid(), pid, lot_no, kg, i),
        )
    return pid


def test_zwraca_palety_i_partie():
    _partia("511")
    _paleta("PAL/17/09/26/1", 200, [("511", 200)])
    out = svc.list_meat()
    assert [p["pallet_no"] for p in out["pallets"]] == ["PAL/17/09/26/1"]
    assert [l["lot_no"] for l in out["lots"]] == ["511"]


def test_partia_kupiona_z_zewnatrz_tez_jest_na_liscie():
    # Filet z mostka i indyk nie przechodzą przez rozbiór i nie jadą na paletach,
    # a mimo to je mieszamy — muszą być widoczne.
    _partia("524", material="Filet z mostka wołowego", kg_free=600.0)
    out = svc.list_meat()
    assert any(l["material_name"] == "Filet z mostka wołowego" for l in out["lots"])


def test_partia_w_calosci_zarezerwowana_NIE_znika():
    # Partia 524 na produkcji: kg_available=0 przy kg_reserved=600, bo biuro
    # zaplanowało ją w całości. Panel MUSI ją pokazać.
    _partia("524", material="Filet z mostka wołowego", kg_free=0.0, kg_reserved=600.0)
    out = svc.list_meat()
    assert [l["lot_no"] for l in out["lots"]] == ["524"]


def test_wsad_zdejmuje_kilogramy_z_palety():
    _partia("511")
    pid = _paleta("PAL/17/09/26/1", 200, [("511", 200)])
    ch = cuid()
    execute(
        "INSERT INTO mixing_charges (id, order_id, machine_id, kg_meat, status) "
        "VALUES (%s, NULL, 1, 140, 'mixing')",
        (ch,),
    )
    execute(
        "INSERT INTO mixing_charge_pallets (id, charge_id, pallet_id, lot_no, kg) "
        "VALUES (%s,%s,%s,%s,%s)",
        (cuid(), ch, pid, "511", 140),
    )
    assert svc.list_meat()["taken"][pid] == 140.0


def test_wsad_anulowany_oddaje_palete():
    _partia("511")
    pid = _paleta("PAL/17/09/26/1", 200, [("511", 200)])
    ch = cuid()
    execute(
        "INSERT INTO mixing_charges (id, order_id, machine_id, kg_meat, status) "
        "VALUES (%s, NULL, 1, 140, 'cancelled')",
        (ch,),
    )
    execute(
        "INSERT INTO mixing_charge_pallets (id, charge_id, pallet_id, lot_no, kg) "
        "VALUES (%s,%s,%s,%s,%s)",
        (cuid(), ch, pid, "511", 140),
    )
    assert svc.list_meat()["taken"] == {}


def test_paleta_zdjeta_nie_istnieje_dla_hali():
    _partia("511")
    pid = _paleta("PAL/17/09/26/9", 200, [("511", 200)])
    execute("UPDATE meat_pallets SET deleted_at=now() WHERE id=%s", (pid,))
    assert svc.list_meat()["pallets"] == []
