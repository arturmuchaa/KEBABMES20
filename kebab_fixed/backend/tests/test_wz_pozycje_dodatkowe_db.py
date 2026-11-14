"""Pozycje dodatkowe na WZ/WM: z ręki (jogurt) i z magazynu surowca (łój).

Zasada (właściciel 14.11.2026): WM = wszystko, co wyszło z magazynu (rusza
stan); WZ = dokument dla klienta do zapłaty (Rozrachunki liczą tylko WZ).
"""
import json

from app.db import execute, query_one, transaction
from app.services.split_documents_service import anuluj_dokumenty_podzialu, wystaw_wz_klienta, wystaw_wz_wewnetrzny
import pytest
from fastapi import HTTPException

from app.services.wz_service import create_manual_wz, create_wz_from_order, cancel_wz, get_wz, wydaj_surowiec
from app.services.wz_pozycje_dodatkowe import dopisz_pozycje, usun_pozycje
from app.services.rozrachunki_service import karta_klienta
from app.utils.ids import now_iso
from tests.conftest_split import _firma, _klient, _przygotuj_bez_podzialu, _przygotuj_z_podzialem


def _loj(kg=100.0, bid="rb-loj", no="950"):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, created_at) "
        "VALUES (%s,%s,'KOKO',%s,%s,'active','mat-loj-otokowy','Łój wołowy otokowy',%s)",
        (bid, no, kg, kg, now_iso()))
    return bid


def _kg(bid="rb-loj"):
    return float(query_one("SELECT kg_available FROM raw_batches WHERE id=%s", (bid,))["kg_available"])


def _dopisz_recznie_na_wm(wm_id, sel):
    """Do Task 2: linia surowca wpisana na WM przez wspólny rozchód."""
    with transaction() as conn:
        pola = wydaj_surowiec(conn, wm_id, sel)
        row = query_one("SELECT lines FROM wz_documents WHERE id=%s", (wm_id,))
        lines = row["lines"] or []
        lines.append({"name": sel["name"], "qty": sel["qty"], "unit": "kg", **pola})
        conn.cursor().execute("UPDATE wz_documents SET lines=%s WHERE id=%s", (json.dumps(lines), wm_id))


def test_anulowanie_kompletu_oddaje_dopisany_surowiec(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    wm = wystaw_wz_wewnetrzny("o1")
    bid = _loj()
    _dopisz_recznie_na_wm(wm["id"], {"stock_type": "raw", "stock_id": bid, "qty": 15.0, "name": "Łój wołowy otokowy"})
    assert _kg(bid) == 85.0
    anuluj_dokumenty_podzialu("o1")
    assert _kg(bid) == 100.0


def test_cancel_wz_raw_bez_zmian(db):
    from tests.conftest_split import _firma, _klient
    _firma(); _klient()
    bid = _loj()
    wz = create_manual_wz(buyer={"name": "VATAN"}, selections=[
        {"stock_type": "raw", "stock_id": bid, "qty": 15.0, "name": "Łój wołowy otokowy", "unit": "kg", "price": 2}])
    assert _kg(bid) == 85.0
    cancel_wz(wz["id"])
    assert _kg(bid) == 100.0


# ── Task 2: dopisywanie / usuwanie ────────────────────────────────────────
JOGURT = {"lineId": "J1", "rodzaj": "reczna", "name": "Jogurt naturalny", "qty": "10",
          "unit": "szt", "price": "4,50", "vatRate": 5}


def _loj_sel(bid, kg="15", line="L1", **kw):
    return {"lineId": line, "rodzaj": "surowiec", "stockType": "raw", "stockId": bid,
            "name": "Łój wołowy otokowy", "qty": kg, "unit": "kg", "price": "2,00", "vatRate": 5, **kw}


def _zwykla_wz(currency="PLN", eur_rate=None):
    _firma(); _klient()
    bid = _loj(bid="rb-x", no="901")
    return create_manual_wz(buyer={"name": "YBM Gastro GmbH"}, currency=currency, eur_rate=eur_rate, selections=[
        {"stock_type": "raw", "stock_id": bid, "qty": 10.0, "name": "Łój wołowy zwykły", "unit": "kg", "price": 3}])


def _linie(wz_id):
    return get_wz(wz_id)["lines"]


def test_a_jogurt_na_zwyklej_wz_podnosi_wartosc_i_saldo_bez_stanu(db):
    wz = _zwykla_wz()
    przed = float(get_wz(wz["id"])["total_value"])
    ruchy = query_one("SELECT count(*) n FROM stock_movements")["n"]
    dopisz_pozycje(wz["id"], dict(JOGURT))
    po = get_wz(wz["id"])
    assert float(po["total_value"]) == pytest.approx(przed + 45.0)
    assert query_one("SELECT count(*) n FROM stock_movements")["n"] == ruchy
    jog = [l for l in po["lines"] if l.get("line_id") == "J1"][0]
    assert jog["stock_type"] == "reczna" and jog.get("dopisana_at")
    obc = [o for o in karta_klienta("c1")["obciazenia"] if o.get("source_id") == wz["id"]]
    assert abs(float(obc[0]["amount"])) == pytest.approx(przed + 45.0)


def test_b_loj_przy_wm_i_wz_klienta(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    wm = wystaw_wz_wewnetrzny("o1"); wzk = wystaw_wz_klienta("o1")
    execute("UPDATE wz_documents SET valued=true WHERE id=%s", (wzk["id"],))  # WZ do zapłaty ma ceny
    bid = _loj()
    dopisz_pozycje(wm["id"], _loj_sel(bid))
    assert _kg(bid) == 85.0
    na_wm = [l for l in _linie(wm["id"]) if l.get("line_id") == "L1"]
    na_wzk = [l for l in _linie(wzk["id"]) if l.get("line_id") == "L1"]
    assert na_wm[0]["stock_id"] == bid and na_wm[0]["stock_type"] == "raw"
    assert not na_wzk[0].get("stock_id") and na_wzk[0]["value"] == 30.0


def test_b2_wywolanie_na_wz_klienta_trafia_do_pary(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    wm = wystaw_wz_wewnetrzny("o1"); wzk = wystaw_wz_klienta("o1")
    bid = _loj()
    dopisz_pozycje(wzk["id"], _loj_sel(bid))
    assert any(l.get("stock_id") == bid for l in _linie(wm["id"]))
    dopisz_pozycje(wzk["id"], dict(JOGURT))
    assert any(l.get("line_id") == "J1" for l in _linie(wzk["id"]))
    assert not any(l.get("line_id") == "J1" for l in _linie(wm["id"]))


def test_b3_loj_nie_do_zaplaty_tylko_na_wm(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    wm = wystaw_wz_wewnetrzny("o1"); wzk = wystaw_wz_klienta("o1")
    bid = _loj()
    dopisz_pozycje(wm["id"], _loj_sel(bid, doZaplaty=False))
    assert not any(l.get("line_id") == "L1" for l in _linie(wzk["id"]))


def test_c_sam_wm_odrzuca_jogurt_przyjmuje_loj(db):
    _przygotuj_bez_podzialu()
    wm = create_wz_from_order("o1")
    with pytest.raises(HTTPException) as e:
        dopisz_pozycje(wm["id"], dict(JOGURT))
    assert e.value.status_code == 409 and "Subiekt" in e.value.detail
    bid = _loj()
    dopisz_pozycje(wm["id"], _loj_sel(bid))
    assert _kg(bid) == 85.0


def test_d_loj_ponad_stan_odmowa_i_nic_nie_zapisane(db):
    wz = _zwykla_wz()
    bid = _loj(kg=10.0)
    przed = _linie(wz["id"])
    with pytest.raises(HTTPException) as e:
        dopisz_pozycje(wz["id"], _loj_sel(bid, kg="15"))
    assert e.value.status_code == 400 and "950" in e.value.detail
    assert _kg(bid) == 10.0 and _linie(wz["id"]) == przed


def test_e_powtorzony_line_id_nie_dubluje(db):
    wz = _zwykla_wz()
    bid = _loj()
    dopisz_pozycje(wz["id"], _loj_sel(bid))
    dopisz_pozycje(wz["id"], _loj_sel(bid))
    assert len([l for l in _linie(wz["id"]) if l.get("line_id") == "L1"]) == 1
    assert _kg(bid) == 85.0


def test_f_usuniecie_oddaje_stan_i_znika_z_obu(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    wm = wystaw_wz_wewnetrzny("o1"); wzk = wystaw_wz_klienta("o1")
    bid = _loj()
    dopisz_pozycje(wm["id"], _loj_sel(bid))
    usun_pozycje(wzk["id"], "L1")
    assert _kg(bid) == 100.0
    assert not any(l.get("line_id") == "L1" for l in _linie(wm["id"]) + _linie(wzk["id"]))


def test_f2_wyrobu_nie_da_sie_usunac(db):
    wz = _zwykla_wz()
    with pytest.raises(HTTPException) as e:
        usun_pozycje(wz["id"], "nie-ma")
    assert e.value.status_code == 409


def test_g_eur_wartosc_w_walucie_dokumentu(db):
    wz = _zwykla_wz(currency="EUR", eur_rate=4.25)
    przed = float(get_wz(wz["id"])["total_value"])
    dopisz_pozycje(wz["id"], dict(JOGURT))
    po = get_wz(wz["id"])
    assert po["currency"] == "EUR" and float(po["eur_rate"]) == 4.25
    assert float(po["total_value"]) == pytest.approx(przed + 45.0)


def test_h_anulowana_odrzuca(db):
    wz = _zwykla_wz()
    cancel_wz(wz["id"])
    with pytest.raises(HTTPException) as e:
        dopisz_pozycje(wz["id"], dict(JOGURT))
    assert e.value.status_code == 409


def test_trasy_dopisz_i_usun(db):
    from app.routes import wz as route
    wz = _zwykla_wz()
    po = route.dopisz_pozycje(wz["id"], dict(JOGURT))
    assert any(l.get("line_id") == "J1" for l in po["lines"])
    po = route.usun_pozycje(wz["id"], "J1")
    assert not any(l.get("line_id") == "J1" for l in po["lines"])


def test_lancuch_ilosci_bez_pozycji_dodatkowych(db):
    from app.services.orders_service import quantity_chain
    _przygotuj_bez_podzialu()
    wm = create_wz_from_order("o1")
    przed = quantity_chain("o1")["lines"]
    bid = _loj()
    dopisz_pozycje(wm["id"], _loj_sel(bid))
    assert quantity_chain("o1")["lines"] == przed


def test_manual_wz_z_wyrobem_jogurtem_i_lojem(db):
    _przygotuj_bez_podzialu()
    fg = query_one("SELECT id, qty_available, kg_per_unit FROM finished_goods WHERE id='f1'")
    bid = _loj()
    ruchy_przed = query_one("SELECT count(*) n FROM stock_movements")["n"]
    wz = create_manual_wz(buyer={"name": "YBM Gastro GmbH"}, order_id=None, selections=[
        {"stock_type": "fg", "stock_id": "f1", "qty": 2, "name": "KEBAB", "unit": "szt", "price": 3,
         "kg_per_unit": fg["kg_per_unit"], "vat_rate": 5},
        {"stock_type": "reczna", "line_id": "J1", "name": "Jogurt naturalny", "qty": "10", "unit": "szt",
         "price": "4,50", "vat_rate": 5},
        {"stock_type": "raw", "stock_id": bid, "qty": 15.0, "name": "Łój wołowy otokowy", "unit": "kg",
         "price": 2, "vat_rate": 5}])
    linie = get_wz(wz["id"])["lines"]
    assert [l["stock_type"] for l in linie] == ["fg", "reczna", "raw"]
    jog = linie[1]
    assert jog["line_id"] == "J1" and jog["value"] == 45.0 and not jog.get("stock_id")
    assert _kg(bid) == 85.0
    assert int(query_one("SELECT qty_available FROM finished_goods WHERE id='f1'")["qty_available"]) == int(fg["qty_available"]) - 2
    assert query_one("SELECT count(*) n FROM stock_movements")["n"] == ruchy_przed + 2
    kg_fg = 2 * float(fg["kg_per_unit"])
    assert float(get_wz(wz["id"])["total_value"]) == pytest.approx(kg_fg * 3 + 45.0 + 30.0)


def test_opis_dokumentu_dla_okna(db):
    from app.services.wz_pozycje_dodatkowe import opis_dokumentu
    _przygotuj_z_podzialem(cel_kg=300.0)
    wm = wystaw_wz_wewnetrzny("o1"); wzk = wystaw_wz_klienta("o1")
    o = opis_dokumentu(wzk["id"])
    assert o["para"] == "wm_wzk" and o["bez_recznej"] is None
    assert [d["id"] for d in o["dokumenty"]] == [wm["id"], wzk["id"]]
    assert o["currency"] == "PLN"


def test_opis_sam_wm_blokuje_reczna(db):
    from app.services.wz_pozycje_dodatkowe import opis_dokumentu, KOMUNIKAT_SAM_WM
    _przygotuj_bez_podzialu()
    wm = create_wz_from_order("o1")
    o = opis_dokumentu(wm["id"])
    assert o["para"] == "sam_wm" and o["bez_recznej"] == KOMUNIKAT_SAM_WM


def test_opis_zwykla_wz(db):
    from app.services.wz_pozycje_dodatkowe import opis_dokumentu
    wz = _zwykla_wz(currency="EUR", eur_rate=4.25)
    o = opis_dokumentu(wz["id"])
    assert o["para"] == "jeden" and o["currency"] == "EUR" and float(o["eur_rate"]) == 4.25
    assert len(o["dokumenty"]) == 1
