"""HDI do RĘCZNEGO WZ — sprzedaż wyrobu prosto z magazynu.

Do 28.08.2026 handlowy dokument identyfikacyjny dało się wystawić wyłącznie
z zamówienia, bo pozycje brał z linii planu produkcji. Sprzedaż z magazynu
zamówienia nie ma i zostawała bez HDI — a wyrób jedzie do klienta tak samo
i tak samo musi nieść identyfikację partii (zgłoszenie: WZ na 3 × 80 kg).

Testy DB — bez TEST_DATABASE_URL skip.
"""
import json

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.hdi_service import build_hdi_from_wz, generate_hdi_from_wz


def _receptura(rid="r1", nazwa="WROCŁAW", dni=21):
    execute(
        "INSERT INTO recipes (id, name, shelf_life_days) VALUES (%s,%s,%s) "
        "ON CONFLICT (id) DO NOTHING", (rid, nazwa, dni))


def _wyrob(fid, qty=3, kg=80, partia="270826 507", rid="r1"):
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, "
        " product_type_id, product_type_name, qty, kg_per_unit, total_kg, "
        " qty_available, qty_shipped, produced_date) "
        "VALUES (%s,%s,%s,'WROCŁAW','pt1','KEBAB UDO 100%%',%s,%s,%s,0,%s,'2026-08-27')",
        (fid, partia, rid, qty, kg, qty * kg, qty))


def _wz(wid="w1", buyer="MATEUSZ STYRNIK", nip="", linie=None,
        source_type="manual", status="wstepny", seq=70):
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, source_type, "
        " source_id, buyer_name, buyer_nip, valued, lines, status, currency, "
        " pallets_h1, pallets_other, issued_date, created_at) "
        "VALUES (%s,%s,%s,'08/26',%s,NULL,%s,%s,false,%s::jsonb,%s,'PLN',0,0,"
        " '2026-08-28',now())",
        (wid, f"WZ/{seq}/08/26", seq, source_type, buyer, nip,
         json.dumps(linie or []), status))


def _linia(stock_id, qty, typ="fg"):
    return {"stock_type": typ, "stock_id": stock_id, "qty": qty, "unit": "szt"}


def test_hdi_z_recznego_wz_ma_pozycje_i_partie(db):
    _receptura()
    _wyrob("f1", qty=3, kg=80)
    _wz(linie=[_linia("f1", 3)])

    hdi = build_hdi_from_wz("w1")

    assert hdi["totals"] == {"qty": 3, "kg": 240.0}
    assert len(hdi["items"]) == 1
    poz = hdi["items"][0]
    assert poz["qty"] == 3 and poz["kg"] == 240.0
    # Partia z wsadu + data produkcji, jak na HDI z zamówienia.
    assert poz["batches"][0]["partia"] == "270826 507"
    assert poz["batches"][0]["termin"]          # termin przydatności policzony


def test_numer_jest_staly_dla_tego_samego_wz(db):
    """Ponowne „Generuj" odświeża dokument, nie nabija kolejnego numeru."""
    _receptura()
    _wyrob("f1")
    _wz(linie=[_linia("f1", 3)])

    a = generate_hdi_from_wz("w1")
    b = generate_hdi_from_wz("w1")

    assert a["number"] == b["number"] and a["id"] == b["id"]
    assert query_one("SELECT COUNT(*) c FROM hdi_documents")["c"] == 1
    # Dokument wisi na WZ, nie na zamówieniu.
    row = query_one("SELECT order_id, wz_id FROM hdi_documents WHERE id=%s", (a["id"],))
    assert row["order_id"] is None and row["wz_id"] == "w1"


def test_wz_z_zamowienia_odsylamy_do_wlasnej_sciezki(db):
    """WZ z zamówienia ma HDI liczone z produkcji — tu go nie dublujemy."""
    _receptura()
    _wyrob("f1")
    _wz(linie=[_linia("f1", 3)], source_type="order")

    with pytest.raises(HTTPException) as e:
        build_hdi_from_wz("w1")
    assert e.value.status_code == 409


def test_anulowany_wz_nie_dostaje_hdi(db):
    _receptura()
    _wyrob("f1")
    _wz(linie=[_linia("f1", 3)], status="anulowany")

    with pytest.raises(HTTPException) as e:
        build_hdi_from_wz("w1")
    assert e.value.status_code == 409


def test_wz_bez_wyrobu_gotowego_mowi_dlaczego(db):
    """Sprzedaż samego surowca albo ubocznych to nie wyrób — HDI nie ma z czego
    powstać, ale komunikat ma to nazwać, a nie wywalić 500."""
    _wz(linie=[_linia("lot1", 200, typ="meat")])

    with pytest.raises(HTTPException) as e:
        build_hdi_from_wz("w1")
    assert e.value.status_code == 400
    assert "wyrob" in e.value.detail.lower() or "wyrób" in e.value.detail.lower()


# ── Kto MOŻE dostać HDI (29.08.2026) ────────────────────────────────────────
#
# Zgłoszenie właściciela: przycisk „HDI" ma stać tylko przy WZ z wyrobem
# (kebab). Uboczne — grzbiety, kości, mięso z/s — niosą identyfikację partii
# w sekcji HDI drukowanej NA SAMYM WZ, więc osobny dokument jest im niepotrzebny
# i tylko myli biuro (klik kończył się komunikatem o błędzie). Lista WZ musi
# powiedzieć ekranowi, czy dokument w ogóle wydaje wyrób gotowy.
def test_lista_wz_mowi_ktory_dokument_wydaje_wyrob_gotowy(db):
    from app.services.wz_service import list_wz

    _receptura()
    _wyrob("fg-hasfg", qty=2, kg=80)
    _wz("wz-kebab", linie=[_linia("fg-hasfg", 2)], seq=91)
    _wz("wz-uboczne", seq=92, linie=[
        {"stock_type": "byproduct", "stock_id": "lot-1", "qty": 120.0,
         "unit": "kg", "name": "GRZBIETY", "batch_no": "507"}])
    _wz("wz-puste", seq=93, linie=[])

    flagi = {d["id"]: d.get("has_fg") for d in list_wz()}
    assert flagi["wz-kebab"] is True
    assert flagi["wz-uboczne"] is False
    assert flagi["wz-puste"] is False


def _klient(nazwa="POLAT", tryb="type", nip="SI12345678", nazwy_receptur=None):
    execute(
        "INSERT INTO clients (id, code, name, nip, language, hdi_name_mode, active, created_at) "
        "VALUES ('c-polat','K90',%s,%s,'sl',%s,true,now())",
        (nazwa, nip, tryb))
    for rid, nowa in (nazwy_receptur or {}).items():
        execute("INSERT INTO client_recipe_names (client_id, recipe_id, name) "
                "VALUES ('c-polat',%s,%s)", (rid, nowa))


def test_odbiorca_w_trybie_rodzaju_ma_na_hdi_sam_rodzaj(db):
    """POLAT (31.08.2026): „na HDI tylko rodzaj i kg" — nazwa receptury to
    nasza kuchnia, odbiorca rozpoznaje wyrób po rodzaju i wadze."""
    _receptura()
    _wyrob("f1", qty=3, kg=80)
    _klient()
    _wz(linie=[_linia("f1", 3)], buyer="POLAT", nip="SI12345678")

    hdi = build_hdi_from_wz("w1")

    assert hdi["items"][0]["name"] == "KEBAB UDO 100% 80KG"


def test_odbiorca_domyslny_ma_rodzaj_z_receptura(db):
    _receptura()
    _wyrob("f1", qty=3, kg=80)
    _klient(nazwa="TRUVA", tryb="type_recipe", nip="PL999")
    _wz(linie=[_linia("f1", 3)], buyer="TRUVA", nip="PL999")

    hdi = build_hdi_from_wz("w1")

    assert hdi["items"][0]["name"] == "KEBAB UDO 100% WROCŁAW 80KG"


def test_wlasna_nazwa_receptury_odbiorcy_schodzi_na_hdi(db):
    """U POLATA receptura „WROCŁAW" ma schodzić jako „BEYAZ"."""
    _receptura()
    _wyrob("f1", qty=3, kg=80)
    _klient(tryb="recipe", nazwy_receptur={"r1": "BEYAZ"})
    _wz(linie=[_linia("f1", 3)], buyer="POLAT", nip="SI12345678")

    hdi = build_hdi_from_wz("w1")

    assert hdi["items"][0]["name"] == "BEYAZ 80KG"
