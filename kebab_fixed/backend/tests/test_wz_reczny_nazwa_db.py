"""Ręczny WZ nazywa wyrób tak, jak każe kartoteka odbiorcy.

Na produkcji (4.09.2026, MATEUSZ STYRNIK, tryb „sam rodzaj") ten sam dzień
dawał HDI „KEBAB UDO 80KG" obok WZ „KEBAB UDO 100% WROCŁAW 80kg": ręczny WZ
jako jedyna ścieżka składał nazwę W PRZEGLĄDARCE i kartoteki nie widział.

Tu sprawdzamy CAŁĄ ścieżkę wystawiania — od kartoteki po zapisany dokument —
bo poprawka siedzi w wiązaniu (`create_manual_wz` dobiera wiersze magazynu
i tryb), nie w samym budowniczym linii.

Testy DB — bez TEST_DATABASE_URL skip.
"""
from app.db import execute, query_one
from app.models.clients import ClientCreate, ClientRecipeName
from app.services.clients_service import create_client
from app.services.wz_service import create_manual_wz

NABYWCA = {"name": "MATEUSZ STYRNIK", "address": "Wrocław", "nip": "2222222222"}
# Napis tak, jak przysyła go ekran WZ — z surowych pól, bez kartoteki.
Z_PRZEGLADARKI = "KEBAB UDO 100% WROCŁAW 80kg"


def _wyrob(gid="fg1", kg=80.0):
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, "
        " product_type_id, product_type_name, qty, kg_per_unit, total_kg, "
        " qty_available, qty_shipped, produced_date) "
        "VALUES (%s,'040926 500','r1','WROCŁAW','pt1','KEBAB UDO 100%%',10,%s,%s,10,0,"
        " '2026-09-04')", (gid, kg, 10 * kg))


def _kartoteka(tryb="type", na_wz=True, wlasna="WROCŁAW"):
    execute("INSERT INTO recipes (id, name, shelf_life_days) VALUES ('r1','WROCŁAW',365) "
            "ON CONFLICT (id) DO NOTHING")
    # Rodzaj ma NAZWĘ DOKUMENTOWĄ inną niż wewnętrzna — tak jest na produkcji
    # („KEBAB UDO 100%" → „KEBAB UDO", „KEBAB MIX 95/5" → „KEBAB MIX UDO/FILET").
    # Bez tego wiersza test nie widziałby różnicy, przez którą FUDI dostawało
    # na WZ inną nazwę niż na HDI.
    execute("INSERT INTO product_types (id, name, document_name) "
            "VALUES ('pt1','KEBAB UDO 100%%','KEBAB UDO') "
            "ON CONFLICT (id) DO UPDATE SET document_name=EXCLUDED.document_name")
    return create_client(ClientCreate(
        name=NABYWCA["name"], nip=NABYWCA["nip"], hdi_name_mode=tryb,
        wz_uses_hdi_names=na_wz,
        hdi_recipe_names=[ClientRecipeName(recipe_id="r1", name=wlasna)]))


def _wystaw():
    return create_manual_wz(
        buyer=NABYWCA,
        selections=[{"stock_type": "fg", "stock_id": "fg1", "name": Z_PRZEGLADARKI,
                     "unit": "szt", "qty": 2, "price": None,
                     "batch_no": "040926 500", "kg_per_unit": 80.0}],
        valued=False)


def _nazwa(wz_id):
    row = query_one("SELECT lines FROM wz_documents WHERE id=%s", (wz_id,))
    linie = row["lines"]
    if isinstance(linie, str):
        import json
        linie = json.loads(linie)
    return linie[0]["name"]


def test_tryb_sam_rodzaj_schodzi_na_reczny_wz(db):
    """To jest dokładnie przypadek z produkcji — napis z przeglądarki ma
    zostać zastąpiony nazwą z kartoteki."""
    _kartoteka(tryb="type")
    _wyrob()
    wz = _wystaw()
    assert _nazwa(wz["id"]) == "KEBAB UDO 80kg"


def test_wlasna_nazwa_receptury_schodzi_na_reczny_wz(db):
    _kartoteka(tryb="type_recipe", wlasna="BEYAZ")
    _wyrob()
    wz = _wystaw()
    assert _nazwa(wz["id"]) == "KEBAB UDO BEYAZ 80kg"


def test_odznaczony_ptaszek_zostawia_nazwe_ogolna(db):
    """Odbiorca, który na WZ ma widzieć co innego niż na HDI.

    „Ogólna" znaczy: rodzaj ORAZ receptura, bez własnych nazw z kartoteki.
    Nazwa DOKUMENTOWA rodzaju zostaje — to nie jest ustawienie odbiorcy,
    tylko nazwa, pod jaką zakład pokazuje ten wyrób każdemu klientowi.
    """
    _kartoteka(tryb="type", na_wz=False)
    _wyrob()
    wz = _wystaw()
    assert _nazwa(wz["id"]) == "KEBAB UDO WROCŁAW 80kg"


def test_odbiorca_spoza_kartoteki_nazywa_sie_ogolnie(db):
    """Strażnik regresji: nabywca wpisany z ręki, bez karty w kartotece —
    dostaje nazwę ogólną, a nie cudze ustawienia."""
    _kartoteka(tryb="type")          # kartoteka rodzajów musi istnieć…
    execute("DELETE FROM clients WHERE nip=%s", (NABYWCA["nip"],))  # …ale karty klienta nie ma
    _wyrob()
    wz = _wystaw()
    assert _nazwa(wz["id"]) == "KEBAB UDO WROCŁAW 80kg"


def test_proporcja_skladu_nie_wychodzi_na_papier(db):
    """„95/5" to nasza kuchnia. Na WZ ma iść nazwa dokumentowa — inaczej
    odbiorca zobaczyłby skład, którego HDI mu nie pokazuje."""
    _kartoteka(tryb="type")
    execute("INSERT INTO product_types (id, name, document_name) "
            "VALUES ('pt9','KEBAB MIX 95/5','KEBAB MIX UDO/FILET') "
            "ON CONFLICT (id) DO UPDATE SET document_name=EXCLUDED.document_name")
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, "
        " product_type_id, product_type_name, qty, kg_per_unit, total_kg, "
        " qty_available, qty_shipped, produced_date) "
        "VALUES ('fg9','040926 500','r1','WROCŁAW','pt9','KEBAB MIX 95/5',10,20,200,10,0,"
        " '2026-09-04')")
    wz = create_manual_wz(
        buyer=NABYWCA,
        selections=[{"stock_type": "fg", "stock_id": "fg9", "name": "KEBAB MIX 95/5 20kg",
                     "unit": "szt", "qty": 1, "price": None,
                     "batch_no": "040926 500", "kg_per_unit": 20.0}],
        valued=False)
    nazwa = _nazwa(wz["id"])
    assert nazwa == "KEBAB MIX UDO/FILET 20kg"
    assert "95/5" not in nazwa
