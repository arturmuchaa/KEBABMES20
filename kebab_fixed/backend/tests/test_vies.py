"""Regresja VIES: ważny numer = aktywny; chwilowa niedostępność (MS_UNAVAILABLE)
NIE może być pokazywana jako 'nieaktywny'; zdublowany prefiks kraju normalizowany."""
import json

import pytest
from fastapi import HTTPException

from app.services import vies_service as svc


class _Resp:
    def __init__(self, data):
        self._d = data

    def read(self):
        return json.dumps(self._d).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture(autouse=True)
def _bez_nipu_zakladu(monkeypatch):
    """Testy bez bazy: NIP zakładu (zapytujący) podajemy wprost."""
    monkeypatch.setattr(svc, "_nip_zakladu", lambda: "")


def test_normalize_strips_double_country_prefix():
    assert svc._normalize_vat("DEDE129274202") == ("DE", "129274202")
    assert svc._normalize_vat("DE 129 274 202") == ("DE", "129274202")
    assert svc._normalize_vat("IE6388047V") == ("IE", "6388047V")


def test_valid_vat_is_active(monkeypatch):
    monkeypatch.setattr(svc.urllib.request, "urlopen",
                        lambda *a, **k: _Resp({"isValid": True, "userError": "VALID",
                                               "name": "GOOGLE IRELAND LIMITED", "address": "DUBLIN"}))
    out = svc.vies_lookup("IE6388047V")
    assert out["valid"] is True
    assert out["traderName"] == "GOOGLE IRELAND LIMITED"


def test_masked_name_dashes_removed(monkeypatch):
    monkeypatch.setattr(svc.urllib.request, "urlopen",
                        lambda *a, **k: _Resp({"isValid": True, "userError": "VALID",
                                               "name": "---", "address": "---"}))
    out = svc.vies_lookup("DE811569869")
    assert out["valid"] is True
    assert out["traderName"] == ""


def test_transient_unavailable_raises_503_not_invalid(monkeypatch):
    monkeypatch.setattr(svc.time, "sleep", lambda *_: None)  # bez czekania w teście
    monkeypatch.setattr(svc.urllib.request, "urlopen",
                        lambda *a, **k: _Resp({"isValid": False, "userError": "MS_UNAVAILABLE"}))
    with pytest.raises(HTTPException) as e:
        svc.vies_lookup("DE811569869")
    assert e.value.status_code == 503  # „spróbuj ponownie", a NIE „nieaktywny"


def test_genuinely_invalid_returns_valid_false(monkeypatch):
    monkeypatch.setattr(svc.urllib.request, "urlopen",
                        lambda *a, **k: _Resp({"isValid": False, "userError": "INVALID_INPUT"}))
    out = svc.vies_lookup("DE000000000")
    assert out["valid"] is False


# ── 27.11.2026: numer potwierdzenia (zapytujący = nasz NIP) i rozbity adres ──

def test_post_z_zapytujacym_zwraca_numer_potwierdzenia(monkeypatch):
    monkeypatch.setattr(svc, "_nip_zakladu", lambda: "PL 677-000-00-00")
    widziane = {}

    def _urlopen(req, *a, **k):
        widziane["metoda"] = req.get_method()
        widziane["url"] = req.full_url
        widziane["body"] = json.loads(req.data.decode("utf-8"))
        return _Resp({"valid": True, "requestIdentifier": "WAPIAAAAZ1x",
                      "requestDate": "2026-11-27T10:00:00.000Z", "name": "Emin Handels GmbH",
                      "address": "Hauptplatz 7\nAT-4490 St.Florian-Markt"})
    monkeypatch.setattr(svc.urllib.request, "urlopen", _urlopen)
    out = svc.vies_lookup("ATU12345675")
    assert widziane["metoda"] == "POST"
    assert widziane["url"].endswith("/rest-api/check-vat-number")
    assert widziane["body"] == {"countryCode": "AT", "vatNumber": "U12345675",
                                "requesterMemberStateCode": "PL", "requesterNumber": "6770000000"}
    assert out["valid"] is True
    assert out["requestIdentifier"] == "WAPIAAAAZ1x"
    assert out["requestDate"] == "2026-11-27T10:00:00.000Z"
    assert out["ulica"] == "Hauptplatz 7"
    assert out["kodPocztowy"] == "4490"
    assert out["miasto"] == "St.Florian-Markt"
    assert out["kraj"] == "AT"


def test_post_pada_zapas_get(monkeypatch):
    import urllib.error
    monkeypatch.setattr(svc, "_nip_zakladu", lambda: "6770000000")
    metody = []

    def _urlopen(req, *a, **k):
        metody.append(req.get_method())
        if req.get_method() == "POST":
            raise urllib.error.HTTPError(req.full_url, 500, "x", {}, None)
        return _Resp({"isValid": True, "userError": "VALID", "name": "X", "address": "Hauptstr. 21\n50667 Köln"})
    monkeypatch.setattr(svc.urllib.request, "urlopen", _urlopen)
    out = svc.vies_lookup("DE111222333")
    assert metody == ["POST", "GET"]
    assert out["valid"] is True
    assert out["requestIdentifier"] == ""
    assert out["miasto"] == "Köln"


def test_brak_nipu_zakladu_bez_zapytujacego(monkeypatch):
    body = {}

    def _urlopen(req, *a, **k):
        if req.get_method() == "POST":
            body.update(json.loads(req.data.decode("utf-8")))
        return _Resp({"valid": True, "name": "X", "address": ""})
    monkeypatch.setattr(svc.urllib.request, "urlopen", _urlopen)
    svc.vies_lookup("DE111222333")
    assert body == {"countryCode": "DE", "vatNumber": "111222333"}


def test_grecja_el_to_kraj_gr(monkeypatch):
    monkeypatch.setattr(svc.urllib.request, "urlopen",
                        lambda *a, **k: _Resp({"valid": True, "name": "X", "address": ""}))
    assert svc.vies_lookup("EL098765432")["kraj"] == "GR"


def test_nieznany_blad_vies_to_503_nie_nieaktywny(monkeypatch):
    """Przegląd 27.11: SERVER_BUSY / INVALID_REQUESTER_INFO itp. z valid=false to NIE
    „numer nieważny” — zapisany jako nieaktywny zmieniłby stawkę na WZ na 5 %."""
    monkeypatch.setattr(svc.time, "sleep", lambda *_: None)
    for kod in ("SERVER_BUSY", "INVALID_REQUESTER_INFO", "IP_BLOCKED", "GLOBAL_MAX_CONCURRENT_REQ_TIME"):
        monkeypatch.setattr(svc.urllib.request, "urlopen",
                            lambda *a, _k=kod, **k: _Resp({"valid": False, "userError": _k}))
        with pytest.raises(HTTPException) as e:
            svc.vies_lookup("DE811569869")
        assert e.value.status_code == 503, kod


def test_invalid_to_nieaktywny(monkeypatch):
    monkeypatch.setattr(svc.urllib.request, "urlopen",
                        lambda *a, **k: _Resp({"valid": False, "userError": "INVALID"}))
    assert svc.vies_lookup("DE000000000")["valid"] is False


def test_przekroczony_czas_post_bez_drugiego_get(monkeypatch):
    """Przegląd 27.11: po timeoucie POST zapas GET podwajał czas czekania."""
    import socket
    monkeypatch.setattr(svc, "_nip_zakladu", lambda: "6770000000")
    monkeypatch.setattr(svc.time, "sleep", lambda *_: None)
    metody = []

    def _urlopen(req, *a, **k):
        metody.append(req.get_method())
        raise socket.timeout("timed out")
    monkeypatch.setattr(svc.urllib.request, "urlopen", _urlopen)
    with pytest.raises(HTTPException) as e:
        svc.vies_check("DE111222333", timeout=8, attempts=1)
    assert e.value.status_code == 503
    assert metody == ["POST"]
