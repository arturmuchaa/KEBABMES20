"""Zwykły (tekstowy) log musi pokazywać pola z ``extra``.

TRUVA/Z/2/11/26 (19.11.2026): przy śledztwie „znikniętych palet" journal
miał tylko „pallet.scan.idempotent" bez numeru palety — kod przekazywał
order_id, pallet_no, vehicle_id i operatora, ale PlainFormatter je gubił.
Nie dało się ustalić, które palety operator skanował po kilka razy.
"""
from __future__ import annotations

import logging

from app.logging_config import PlainFormatter
from app.routes import magazyn  # noqa: E402 — import przed caplog (configure_logging czyści handlery)
from app.services import pallets_service  # noqa: E402


def _rekord(msg: str, **extra) -> logging.LogRecord:
    log = logging.getLogger("test.plain")
    return log.makeRecord("test.plain", logging.INFO, __file__, 1, msg, None, None, extra=extra)


def test_extra_dopisane_jako_klucz_wartosc():
    linia = PlainFormatter().format(_rekord(
        "pallet.scan", order_id="ad41", pallet_no=9, action="loaded", operator="OLEK"))
    assert linia.endswith("pallet.scan order_id=ad41 pallet_no=9 action=loaded operator=OLEK")


def test_bez_extra_linia_bez_zmian():
    linia = PlainFormatter().format(_rekord("app.startup"))
    assert linia.endswith("[test.plain] app.startup")


def test_wartosc_ze_spacja_w_cudzyslowie_i_lista():
    linia = PlainFormatter().format(_rekord(
        "pallet.scan.refused", powod="Paleta P2 nie istnieje", removed_ids=["a", "b"]))
    assert 'powod="Paleta P2 nie istnieje"' in linia
    assert 'removed_ids=["a", "b"]' in linia


def test_odmowa_skanu_trafia_do_logu(caplog):
    import pytest
    from fastapi import HTTPException
    _odmow = pallets_service._odmow
    with caplog.at_level(logging.INFO, logger="app.services.pallets_service"):
        with pytest.raises(HTTPException):
            _odmow("INVALID", "Paleta P2 nie istnieje dla tego zamówienia", 404)
    rec = [r for r in caplog.records if r.getMessage() == "pallet.scan.refused"]
    assert rec and rec[0].kod_wyniku == "INVALID" and "P2" in rec[0].powod


def test_nieznana_kartka_w_mrozni_trafia_do_logu(caplog, monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr(magazyn.mroznia_wazenie_service, "sprawdz", lambda code: {"result": "INVALID"})
    req = SimpleNamespace(state=SimpleNamespace(subject={"name": "OLEK"}))
    with caplog.at_level(logging.INFO, logger="app.routes.magazyn"):
        wynik = magazyn.mroznia_sprawdz(magazyn.SkanKodu(code="PAL|abc|2"), req)
    assert wynik == {"result": "INVALID"}
    rec = [r for r in caplog.records if r.getMessage() == "magazyn.mroznia.sprawdz"]
    assert rec and rec[0].wynik == "INVALID" and rec[0].kod == "PAL|abc|2" and rec[0].operator == "OLEK"
