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
