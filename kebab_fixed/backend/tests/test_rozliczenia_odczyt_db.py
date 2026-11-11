"""Rozliczenia — odczyt: karta klienta, lista kontrahentów, szczegóły dokumentu.

Scenariusz ROJPAK ze szkicu (klient w EUR, start przestawiony na 01.10.2026).
Faktury, wpłaty i salda otwarcia wstawiane bezpośrednim INSERT-em — funkcje
zapisu powstają w osobnym zadaniu. Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.db import execute, query_one
from app.services.rozliczenia_service import dokument, karta, lista
from app.services.rozliczenia_wz import (historia, synchronizuj_wz,
                                         ustaw_date_startu)
from tests.test_rozliczenia_wz_db import _wz

DZIS = date(2026, 11, 9)


def _poz(kwota):
    return [{"value": kwota, "vat_rate": 0}]


def _klient(cid, nazwa=None, nip=None, waluta="PLN"):
    execute("INSERT INTO clients (id, code, name, nip, settlement_currency) "
            "VALUES (%s,%s,%s,%s,%s)", (cid, cid.upper(), nazwa or cid.upper(), nip, waluta))
    return cid


def _faktura(cid, numer, data, kwota, waluta="EUR", termin=None, fid=None):
    fid = fid or f"fv-{cid}-{numer}"
    execute("INSERT INTO rozl_dokumenty (id, client_id, ksiega, zrodlo, numer, data_dok, "
            " kwota, waluta, termin, forma) VALUES (%s,%s,'fv','reczna',%s,%s,%s,%s,%s,'przelew')",
            (fid, cid, numer, data, kwota, waluta, termin or data + timedelta(days=7)))
    historia(None, client_id=cid, obiekt="dokument", obiekt_id=fid, akcja="dodano",
             opis=f"dodano fakturę {numer}", po={"kwota": kwota}, kto="biuro")
    return fid


def _wplata(cid, ksiega, kwota, data, dokument_id=None, waluta="EUR", forma="przelew",
            wid=None):
    wid = wid or f"wp-{cid}-{ksiega}-{data.isoformat()}-{kwota}"
    execute("INSERT INTO rozl_wplaty (id, client_id, ksiega, forma, kwota, waluta, data, "
            " dokument_id, utworzyl) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'biuro')",
            (wid, cid, ksiega, forma, kwota, waluta, data, dokument_id))
    return wid


def _otwarcie(cid, ksiega, kwota, zalegle_od=None, waluta="PLN", uwagi=""):
    execute("INSERT INTO rozl_otwarcia (client_id, ksiega, kwota, waluta, zalegle_od, uwagi) "
            "VALUES (%s,%s,%s,%s,%s,%s)", (cid, ksiega, kwota, waluta, zalegle_od, uwagi))


def _id_wz(wid):
    return query_one("SELECT id FROM rozl_dokumenty WHERE zrodlo='mes_wz' AND source_id=%s",
                     (wid,))["id"]


@pytest.fixture
def przywroc_start():
    try:
        yield
    finally:
        execute("UPDATE app_settings SET value='\"2026-11-09\"'::jsonb "
                "WHERE key='rozliczenia_start'")


@pytest.fixture
def rojpak(db, przywroc_start):
    ustaw_date_startu(date(2026, 10, 1), "admin")
    cid = _klient("rojpak", "ROJPAK", nip="DE123456789", waluta="EUR")
    for wid, numer, dzien, kwota in [("w1", "WZ 14/10", "2026-10-18", 7425),
                                     ("w2", "WZ 21/10", "2026-10-27", 6120),
                                     ("w3", "WZ 02/11", "2026-11-03", 5289.50),
                                     ("w4", "WZ 05/11", "2026-11-08", 4464)]:
        _wz(wid, cid, numer=numer, release_date=dzien, lines=_poz(kwota),
            buyer_name="ROJPAK", currency="EUR")
    synchronizuj_wz()
    _wplata(cid, "wz", 7425, date(2026, 10, 18), forma="gotowka")
    _wplata(cid, "wz", 3000, date(2026, 10, 27), forma="gotowka")
    _wplata(cid, "wz", 4464, date(2026, 11, 8), dokument_id=_id_wz("w4"), forma="gotowka")
    fv = {}
    for numer, dzien, kwota in [("512", date(2026, 10, 18), 17325.00),
                                ("528", date(2026, 10, 27), 14280.00),
                                ("541", date(2026, 11, 3), 12342.20),
                                ("553", date(2026, 11, 8), 10416.00)]:
        fv[numer] = _faktura(cid, numer, dzien, kwota)
    _wplata(cid, "fv", 17325, date(2026, 10, 20))
    _wplata(cid, "fv", 7000, date(2026, 10, 30))
    return {"cid": cid, "fv": fv}


def _po_numerze(dokumenty, numer):
    return next(d for d in dokumenty if d["numer"] == numer)


# ── Karta klienta ───────────────────────────────────────────────────────

def test_karta_ROJPAK_salda(rojpak):
    k = karta(rojpak["cid"], dzis=DZIS)

    assert k["saldo"] == {"wz": -8409.50, "fv": -30038.20, "lacznie": -38447.70,
                          "po_terminie_wz": 8409.50, "po_terminie_fv": 7280.00,
                          "najstarsza_dni_wz": 13, "najstarsza_dni_fv": 6}
    assert k["start"] == "2026-10-01"
    assert k["klient"]["waluta"] == "EUR"
    assert k["klient"]["nazwa"] == "ROJPAK"


def test_karta_ROJPAK_stany_i_kolejnosc(rojpak):
    k = karta(rojpak["cid"], dzis=DZIS)

    wz21 = _po_numerze(k["dokumenty"]["wz"], "WZ 21/10")
    assert wz21["stan"] == {"kod": "po_terminie", "dni": 13, "czesciowo": True}
    assert wz21["zaplacono"] == 3000.0
    assert wz21["zostalo"] == 3120.0
    assert wz21["data"] == "2026-10-27"
    assert wz21["forma"] == "gotowka"
    assert wz21["zrodlo"] == "mes_wz"
    assert wz21["otwarcie"] is False
    assert wz21["zamkniety"] is None
    assert _po_numerze(k["dokumenty"]["fv"], "541")["stan"]["kod"] == "termin_jutro"
    assert k["dokumenty"]["fv"][0]["numer"] == "553"
    zaplacona = _po_numerze(k["dokumenty"]["fv"], "512")
    assert zaplacona["stan"]["kod"] == "zaplacony"
    assert zaplacona["zamkniety"] == "2026-10-20"


def test_karta_ROJPAK_wplaty_z_przydzialami(rojpak):
    k = karta(rojpak["cid"], dzis=DZIS)

    assert len(k["wplaty"]) == 5
    assert k["wplaty"][0]["data"] == "2026-11-08"
    w7000 = next(w for w in k["wplaty"] if w["kwota"] == 7000.0)
    assert w7000["ksiega"] == "fv"
    assert w7000["przydzialy"] == [{"numer": "528", "kwota": 7000.0}]
    assert w7000["reszta"] == 0.0
    assert w7000["utworzyl"] == "biuro"


def test_filtr_okresu_zaweza_liste_a_nie_salda(rojpak):
    pelna = karta(rojpak["cid"], dzis=DZIS)
    k = karta(rojpak["cid"], dzis=DZIS, od=date(2026, 11, 1), do=date(2026, 11, 5))

    assert [d["numer"] for d in k["dokumenty"]["fv"]] == ["541"]
    assert [d["numer"] for d in k["dokumenty"]["wz"]] == ["WZ 02/11"]
    assert k["saldo"] == pelna["saldo"]


def test_karta_nieznanego_klienta_404(db):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        karta("nie-ma", dzis=DZIS)
    assert e.value.status_code == 404


# ── Lista kontrahentów ──────────────────────────────────────────────────

def test_lista_ROJPAK(rojpak):
    wynik = lista(dzis=DZIS)

    wiersz = next(r for r in wynik["kontrahenci"] if r["id"] == rojpak["cid"])
    assert wiersz["saldo"] == -38447.70
    assert wiersz["saldo_wz"] == -8409.50
    assert wiersz["saldo_fv"] == -30038.20
    assert wiersz["po_terminie"] == 15689.50
    assert wiersz["najstarsza_dni"] == 13
    assert wiersz["stan"] == "po_terminie"
    assert wiersz["najblizszy_termin_dni"] == 1
    assert wiersz["przypomnienie"] is False
    assert wynik["podsumowanie"]["EUR"]["naleznosci"] == 38447.70
    assert wynik["podsumowanie"]["EUR"]["gotowka_wz"] == 8409.50
    assert wynik["podsumowanie"]["EUR"]["po_terminie"] == 15689.50
    assert wynik["podsumowanie"]["PLN"] == {"naleznosci": 0.0, "po_terminie": 0.0,
                                            "gotowka_wz": 0.0, "nadplaty": 0.0}
    assert wynik["start"] == "2026-10-01"


def test_lista_rozliczony_i_klient_bez_niczego(db):
    _klient("roz")
    _klient("pusty")
    fid = _faktura("roz", "FV/1", date(2026, 11, 9), 1000, waluta="PLN")
    _wplata("roz", "fv", 1000, date(2026, 11, 9), dokument_id=fid, waluta="PLN")

    wynik = lista(dzis=DZIS)

    ids = [r["id"] for r in wynik["kontrahenci"]]
    assert ids == ["roz"]
    assert wynik["kontrahenci"][0]["stan"] == "rozliczony"
    assert wynik["kontrahenci"][0]["najblizszy_termin_dni"] is None


def test_lista_kolejnosc_najstarsza_potem_saldo(db):
    _klient("a")
    _klient("b")
    _klient("c")
    _faktura("a", "1", date(2026, 11, 1), 100, waluta="PLN")    # termin 08.11 → 1 dzień
    _faktura("b", "1", date(2026, 10, 25), 50, waluta="PLN")    # termin 01.11 → 8 dni
    _faktura("c", "1", date(2026, 11, 1), 500, waluta="PLN")    # 1 dzień, większy dług

    assert [r["id"] for r in lista(dzis=DZIS)["kontrahenci"]] == ["b", "c", "a"]


def test_lista_przypomnienie_z_dziennika(db):
    _klient("p")
    _faktura("p", "1", date(2026, 11, 9), 100, waluta="PLN")
    execute("INSERT INTO rozl_dziennik (id, client_id, tresc, przypomnij) "
            "VALUES ('d1','p','zadzwonić',%s)", (DZIS,))

    assert lista(dzis=DZIS)["kontrahenci"][0]["przypomnienie"] is True
    assert lista(dzis=DZIS - timedelta(days=1))["kontrahenci"][0]["przypomnienie"] is False
    execute("UPDATE rozl_dziennik SET odhaczono_at=now()")
    assert lista(dzis=DZIS)["kontrahenci"][0]["przypomnienie"] is False


def test_lista_WZ_bez_kontrahenta(db):
    _wz("w1", numer="WZ/9/11/26", buyer_name="NIKT TAKI", lines=[{"value": 100, "vat_rate": 5}])

    wynik = lista(dzis=DZIS)

    assert wynik["kontrahenci"] == []
    assert wynik["bez_kontrahenta"] == [{"id": _id_wz("w1"), "numer": "WZ/9/11/26",
                                         "data": "2026-11-10", "kwota": 105.0,
                                         "waluta": "PLN", "nabywca": "NIKT TAKI"}]


# ── Saldo otwarcia ──────────────────────────────────────────────────────

def test_saldo_otwarcia_ujemne_to_najstarszy_dokument(db):
    _klient("o")
    _otwarcie("o", "fv", -1000, zalegle_od=date(2026, 10, 20), uwagi="z Excela")
    _wplata("o", "fv", 400, date(2026, 11, 9), waluta="PLN")

    k = karta("o", dzis=DZIS)

    otw = _po_numerze(k["dokumenty"]["fv"], "Saldo otwarcia")
    assert otw["otwarcie"] is True
    assert otw["id"] == "otwarcie-fv"
    assert otw["zostalo"] == 600.0
    assert otw["data"] == "2026-10-20"
    assert otw["stan"] == {"kod": "po_terminie", "dni": 20, "czesciowo": True}
    assert k["saldo"]["fv"] == -600.0
    assert k["otwarcia"] == {"wz": None, "fv": {"kwota": -1000.0, "zalegle_od": "2026-10-20",
                                               "uwagi": "z Excela"}}


def test_saldo_otwarcia_bez_daty_zaleglosci_liczy_od_startu(db):
    _klient("o")
    _otwarcie("o", "wz", -200)

    otw = karta("o", dzis=DZIS + timedelta(days=3))["dokumenty"]["wz"][0]

    assert otw["data"] == "2026-11-09"
    assert otw["termin"] == "2026-11-09"
    assert otw["stan"]["dni"] == 3


def test_saldo_otwarcia_dodatnie_to_nadplata(db):
    _klient("n")
    _otwarcie("n", "wz", 350)

    k = karta("n", dzis=DZIS)
    wynik = lista(dzis=DZIS)

    assert k["saldo"]["wz"] == 350.0
    assert k["dokumenty"]["wz"] == []
    assert k["wplaty"] == []
    wiersz = next(r for r in wynik["kontrahenci"] if r["id"] == "n")
    assert wiersz["stan"] == "nadplata"
    assert wynik["podsumowanie"]["PLN"]["nadplaty"] == 350.0


# ── Korekta i waluta ────────────────────────────────────────────────────

def test_faktura_korygujaca_zmniejsza_dlug(db):
    _klient("k")
    _faktura("k", "FV/1", date(2026, 11, 9), 2000, waluta="PLN")
    _faktura("k", "KOR/1", date(2026, 11, 9), -500, waluta="PLN")

    k = karta("k", dzis=DZIS)

    assert k["saldo"]["fv"] == -1500.0
    assert [d["numer"] for d in k["dokumenty"]["fv"]] == ["FV/1"]


def test_dokument_w_innej_walucie_nie_wchodzi_do_sald(db):
    _klient("x", waluta="PLN")
    _faktura("x", "FV/1", date(2026, 11, 9), 1000, waluta="PLN")
    execute("UPDATE clients SET settlement_currency='EUR' WHERE id='x'")

    k = karta("x", dzis=DZIS)

    assert k["saldo"]["lacznie"] == 0.0
    assert k["dokumenty"]["fv"] == []
    assert k["inna_waluta"] == [{"id": "fv-x-FV/1", "numer": "FV/1", "data": "2026-11-09",
                                 "kwota": 1000.0, "waluta": "PLN"}]
    assert lista(dzis=DZIS)["inna_waluta"] == 1


def test_usuniete_i_anulowane_poza_karta_czeka_na_ceny_osobno(db):
    _klient("u")
    fid = _faktura("u", "FV/1", date(2026, 11, 9), 1000, waluta="PLN")
    execute("UPDATE rozl_dokumenty SET usuniety_at=now(), powod_usuniecia='błąd' WHERE id=%s",
            (fid,))
    wid = _wplata("u", "fv", 300, date(2026, 11, 9), waluta="PLN")
    execute("UPDATE rozl_wplaty SET usuniety_at=now(), powod_usuniecia='błąd' WHERE id=%s",
            (wid,))
    _wz("w1", "u", numer="WZ/1", valued=False, buyer_name="U")
    _wz("w2", "u", numer="WZ/2", status="anulowany", buyer_name="U")

    k = karta("u", dzis=DZIS)

    assert k["saldo"]["lacznie"] == 0.0
    assert k["dokumenty"] == {"wz": [], "fv": []}
    assert k["wplaty"] == []
    assert k["czeka_na_ceny"] == [{"id": _id_wz("w1"), "numer": "WZ/1", "data": "2026-11-10"}]


def test_karta_dziennik(db):
    _klient("d")
    execute("INSERT INTO rozl_dziennik (id, client_id, tresc, przypomnij, kto) "
            "VALUES ('d1','d','obiecał zapłacić',%s,'artur')", (date(2026, 11, 10),))

    wpis = karta("d", dzis=DZIS)["dziennik"][0]

    assert wpis["tresc"] == "obiecał zapłacić"
    assert wpis["przypomnij"] == "2026-11-10"
    assert wpis["odhaczono"] is None
    assert wpis["kto"] == "artur"


# ── Szczegóły dokumentu ─────────────────────────────────────────────────

def test_dokument_FV_528_pokrycie_i_historia(rojpak):
    d = dokument(rojpak["fv"]["528"])

    assert d["numer"] == "528"
    assert d["zostalo"] == 7280.0
    assert d["pokrycie"] == [{"data": "2026-10-30", "forma": "przelew", "kwota": 7000.0,
                              "uwagi": ""}]
    assert d["historia"][0]["akcja"] == "dodano"
    assert d["historia"][0]["kto"] == "biuro"


def test_dokument_nieznany_404(db):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        dokument("nie-ma")
    assert e.value.status_code == 404
