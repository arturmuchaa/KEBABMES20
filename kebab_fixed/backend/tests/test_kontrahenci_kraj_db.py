"""Kraj kontrahenta i status VAT UE w kartotece (27.11.2026).

Do dziś kraj zgadywano z prefiksu VAT przy każdym użyciu. Teraz jest polem:
pusty przy zapisie = wyliczony z numeru VAT (cyfry → PL).
Testy DB — bez TEST_DATABASE_URL skip.
"""
from app.db import query_one
from app.models.clients import ClientCreate
from app.models.suppliers import SupplierCreate
from app.services import clients_service, suppliers_service


def test_create_client_bez_kraju_wylicza_z_vat(db):
    row = clients_service.create_client(ClientCreate(name="Emin Handels GmbH", nip="ATU12345675"))
    assert row["country"] == "AT"


def test_create_client_polski_nip_to_pl(db):
    row = clients_service.create_client(ClientCreate(name="FUDI", nip="1112223334"))
    assert row["country"] == "PL"


def test_update_client_zapisuje_podany_kraj(db):
    row = clients_service.create_client(ClientCreate(name="X", nip=""))
    out = clients_service.update_client(row["id"], ClientCreate(name="X", nip="", country="CH"))
    assert out["country"] == "CH"


def test_create_supplier_z_krajem_zapisuje(db):
    row = suppliers_service.create_supplier(SupplierCreate(name="OPERTI", nip="IT01234567890", country="IT"))
    assert row["country"] == "IT"
    row2 = suppliers_service.create_supplier(SupplierCreate(name="KOKO", nip="3334445556"))
    assert row2["country"] == "PL"


def test_list_clients_zwraca_vat_ue_status(db):
    clients_service.create_client(ClientCreate(name="Nowy", nip="DE111222333"))
    lista = clients_service.list_clients()
    assert lista[0]["vat_ue_status"] == ""
    assert lista[0]["vat_ue_request_id"] == ""
    assert lista[0]["vat_ue_checked_at"] is None


def test_tabela_historii_istnieje(db):
    r = query_one("SELECT count(*) AS n FROM vat_ue_checks")
    assert r["n"] == 0
