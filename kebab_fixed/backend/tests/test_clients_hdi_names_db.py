"""Nazwa pozycji HDI ustawiana w kartotece odbiorcy.

POLAT (31.08.2026, HDI 20/08) chce na dokumencie sam rodzaj i kilogramy,
a recepturę „BEYAZ AFIYET" widzieć jako samo „BEYAZ". TRUVA chce odwrotnie —
rodzaj ORAZ recepturę. Dlatego tryb i własne nazwy receptur stoją przy
odbiorcy, nie w globalnym ustawieniu.

Testy DB — bez TEST_DATABASE_URL skip.
"""
from app.db import execute, query_all
from app.models.clients import ClientCreate, ClientRecipeName
from app.services.clients_service import create_client, list_clients, update_client


def _receptura(rid="r1", nazwa="BEYAZ AFIYET"):
    execute("INSERT INTO recipes (id, name, shelf_life_days) VALUES (%s,%s,365) "
            "ON CONFLICT (id) DO NOTHING", (rid, nazwa))


def _dto(**kw) -> ClientCreate:
    dane = {"name": "POLAT", "hdi_name_mode": "type",
            "hdi_recipe_names": [ClientRecipeName(recipe_id="r1", name="BEYAZ")]}
    dane.update(kw)
    return ClientCreate(**dane)


def test_kartoteka_zapisuje_tryb_i_wlasne_nazwy_receptur(db):
    _receptura()
    row = create_client(_dto())

    assert row["hdi_name_mode"] == "type"
    klient = [c for c in list_clients() if c["id"] == row["id"]][0]
    assert klient["hdi_recipe_names"] == [{"recipe_id": "r1", "name": "BEYAZ"}]


def test_pusta_nazwa_kasuje_wlasna_nazwe_receptury(db):
    """Formularz przysyła CAŁĄ listę, więc zapis jest podmianą — inaczej
    skasowana w kartotece nazwa dalej schodziłaby na dokument."""
    _receptura()
    row = create_client(_dto())

    update_client(row["id"], _dto(
        hdi_recipe_names=[ClientRecipeName(recipe_id="r1", name="  ")]))

    assert query_all("SELECT 1 FROM client_recipe_names WHERE client_id=%s", (row["id"],)) == []


def test_nieznany_tryb_wraca_do_domyslnego(db):
    _receptura()
    row = create_client(_dto(hdi_name_mode="cokolwiek"))
    assert row["hdi_name_mode"] == "type_recipe"


def test_domyslny_odbiorca_ma_rodzaj_z_receptura(db):
    row = create_client(ClientCreate(name="TRUVA"))
    assert row["hdi_name_mode"] == "type_recipe"
    klient = [c for c in list_clients() if c["id"] == row["id"]][0]
    assert klient["hdi_recipe_names"] == []
