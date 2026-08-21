"""Kontrakt route dostawców — cienka warstwa API (bez DB, monkeypatch serwisu).

Auth middleware blokuje surowy TestClient, więc wołamy funkcje routera wprost,
jak pozostałe testy API w tym projekcie.
"""
from app.routes import suppliers as route


def test_uklad_palety_idzie_do_serwisu_jako_liczba(monkeypatch):
    zapisane = {}
    monkeypatch.setattr(route.svc, "set_containers_per_pallet",
                        lambda sid, v: zapisane.update(id=sid, value=v) or {"id": sid})

    route.set_pallet_layout("sup1", {"containersPerPallet": 32})

    assert zapisane == {"id": "sup1", "value": 32}


def test_brak_wartosci_czysci_uklad_dostawcy(monkeypatch):
    zapisane = {}
    monkeypatch.setattr(route.svc, "set_containers_per_pallet",
                        lambda sid, v: zapisane.update(id=sid, value=v) or {"id": sid})

    route.set_pallet_layout("sup1", {"containersPerPallet": None})

    assert zapisane == {"id": "sup1", "value": None}
