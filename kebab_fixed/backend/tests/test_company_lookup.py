"""Regresja: wyszukiwanie firmy po NIP musi działać przez darmowe MF (główne)
z zapasem dataport — żeby nie psuło się przy awarii płatnego dostawcy."""
import json

import pytest
from fastapi import HTTPException

from app.services import company_lookup_service as svc


class _Resp:
    def __init__(self, data):
        self._d = data

    def read(self):
        return json.dumps(self._d).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_clean_nip_rejects_bad_length():
    with pytest.raises(HTTPException) as e:
        svc._clean_nip("123")
    assert e.value.status_code == 400


def test_parse_pl_address_splits_street_and_postal():
    out = svc._parse_pl_address("UL. DŁUGA 12/3, 00-950 KRAKÓW")
    assert out["kod_pocztowy"] == "00-950"
    assert out["miasto"] == "KRAKÓW"
    assert out["numer_budynku"] == "12"
    assert out["numer_lokalu"] == "3"


def test_gus_lookup_uses_mf_white_list(monkeypatch):
    mf = {"result": {"subject": {
        "name": "FIRMA X SP. Z O.O.", "regon": "123456789",
        "workingAddress": "UL. A 1, 00-000 KRAKÓW"}}}
    monkeypatch.setattr(svc.request, "urlopen", lambda *a, **k: _Resp(mf))
    out = svc.gus_lookup("1234563218")
    assert out["nazwa"] == "FIRMA X SP. Z O.O."
    assert out["regon"] == "123456789"
    assert out["miasto"] == "KRAKÓW"
    assert "KRAKÓW" in out["adres"]


def test_gus_lookup_falls_back_to_dataport_when_mf_unavailable(monkeypatch):
    monkeypatch.setattr(svc, "_lookup_mf", lambda nip: None)
    monkeypatch.setattr(svc, "_lookup_dataport", lambda nip: {
        "nip": nip, "nazwa": "Z DATAPORT", "regon": None, "adres": "X",
        "ulica": None, "numer_budynku": None, "numer_lokalu": None,
        "kod_pocztowy": None, "miasto": None})
    out = svc.gus_lookup("1234563218")
    assert out["nazwa"] == "Z DATAPORT"


def test_gus_lookup_404_when_both_unavailable(monkeypatch):
    monkeypatch.setattr(svc, "_lookup_mf", lambda nip: None)
    monkeypatch.setattr(svc, "_lookup_dataport", lambda nip: None)
    with pytest.raises(HTTPException) as e:
        svc.gus_lookup("1234563218")
    assert e.value.status_code == 404
