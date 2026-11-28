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
    from app.services.adresy import rozbij_adres_pl
    out = rozbij_adres_pl("UL. DŁUGA 12/3, 00-950 KRAKÓW")
    assert out["kod_pocztowy"] == "00-950"
    assert out["miasto"] == "Kraków"
    assert out["ulica"] == "Długa 12/3"


def test_gus_lookup_uses_mf_white_list(monkeypatch):
    mf = {"result": {"subject": {
        "name": "FIRMA X SP. Z O.O.", "regon": "123456789",
        "workingAddress": "UL. A 1, 00-000 KRAKÓW"}}}
    monkeypatch.setattr(svc.request, "urlopen", lambda *a, **k: _Resp(mf))
    out = svc.gus_lookup("1234563218")
    assert out["nazwa"] == "FIRMA X SP. Z O.O."
    assert out["regon"] == "123456789"
    assert out["miasto"] == "Kraków"
    assert "KRAKÓW" in out["adres"]


def test_gus_lookup_falls_back_to_dataport_when_mf_unavailable(monkeypatch):
    monkeypatch.setattr(svc, "_lookup_bir", lambda nip: None)
    monkeypatch.setattr(svc, "_lookup_mf", lambda nip: None)
    monkeypatch.setattr(svc, "_lookup_dataport", lambda nip: {
        "nip": nip, "nazwa": "Z DATAPORT", "regon": None, "adres": "X",
        "ulica": None, "numer_budynku": None, "numer_lokalu": None,
        "kod_pocztowy": None, "miasto": None})
    out = svc.gus_lookup("1234563218")
    assert out["nazwa"] == "Z DATAPORT"


def test_gus_lookup_404_when_both_unavailable(monkeypatch):
    monkeypatch.setattr(svc, "_lookup_bir", lambda nip: None)
    monkeypatch.setattr(svc, "_lookup_mf", lambda nip: None)
    monkeypatch.setattr(svc, "_lookup_dataport", lambda nip: None)
    with pytest.raises(HTTPException) as e:
        svc.gus_lookup("1234563218")
    assert e.value.status_code == 404


# ── 27.11.2026: rozbity, ładny adres + GUS REGON (BIR) po kluczu ──

def _klucz(monkeypatch, wartosc):
    """`settings` to zamrożona dataclass — podmieniamy cały obiekt w module."""
    import dataclasses
    monkeypatch.setattr(svc, "settings", dataclasses.replace(svc.settings, gus_bir_key=wartosc))


def _mf(addr, name="FIRMA X SP. Z O.O."):
    return {"result": {"subject": {"name": name, "regon": "1", "workingAddress": addr}}}


def test_mf_zwraca_rozbity_ladny_adres(monkeypatch):
    _klucz(monkeypatch, "")
    monkeypatch.setattr(svc.request, "urlopen",
                        lambda *a, **k: _Resp(_mf("JANA KILIŃSKIEGO 17, 40-001 KATOWICE")))
    out = svc.gus_lookup("2223334445")
    assert out["ulica"] == "Jana Kilińskiego 17"
    assert out["kod_pocztowy"] == "40-001"
    assert out["miasto"] == "Katowice"
    assert out["kraj"] == "PL"
    assert out["zrodlo"] == "MF"
    assert out["adres"] == "JANA KILIŃSKIEGO 17, 40-001 KATOWICE"


def test_nazwa_bez_zmiany_liter(monkeypatch):
    _klucz(monkeypatch, "")
    nazwa = "FUDI SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"
    monkeypatch.setattr(svc.request, "urlopen",
                        lambda *a, **k: _Resp(_mf("ZALESIE 41F, 62-300 ZALESIE", nazwa)))
    assert svc.gus_lookup("1112223334")["nazwa"] == nazwa


def test_bir_pierwszy_gdy_klucz(monkeypatch):
    _klucz(monkeypatch, "x")
    monkeypatch.setattr(svc, "_lookup_bir", lambda nip: {
        "nip": nip, "regon": "1", "nazwa": "Z GUS", "ulica": "Długa 1", "kod_pocztowy": "31-147",
        "miasto": "Kraków", "kraj": "PL", "adres": "Długa 1, 31-147 Kraków", "zrodlo": "GUS"})

    def _mf_nie(nip):
        raise AssertionError("MF nie powinien być wołany")
    monkeypatch.setattr(svc, "_lookup_mf", _mf_nie)
    out = svc.gus_lookup("1112223334")
    assert out["zrodlo"] == "GUS" and out["nazwa"] == "Z GUS"


def test_bir_pominiety_bez_klucza(monkeypatch):
    _klucz(monkeypatch, "")

    def _bir_nie(nip):
        raise AssertionError("BIR nie powinien być wołany bez klucza")
    monkeypatch.setattr(svc, "_lookup_bir", _bir_nie)
    monkeypatch.setattr(svc.request, "urlopen",
                        lambda *a, **k: _Resp(_mf("OPOLSKA 7, 46-061 GÓRKI WIELKIE")))
    assert svc.gus_lookup("4445556667")["zrodlo"] == "MF"


def test_bir_blad_spada_na_mf(monkeypatch):
    _klucz(monkeypatch, "x")

    def _urlopen(req, *a, **k):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        if "stat.gov.pl" in url:
            raise OSError("timeout")
        return _Resp(_mf("OPOLSKA 7, 46-061 GÓRKI WIELKIE"))
    monkeypatch.setattr(svc.request, "urlopen", _urlopen)
    out = svc.gus_lookup("4445556667")
    assert out["zrodlo"] == "MF" and out["miasto"] == "Górki Wielkie"


BIR_XML = """<root><dane><Regon>123456789</Regon><Nip>1112223334</Nip>
<Nazwa>FUDI SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ</Nazwa><Wojewodztwo>WIELKOPOLSKIE</Wojewodztwo>
<Miejscowosc>Zalesie</Miejscowosc><KodPocztowy>62-300</KodPocztowy><Ulica></Ulica>
<NrNieruchomosci>41F</NrNieruchomosci><NrLokalu></NrLokalu></dane></root>"""


def test_bir_xml_wies_bez_ulicy():
    out = svc._bir_z_xml(BIR_XML, "1112223334")
    assert out["ulica"] == "Zalesie 41F"
    assert out["kod_pocztowy"] == "62-300"
    assert out["miasto"] == "Zalesie"
    assert out["zrodlo"] == "GUS"
    assert out["nazwa"] == "FUDI SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"


def test_bir_xml_ulica_z_lokalem_bez_przedrostka():
    xml = BIR_XML.replace("<Ulica></Ulica>", "<Ulica>ul. Jana Kilińskiego</Ulica>") \
                 .replace("<NrLokalu></NrLokalu>", "<NrLokalu>3</NrLokalu>")
    assert svc._bir_z_xml(xml, "1112223334")["ulica"] == "Jana Kilińskiego 41F/3"


def test_bir_xml_pusty_to_none():
    assert svc._bir_z_xml("<root></root>", "1112223334") is None
