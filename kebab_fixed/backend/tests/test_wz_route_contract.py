"""Kontrakt route /api/wz/manual — cienka warstwa, która potrafi zgubić pole.

Regresja z produkcji 2026-07-29: serwis i frontend miały palety, ale route
ich nie przepisywał z body do serwisu, więc `wz_documents.pallets_h1` zawsze
wynosiło 0 i saldo pojemników nie widziało palet. Testy serwisu tego nie
łapały, bo wołały `create_manual_wz` bezpośrednio.
"""
from app.routes import wz as route


def test_route_przepisuje_palety_do_serwisu(monkeypatch):
    seen = {}
    monkeypatch.setattr(route.svc, "create_manual_wz", lambda **kw: seen.update(kw) or {})
    route.manual({
        "buyer": {"name": "GRASO", "nip": "6443579858"},
        "items": [{"stockType": "byproduct", "stockId": "lot1", "name": "Kości",
                   "unit": "kg", "qty": 100, "containers": 233}],
        "palletsH1": 7, "palletsOther": 2,
    })
    assert seen["pallets_h1"] == 7
    assert seen["pallets_other"] == 2


def test_route_bez_palet_daje_zera(monkeypatch):
    seen = {}
    monkeypatch.setattr(route.svc, "create_manual_wz", lambda **kw: seen.update(kw) or {})
    route.manual({"buyer": {"name": "X"}, "items": []})
    assert seen["pallets_h1"] == 0 and seen["pallets_other"] == 0


def test_route_przepisuje_pojemniki_pozycji(monkeypatch):
    seen = {}
    monkeypatch.setattr(route.svc, "create_manual_wz", lambda **kw: seen.update(kw) or {})
    route.manual({"buyer": {"name": "X"},
                  "items": [{"stockType": "raw", "stockId": "rb1", "containers": 225}]})
    assert seen["selections"][0]["containers"] == 225
