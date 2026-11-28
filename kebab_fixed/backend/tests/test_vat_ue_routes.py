"""Kontrakt tras /api/vat-ue — wołamy funkcje routera wprost (auth blokuje TestClient)."""
from types import SimpleNamespace

from app.routes import vat_ue as route


def _req(login="biuro"):
    return SimpleNamespace(state=SimpleNamespace(subject={"login": login}))


def test_sprawdz_klienta_przekazuje_kontekst_i_operatora(monkeypatch):
    wolania = {}
    monkeypatch.setattr(route.svc, "sprawdz_klienta", lambda cid, **kw: wolania.update(cid=cid, **kw) or {"ok": 1})
    monkeypatch.setattr(route, "_subject_label", lambda s: "Biuro")
    route.sprawdz_klienta("c1", {"order_id": "o1", "context": "wz"}, _req())
    assert wolania == {"cid": "c1", "context": "wz", "order_id": "o1", "wz_id": None, "operator": "Biuro"}


def test_sprawdz_klienta_domyslnie_reczne(monkeypatch):
    wolania = {}
    monkeypatch.setattr(route.svc, "sprawdz_klienta", lambda cid, **kw: wolania.update(kw) or {})
    monkeypatch.setattr(route, "_subject_label", lambda s: "")
    route.sprawdz_klienta("c1", None, _req())
    assert wolania["context"] == "reczne"


def test_kontekst_spoza_listy_to_reczne(monkeypatch):
    wolania = {}
    monkeypatch.setattr(route.svc, "sprawdz_klienta", lambda cid, **kw: wolania.update(kw) or {})
    monkeypatch.setattr(route, "_subject_label", lambda s: "")
    route.sprawdz_klienta("c1", {"context": "cokolwiek"}, _req())
    assert wolania["context"] == "reczne"


def test_sprawdz_kurs_i_historia(monkeypatch):
    monkeypatch.setattr(route.svc, "sprawdz_kurs", lambda lid, operator="": [{"lid": lid, "op": operator}])
    monkeypatch.setattr(route.svc, "historia", lambda cid: [{"cid": cid}])
    monkeypatch.setattr(route, "_subject_label", lambda s: "Biuro")
    assert route.sprawdz_kurs("k1", _req()) == [{"lid": "k1", "op": "Biuro"}]
    assert route.historia("c1") == [{"cid": "c1"}]


def test_trasy_zarejestrowane():
    from app.main import app
    sciezki = {r.path for r in app.routes}
    assert "/api/vat-ue/sprawdz-klienta/{client_id}" in sciezki
    assert "/api/vat-ue/sprawdz-kurs/{loading_id}" in sciezki
    assert "/api/vat-ue/historia/{client_id}" in sciezki
