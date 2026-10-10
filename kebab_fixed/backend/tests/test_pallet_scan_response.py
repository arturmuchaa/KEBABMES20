"""Skan i potwierdzony stan auta wracają w tym samym POST — bez drugiego RTT."""
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.models.orders import PalletScanRequest
from app.routes import pallets
from app.services import vehicle_loading_service


def request():
    return Request({"type": "http", "state": {}})


@pytest.mark.parametrize("action,include,vehicle,expected", [
    ("loaded", True, "v1", True), ("undo", True, "v1", True),
    ("loaded", False, "v1", False), ("cold_storage", True, "v1", False),
    ("loaded", True, "", False),
])
def test_snapshot_is_opt_in_after_successful_write(monkeypatch, action, include, vehicle, expected):
    events = []
    def scan(*args, **kwargs):
        events.append("commit")
        return {"id": "p1", "result": "SUCCESS"}
    def snapshot(vid):
        assert events == ["commit"]
        events.append("snapshot")
        return {"vehicle": {"id": vid}, "totals": {"loaded_pallets": 1}}
    monkeypatch.setattr(pallets.pallets_service, "scan", scan)
    monkeypatch.setattr(vehicle_loading_service, "vehicle_state", snapshot)
    out = pallets.scan(PalletScanRequest(code="PAL|o1|12", action=action,
        vehicle_id=vehicle, include_vehicle_state=include), request())
    assert ("vehicle_state" in out) == expected
    assert out["result"] == "SUCCESS"
    assert events == (["commit", "snapshot"] if expected else ["commit"])


def test_rejected_scan_does_not_read_snapshot(monkeypatch):
    monkeypatch.setattr(pallets.pallets_service, "scan", Mock(side_effect=HTTPException(409, "WRONG_ORDER")))
    snapshot = Mock()
    monkeypatch.setattr(vehicle_loading_service, "vehicle_state", snapshot)
    with pytest.raises(HTTPException):
        pallets.scan(PalletScanRequest(code="PAL|o1|12", action="loaded",
            vehicle_id="v1", include_vehicle_state=True), request())
    snapshot.assert_not_called()


def test_snapshot_failure_does_not_turn_committed_scan_into_error(monkeypatch):
    write = Mock(return_value={"id": "p1", "result": "SUCCESS"})
    monkeypatch.setattr(pallets.pallets_service, "scan", write)
    monkeypatch.setattr(vehicle_loading_service, "vehicle_state", Mock(side_effect=RuntimeError("read failed")))
    out = pallets.scan(PalletScanRequest(code="PAL|o1|12", action="loaded",
        vehicle_id="v1", include_vehicle_state=True), request())
    assert out == {"id": "p1", "result": "SUCCESS"}
    write.assert_called_once()  # bez retry operacji zapisu


def test_stock_carton_scan_also_returns_confirmed_vehicle_state(db):
    from tests.test_stock_carton_link_db import _baza, _fg_niczyj, _karton, _zamowienie, _fg_i_ruchy
    from app.services import stock_carton_link_service

    _baza(); _fg_niczyj(qty=2)
    carton = _karton("fast", lines=((30, 2),))
    _zamowienie(qty=2, kg=30)
    stock_carton_link_service.assign(carton["id"], "o1", "test")
    vehicle_loading_service.add_order("v1", "o1")
    before = _fg_i_ruchy()
    dto = PalletScanRequest(code=f"SCARTON|{carton['id']}", action="loaded",
        vehicle_id="v1", include_vehicle_state=True)
    for expected in ("SUCCESS", "ALREADY_SCANNED"):
        out = pallets.scan(dto, request())
        assert out["result"] == expected
        assert out["vehicle_state"]["totals"]["loaded_pallets"] == 1
        assert out["vehicle_state"]["totals"]["loaded_kg"] == 60
        assert out["vehicle_state"]["orders"][0]["pallets"][0]["id"] == carton["id"]
        assert _fg_i_ruchy() == before
