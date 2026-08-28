"""Grupy odbiorców — kilka spółek jednego kontrahenta.

YALCIN to dwie spółki, odbiorca wrocławski ma pięć oddziałów. Grupa łączy ich
pulę wyrobu przy liczeniu pokrycia; dokumenty zostają przy konkretnej spółce.

Testy DB — bez TEST_DATABASE_URL skip.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.client_groups_service import (
    create_group, delete_group, list_groups, pule_klientow, rename_group, set_members,
)


def _klient(cid, nazwa, display=""):
    execute("INSERT INTO clients (id, code, name, display_name) VALUES (%s,%s,%s,%s) "
            "ON CONFLICT (id) DO NOTHING", (cid, cid, nazwa, display or nazwa))


def test_grupa_zbiera_wskazane_spolki(db):
    _klient("c1", "YBM Gastro GmbH", "YALCIN")
    _klient("c2", "Emin Handels GmbH", "YALCIN")
    _klient("c3", "Truva gastro s.r.o.", "TRUVA")

    g = create_group("YALCIN")
    set_members(g["id"], ["c1", "c2"])

    grupy = list_groups()
    assert len(grupy) == 1
    assert [m["name"] for m in grupy[0]["members"]] == ["Emin Handels GmbH", "YBM Gastro GmbH"]
    # Trzeci odbiorca zostaje poza grupą.
    assert query_one("SELECT group_id FROM clients WHERE id='c3'")["group_id"] is None


def test_sklad_jest_pelna_lista_a_nie_dopisywaniem(db):
    _klient("c1", "A"); _klient("c2", "B"); _klient("c3", "C")
    g = create_group("WROCŁAW")

    set_members(g["id"], ["c1", "c2"])
    set_members(g["id"], ["c2", "c3"])          # c1 wypada

    czlonkowie = {m["id"] for m in list_groups()[0]["members"]}
    assert czlonkowie == {"c2", "c3"}


def test_spolka_nalezy_najwyzej_do_jednej_grupy(db):
    """Inaczej ta sama sztuka pokrywałaby zamówienia w dwóch grupach naraz."""
    _klient("c1", "YBM Gastro GmbH")
    a = create_group("YALCIN")
    b = create_group("WROCŁAW")
    set_members(a["id"], ["c1"])

    with pytest.raises(HTTPException) as e:
        set_members(b["id"], ["c1"])
    assert e.value.status_code == 409
    assert "YALCIN" in e.value.detail
    assert query_one("SELECT group_id FROM clients WHERE id='c1'")["group_id"] == a["id"]


def test_nieznany_odbiorca_odrzucony(db):
    g = create_group("YALCIN")
    with pytest.raises(HTTPException) as e:
        set_members(g["id"], ["nie-ma"])
    assert e.value.status_code == 404


def test_dwie_grupy_o_tej_samej_nazwie_odrzucone(db):
    create_group("YALCIN")
    with pytest.raises(HTTPException) as e:
        create_group("  yalcin ")
    assert e.value.status_code == 409


def test_rozwiazanie_grupy_zostawia_spolki(db):
    _klient("c1", "YBM Gastro GmbH")
    g = create_group("YALCIN")
    set_members(g["id"], ["c1"])

    delete_group(g["id"])

    assert list_groups() == []
    assert query_one("SELECT id FROM clients WHERE id='c1'")            # firma zostaje
    assert query_one("SELECT group_id FROM clients WHERE id='c1'")["group_id"] is None


def test_pule_lacza_grupe_a_reszta_stoi_osobno(db):
    _klient("c1", "YBM Gastro GmbH"); _klient("c2", "Emin Handels GmbH")
    _klient("c3", "Truva gastro s.r.o.")
    g = create_group("YALCIN")
    set_members(g["id"], ["c1", "c2"])

    pule = pule_klientow()
    assert pule["c1"] == pule["c2"] == g["id"]
    assert pule["c3"] == "c3"                    # bez grupy = własna pula


def test_zmiana_nazwy_zostawia_sklad(db):
    _klient("c1", "YBM Gastro GmbH")
    g = create_group("YALCIN")
    set_members(g["id"], ["c1"])

    out = rename_group(g["id"], "YALCIN GRUPA")

    assert out["name"] == "YALCIN GRUPA"
    assert [m["id"] for m in out["members"]] == ["c1"]
