"""Kontrakt routes pojemników — czysta warstwa API (bez DB, monkeypatch serwisów).

Auth middleware blokuje surowy TestClient, więc testujemy funkcje routera
bezpośrednio — tak jak pozostałe testy API w tym projekcie.
"""
from app.models.containers import (
    ContainerDocCreate,
    ContainerGroupCorrect,
    ContainerMovementCreate,
)
from app.routes import containers as route


def test_calibers_zwraca_15_20_i_niekalibrowany():
    out = route.list_calibers()
    assert [c["value"] for c in out] == ["15", "20", "none"]
    assert out[2]["kg"] is None
    assert out[0]["label"] == "15 kg"


def test_asset_types_w_odpowiedzi_kalibrow():
    out = route.list_calibers()
    assert all("label" in c and "kg" in c for c in out)


def test_doc_create_mapuje_camel_case():
    dto = ContainerDocCreate.model_validate({
        "partnerId": "p1", "docDate": "2026-07-29", "driver": "Jan", "vehicle": "KR 1",
        "lines": [{"assetType": "e2", "inQty": 400, "outQty": 0}], "notes": "uwaga",
    })
    assert dto.partner_id == "p1"
    assert dto.lines[0].asset_type == "e2"
    assert dto.lines[0].in_qty == 400


def test_group_correct_mapuje_camel_case():
    dto = ContainerGroupCorrect.model_validate({
        "partnerId": "p1", "sourceType": "wz", "sourceId": "wz1",
        "targets": {"e2": -58}, "confirm": True,
    })
    assert dto.source_type == "wz" and dto.confirm is True


def test_movement_create_przyjmuje_ujemna_ilosc():
    dto = ContainerMovementCreate.model_validate({
        "partnerId": "p1", "assetType": "e2", "qty": -25, "movementDate": "2026-07-29",
    })
    assert dto.qty == -25


def test_balances_przekazuje_filtry_do_serwisu(monkeypatch):
    seen = {}
    monkeypatch.setattr(route.ledger, "balances",
                        lambda q="", nonzero=False: seen.update(q=q, nonzero=nonzero) or [])
    route.list_balances(q="koko", nonzero=True)
    assert seen == {"q": "koko", "nonzero": True}


def test_statement_przekazuje_zakres_dat(monkeypatch):
    seen = {}
    monkeypatch.setattr(route.ledger, "statement",
                        lambda pid, f, t: seen.update(pid=pid, f=f, t=t) or {})
    route.get_statement(partner_id="p1", date_from="2026-07-01", date_to="2026-07-31")
    assert seen == {"pid": "p1", "f": "2026-07-01", "t": "2026-07-31"}
