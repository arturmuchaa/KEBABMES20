"""Szybki podgląd w module Dokumenty: strona wydruku (ta sama, z której serwer robi PDF)
otwierana w ramce z tokenem tylko do odczytu — bez składania PDF przy każdym kliknięciu."""
import pytest
from fastapi import HTTPException

from app.auth.render_token import verify_render_token
from app.routes import wz as route


@pytest.mark.parametrize("rodzaj", ["wz", "cmr", "hdi"])
def test_adres_podgladu_ma_strone_druku_i_wazny_token(rodzaj):
    out = route.podglad_druku(rodzaj, "abc123")
    sciezka = out["sciezka"]
    assert sciezka.startswith(f"/office/{rodzaj}/abc123/druk?pdf=1&render_token=")
    assert verify_render_token(sciezka.split("render_token=", 1)[1])


@pytest.mark.parametrize("rodzaj,doc", [("faktura", "x"), ("wz", "../etc"), ("wz", "a b")])
def test_zly_rodzaj_albo_id_odrzucony(rodzaj, doc):
    with pytest.raises(HTTPException) as e:
        route.podglad_druku(rodzaj, doc)
    assert e.value.status_code == 400
