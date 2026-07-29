"""Tożsamość kontrahenta pojemnikowego — scalanie dostawcy i odbiorcy po NIP."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one, transaction
from app.services.container_partners_service import (
    get_partner,
    resolve_partner,
    resolve_partner_by_nip,
)
from app.utils.ids import now_iso


def _seed_supplier(sid="sup1", nip="513-006-44-78", name="KOKO Sp. z o.o."):
    execute(
        "INSERT INTO suppliers (id, code, name, nip, address, city, active, created_at) "
        "VALUES (%s,%s,%s,%s,'Dunajewskiego 83','Rudawa',true,%s)",
        (sid, sid.upper(), name, nip, now_iso()))


def _seed_client(cid="cli1", nip="5130064478", name="KOKO SP Z O O"):
    execute(
        "INSERT INTO clients (id, code, name, nip, address, city, active, created_at) "
        "VALUES (%s,%s,%s,%s,'Dunajewskiego 83','Rudawa',true,%s)",
        (cid, cid.upper(), name, nip, now_iso()))


def test_dostawca_i_odbiorca_o_tym_samym_nip_to_JEDEN_partner(db):
    _seed_supplier()
    _seed_client()
    with transaction() as conn:
        a = resolve_partner(conn, "supplier", "sup1")
        b = resolve_partner(conn, "client", "cli1")
    assert a == b, "NIP identyczny po normalizacji → musi być jedno saldo"
    assert query_one("SELECT COUNT(*) AS n FROM container_partners")["n"] == 1


def test_powtorne_wywolanie_nie_tworzy_duplikatu(db):
    _seed_supplier()
    with transaction() as conn:
        a = resolve_partner(conn, "supplier", "sup1")
        b = resolve_partner(conn, "supplier", "sup1")
    assert a == b
    assert query_one("SELECT COUNT(*) AS n FROM container_partners")["n"] == 1


def test_bez_nip_dopasowanie_po_znormalizowanej_nazwie(db):
    _seed_supplier(sid="sup2", nip="", name="  Ubojnia   Rolnicza ")
    _seed_client(cid="cli2", nip="", name="UBOJNIA ROLNICZA")
    with transaction() as conn:
        a = resolve_partner(conn, "supplier", "sup2")
        b = resolve_partner(conn, "client", "cli2")
    assert a == b
    assert query_one("SELECT COUNT(*) AS n FROM container_partners")["n"] == 1


def test_bez_nip_rozne_nazwy_to_rozni_partnerzy(db):
    _seed_supplier(sid="sup3", nip="", name="Ubojnia A")
    _seed_client(cid="cli3", nip="", name="Ubojnia B")
    with transaction() as conn:
        a = resolve_partner(conn, "supplier", "sup3")
        b = resolve_partner(conn, "client", "cli3")
    assert a != b


def test_firma_z_nip_nie_scala_sie_z_bezimiennym_wpisem_bez_nip(db):
    _seed_supplier(sid="sup4", nip="1111111111", name="KOKO")
    _seed_client(cid="cli4", nip="", name="KOKO")
    with transaction() as conn:
        a = resolve_partner(conn, "supplier", "sup4")
        b = resolve_partner(conn, "client", "cli4")
    assert a != b, "brak NIP-u nie może przykleić się do firmy z NIP-em"


def test_partner_spoza_kartoteki_po_samym_nip(db):
    with transaction() as conn:
        a = resolve_partner_by_nip(conn, "513-006-44-78", "KOKO", "Rudawa")
        b = resolve_partner_by_nip(conn, "5130064478", "KOKO inaczej zapisane")
    assert a == b


def test_nieznany_typ_kontrahenta_odrzucony(db):
    with pytest.raises(HTTPException) as e:
        with transaction() as conn:
            resolve_partner(conn, "przewoznik", "x1")
    assert e.value.status_code == 400


def test_nieistniejacy_kontrahent_to_404(db):
    with pytest.raises(HTTPException) as e:
        with transaction() as conn:
            resolve_partner(conn, "supplier", "nie-ma-takiego")
    assert e.value.status_code == 404


def test_get_partner_zwraca_role(db):
    _seed_supplier()
    _seed_client()
    with transaction() as conn:
        pid = resolve_partner(conn, "supplier", "sup1")
        resolve_partner(conn, "client", "cli1")
    p = get_partner(pid)
    assert p["roles"] == ["client", "supplier"]
    assert p["nip"] == "5130064478"
