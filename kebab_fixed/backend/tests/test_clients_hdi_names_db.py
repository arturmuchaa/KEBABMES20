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


# ── Ptaszek „własne nazewnictwo także na WZ" (12.09.2026) ────────────
#
# Do tej pory reguła z kartoteki sięgała HDI zawsze, a WZ zależnie od
# ścieżki — ręczny WZ składał nazwę w przeglądarce i kartoteki nie znał.
# Teraz o WZ decyduje ptaszek, a HDI zostaje przy swoim niezależnie od niego.
def test_domyslnie_nazewnictwo_obowiazuje_takze_na_wz(db):
    _receptura()
    row = create_client(_dto())
    assert row["wz_uses_hdi_names"] is True

    from app.services.wz_service import naming_context
    mode, wlasne, _ = naming_context(client_name="POLAT")
    assert mode == "type"
    assert wlasne == {"r1": "BEYAZ"}


def test_odznaczony_ptaszek_zdejmuje_nazewnictwo_z_WZ_ale_nie_z_HDI(db):
    _receptura()
    row = create_client(_dto(wz_uses_hdi_names=False))
    assert row["wz_uses_hdi_names"] is False

    from app.services.hdi_service import client_naming
    from app.services.wz_service import naming_context

    # WZ wraca do nazwy ogólnej…
    mode, wlasne, _ = naming_context(client_name="POLAT")
    assert mode == "type_recipe"
    assert wlasne == {}

    # …a HDI dalej trzyma się kartoteki.
    hdi_mode, hdi_wlasne = client_naming(
        {"id": row["id"], "hdi_name_mode": row["hdi_name_mode"]})
    assert hdi_mode == "type"
    assert hdi_wlasne == {"r1": "BEYAZ"}


def test_ptaszek_da_sie_przestawic_edycja(db):
    _receptura()
    row = create_client(_dto())
    from app.services.wz_service import naming_context

    update_client(row["id"], _dto(wz_uses_hdi_names=False))
    assert naming_context(client_name="POLAT")[0] == "type_recipe"

    update_client(row["id"], _dto(wz_uses_hdi_names=True))
    assert naming_context(client_name="POLAT")[0] == "type"
