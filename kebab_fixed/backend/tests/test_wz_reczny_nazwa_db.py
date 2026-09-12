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
    assert _nazwa(wz["id"]) == "KEBAB UDO 100% 80kg"


def test_wlasna_nazwa_receptury_schodzi_na_reczny_wz(db):
    _kartoteka(tryb="type_recipe", wlasna="BEYAZ")
    _wyrob()
    wz = _wystaw()
    assert _nazwa(wz["id"]) == "KEBAB UDO 100% BEYAZ 80kg"


def test_odznaczony_ptaszek_zostawia_nazwe_ogolna(db):
    """Odbiorca, który na WZ ma widzieć co innego niż na HDI."""
    _kartoteka(tryb="type", na_wz=False)
    _wyrob()
    wz = _wystaw()
    assert _nazwa(wz["id"]) == "KEBAB UDO 100% WROCŁAW 80kg"


def test_odbiorca_spoza_kartoteki_nazywa_jak_dotad(db):
    """Strażnik regresji: nabywca wpisany z ręki, bez karty w kartotece."""
    _wyrob()
    wz = _wystaw()
    assert _nazwa(wz["id"]) == "KEBAB UDO 100% WROCŁAW 80kg"
