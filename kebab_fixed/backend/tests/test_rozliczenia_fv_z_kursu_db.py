"""Rozliczenia — poprawki właściciela z 12.11.2026 (Task 2, backend).

* D4 — numer faktury z papierów kursu: wystawienie kursu z `invoice_no`
  i częścią fakturowaną dopisuje do rozrachunków FV BEZ KWOTY (numer, data,
  kg części fakturowanej). Kwotę wpisuje biuro (`edytuj_dokument`) — dopiero
  wtedy faktura wchodzi do salda i dostaje termin. Błąd dopisywania nigdy nie
  blokuje wystawienia papierów.
* D13 — saldo otwarcia jako lista zaległych dokumentów sprzed startu
  (`zrodlo='otwarcie'`): w księdze mimo daty sprzed startu, nigdy w obrocie
  ani w kg, edycja i usuwanie z historią.

Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from types import SimpleNamespace

import psycopg2.errors
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.migrations import run_migrations
from app.routes import rozliczenia as route
from app.services import rozliczenia_service as svc
from app.services.rozliczenia_service import (dodaj_fakture, dodaj_wplate, dodaj_zalegle,
                                              dokument, edytuj_dokument, historia_okresu,
                                              karta, lista, podglad_wplaty,
                                              rozliczenia_otwarte, ustaw_klienta,
                                              usun_dokument, zestawienie)
from app.services.rozliczenia_wz import synchronizuj_wz
from tests.test_finalize_loading_db import (_FORMA_CMR, _kurs_do_wystawienia,
                                            _kurs_dwoch_odbiorcow)
from tests.test_rozliczenia_odczyt_db import _klient, _poz
from tests.test_rozliczenia_wz_db import _wz

KTO = SimpleNamespace(state=SimpleNamespace(subject={"username": "ala"}))
_BEZ_NUMERU = {**_FORMA_CMR, "invoice_no": ""}


def _fv_kursu(cid="c1"):
    return query_all("SELECT * FROM rozl_dokumenty WHERE zrodlo='kurs' AND client_id=%s "
                     "AND usuniety_at IS NULL ORDER BY numer", (cid,))


def _wystaw(kurs, decyzje, forma=_BEZ_NUMERU):
    from app.services.loading_service import wystaw_z_kursu
    return wystaw_z_kursu(kurs, decyzje, forma)


# ═══ D4: FV z papierów kursu ════════════════════════════════════════════

def test_kurs_z_numerem_faktury_tworzy_fv_bez_kwoty_z_kg(db):
    kurs = _kurs_do_wystawienia()  # 10 szt × 30 kg

    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 180.0, "invoice_no": "FV 10/11/2026"}])

    [fv] = _fv_kursu()
    assert fv["ksiega"] == "fv" and fv["numer"] == "FV 10/11/2026"
    assert fv["kwota"] is None
    assert fv["stan_zrodla"] == "czeka_na_kwote"
    assert float(fv["kg"]) == 180.0
    assert fv["data_dok"] == date.today()
    assert fv["waluta"] == "PLN"
    assert fv["source_id"] == kurs
    h = query_all("SELECT akcja, kto FROM rozl_historia WHERE obiekt_id=%s", (fv["id"],))
    assert [r["akcja"] for r in h] == ["dodano"]


def test_numer_z_formularza_kursu_tez_tworzy_fv(db):
    """Pusty numer odbiorcy bierze numer z formularza kursu — ten sam, który
    idzie na CMR, więc ten sam trafia do rozrachunków."""
    kurs = _kurs_do_wystawienia()

    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 300.0}], _FORMA_CMR)

    [fv] = _fv_kursu()
    assert fv["numer"] == _FORMA_CMR["invoice_no"]
    assert float(fv["kg"]) == 300.0


def test_dwa_zamowienia_z_tym_samym_numerem_to_jedna_fv_z_suma_kg(db):
    kurs = _kurs_dwoch_odbiorcow()  # o1 i o2 — ten sam klient c1

    _wystaw(kurs, [
        {"order_id": "o1", "cel_kg": 300.0, "invoice_no": "FV 7/11/2026"},
        {"order_id": "o2", "cel_kg": 120.0, "invoice_no": "FV 7/11/2026"},
    ])

    [fv] = _fv_kursu()
    assert fv["numer"] == "FV 7/11/2026"
    assert float(fv["kg"]) == 420.0


def test_ponowne_wystawienie_nie_rusza_wpisanej_kwoty(db):
    kurs = _kurs_do_wystawienia()
    decyzje = [{"order_id": "o1", "cel_kg": 180.0, "invoice_no": "FV 10/11/2026"}]
    _wystaw(kurs, decyzje)
    [fv] = _fv_kursu()
    edytuj_dokument(fv["id"], {"kwota": 1500}, "biuro")

    _wystaw(kurs, decyzje)

    [po] = _fv_kursu()
    assert po["id"] == fv["id"]
    assert float(po["kwota"]) == 1500.0
    assert po["stan_zrodla"] == "aktywny"
    assert float(po["kg"]) == 180.0


def test_ponowne_wystawienie_z_innym_numerem_poprawia_numer(db):
    kurs = _kurs_do_wystawienia()
    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 180.0, "invoice_no": "FV 10/11/2026"}])
    [fv] = _fv_kursu()

    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 180.0, "invoice_no": "FV 11/11/2026"}])

    [po] = _fv_kursu()
    assert po["id"] == fv["id"] and po["numer"] == "FV 11/11/2026"
    h = query_all("SELECT akcja, przed, po FROM rozl_historia WHERE obiekt_id=%s "
                  "ORDER BY kiedy, id", (fv["id"],))
    assert h[-1]["po"] == {"numer": "FV 11/11/2026"}


def test_bez_numeru_faktury_nic_sie_nie_dzieje(db):
    kurs = _kurs_do_wystawienia()

    wynik = _wystaw(kurs, [{"order_id": "o1", "cel_kg": 180.0, "invoice_no": "  "}])

    assert wynik["ok"] is True
    assert query_all("SELECT id FROM rozl_dokumenty WHERE zrodlo='kurs'") == []


def test_bez_czesci_fakturowanej_nic_sie_nie_dzieje(db):
    kurs = _kurs_do_wystawienia()

    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 0, "invoice_no": "FV 10/11/2026"}])

    assert query_all("SELECT id FROM rozl_dokumenty WHERE zrodlo='kurs'") == []


def test_fv_bez_kwoty_nie_zmienia_salda_a_po_wpisaniu_kwoty_zmienia_i_ma_termin(db):
    kurs = _kurs_do_wystawienia()
    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 180.0, "invoice_no": "FV 10/11/2026"}])
    [fv] = _fv_kursu()

    k = karta("c1")
    assert k["saldo"]["fv"] == 0.0
    assert k["fv_bez_kwoty"] == 1
    [wiersz] = [d for d in k["dokumenty"]["fv"] if d["id"] == fv["id"]]
    assert wiersz["kwota"] is None and wiersz["stan"]["kod"] == "czeka_na_kwote"
    assert wiersz["kg"] == 180.0
    # kg klienta = 180 kg FV bez kwoty + 120 kg WZ części niefakturowanej
    # (niewyceniona — czeka na ceny); obrót 0.
    assert k["kg"] == 300.0 and k["obrot"] == 0.0
    assert dokument(fv["id"])["kwota"] is None

    # Pierwsze wpisanie kwoty nie wymaga powodu.
    d = edytuj_dokument(fv["id"], {"kwota": 1230.5}, "biuro")

    assert d["kwota"] == 1230.5
    assert d["termin"] == (date.today() + timedelta(days=7)).isoformat()
    assert d["stan"]["kod"] != "czeka_na_kwote"
    k = karta("c1")
    assert k["saldo"]["fv"] == -1230.5
    assert k["fv_bez_kwoty"] == 0
    assert k["obrot"] == 1230.5 and k["kg"] == 300.0
    h = query_all("SELECT akcja, przed, po, kto FROM rozl_historia WHERE obiekt_id=%s "
                  "AND akcja='kwota'", (fv["id"],))
    assert h == [{"akcja": "kwota", "przed": {"kwota": None}, "po": {"kwota": 1230.5},
                  "kto": "biuro"}]

    # Zmiana już wpisanej kwoty — jak przy fakturze ręcznej, z powodem.
    with pytest.raises(HTTPException) as e:
        edytuj_dokument(fv["id"], {"kwota": 1300}, "biuro")
    assert e.value.status_code == 400
    edytuj_dokument(fv["id"], {"kwota": 1300}, "biuro", powod="korekta Subiekt")
    assert karta("c1")["saldo"]["fv"] == -1300.0


def test_fv_z_kursu_pozwala_na_kwote_i_kg_ale_nie_numer(db):
    kurs = _kurs_do_wystawienia()
    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 180.0, "invoice_no": "FV 10/11/2026"}])
    [fv] = _fv_kursu()

    d = edytuj_dokument(fv["id"], {"kg": 181.5}, "biuro")
    assert d["kg"] == 181.5
    with pytest.raises(HTTPException) as e:
        edytuj_dokument(fv["id"], {"kwota": -10}, "biuro")
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        edytuj_dokument(fv["id"], {"numer": "X"}, "biuro")
    assert e.value.status_code == 400


def test_fv_z_kursu_mozna_usunac_z_powodem_i_wystawienie_jej_nie_wskrzesza(db):
    kurs = _kurs_do_wystawienia()
    decyzje = [{"order_id": "o1", "cel_kg": 180.0, "invoice_no": "FV 10/11/2026"}]
    _wystaw(kurs, decyzje)
    [fv] = _fv_kursu()

    usun_dokument(fv["id"], "zły numer", "biuro")
    _wystaw(kurs, decyzje)

    assert _fv_kursu() == []


def test_reczna_faktura_o_tym_numerze_nie_jest_dublowana(db):
    kurs = _kurs_do_wystawienia()
    dodaj_fakture("c1", numer="FV 10/11/2026", data=date.today(), kwota=999,
                  termin=None, forma=None, uwagi="", kto="biuro")

    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 180.0, "invoice_no": "FV 10/11/2026"}])

    rows = query_all("SELECT zrodlo, kwota FROM rozl_dokumenty WHERE numer='FV 10/11/2026'")
    assert [(r["zrodlo"], float(r["kwota"])) for r in rows] == [("reczna", 999.0)]


def test_wylaczony_klient_tez_dostaje_fv_ale_nie_ma_go_na_liscie(db):
    kurs = _kurs_do_wystawienia()
    ustaw_klienta("c1", {"wylaczony": True}, "biuro")

    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 180.0, "invoice_no": "FV 10/11/2026"}])

    assert len(_fv_kursu()) == 1
    assert "c1" not in {k["id"] for k in lista()["kontrahenci"]}


def test_klient_z_sama_fv_bez_kwoty_jest_na_liscie_ze_znacznikiem(db):
    kurs = _kurs_do_wystawienia()
    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 300.0, "invoice_no": "FV 10/11/2026"}])

    [k] = [k for k in lista()["kontrahenci"] if k["id"] == "c1"]
    assert k["fv_bez_kwoty"] == 1 and k["saldo_fv"] == 0.0


def test_blad_w_dopisywaniu_nie_wywraca_wystawienia(db, monkeypatch):
    """Nawet błąd SQL (przerwana transakcja) zostaje w punkcie zapisu —
    papiery kursu powstają, stan schodzi, kurs się zamyka."""
    from app.db import cx_execute, transaction

    def wybuch(*a, **kw):
        with transaction() as conn:
            cx_execute(conn, "INSERT INTO rozl_dokumenty (id) VALUES ('x')")  # NOT NULL

    monkeypatch.setattr(svc, "zapisz_fv_z_kursu", wybuch)
    kurs = _kurs_do_wystawienia()

    wynik = _wystaw(kurs, [{"order_id": "o1", "cel_kg": 180.0, "invoice_no": "FV 10/11/2026"}])

    assert wynik["orders"][0]["wm"]["number"].startswith("WM/")
    fg = query_one("SELECT qty_available, qty_shipped FROM finished_goods WHERE id='f1'")
    assert (int(fg["qty_available"]), int(fg["qty_shipped"])) == (0, 10)
    assert query_one("SELECT wz_status FROM loading_orders WHERE loading_id=%s",
                     (kurs,))["wz_status"] == "wystawiony"
    assert query_all("SELECT id FROM rozl_dokumenty WHERE zrodlo='kurs'") == []


def test_wyjatek_python_w_dopisywaniu_tez_nie_wywraca_wystawienia(db, monkeypatch):
    def wybuch(*a, **kw):
        raise RuntimeError("bum")

    monkeypatch.setattr(svc, "zapisz_fv_z_kursu", wybuch)
    kurs = _kurs_do_wystawienia()

    wynik = _wystaw(kurs, [{"order_id": "o1", "cel_kg": 180.0, "invoice_no": "FV 10/11/2026"}])

    assert wynik["ok"] is True


# ═══ Schemat: poszerzone CHECK-i, kwota NULL ═══════════════════════════

def test_migracja_poszerza_checki_na_starej_bazie(db):
    """Baza produkcyjna ma stare CHECK-i (bez 'kurs'/'otwarcie'/'czeka_na_kwote')
    i `kwota NOT NULL` — migracja musi je poszerzyć, idempotentnie."""
    execute("ALTER TABLE rozl_dokumenty DROP CONSTRAINT IF EXISTS rozl_dokumenty_zrodlo_check")
    execute("ALTER TABLE rozl_dokumenty DROP CONSTRAINT IF EXISTS "
            "rozl_dokumenty_stan_zrodla_check")
    execute("ALTER TABLE rozl_dokumenty DROP CONSTRAINT IF EXISTS rozl_dokumenty_kwota_check")
    execute("ALTER TABLE rozl_dokumenty ADD CONSTRAINT rozl_dokumenty_zrodlo_check "
            "CHECK (zrodlo IN ('mes_wz','reczna','subiekt'))")
    execute("ALTER TABLE rozl_dokumenty ADD CONSTRAINT rozl_dokumenty_stan_zrodla_check "
            "CHECK (stan_zrodla IN ('aktywny','czeka_na_ceny','anulowany'))")
    execute("ALTER TABLE rozl_dokumenty ALTER COLUMN kwota SET NOT NULL")

    run_migrations()
    run_migrations()

    _klient("k1")
    execute("INSERT INTO rozl_dokumenty (id, client_id, ksiega, zrodlo, numer, data_dok, "
            " kwota, termin, stan_zrodla) VALUES ('d1','k1','fv','kurs','FV 1',"
            " '2026-11-12', NULL, '2026-11-19', 'czeka_na_kwote')")
    execute("INSERT INTO rozl_dokumenty (id, client_id, ksiega, zrodlo, numer, data_dok, "
            " kwota, termin) VALUES ('d2','k1','wz','otwarcie','WZ 9/10',"
            " '2026-10-01', 100, '2026-10-01')")
    # Kwota NULL tylko dla FV z kursu.
    with pytest.raises(psycopg2.errors.CheckViolation):
        execute("INSERT INTO rozl_dokumenty (id, client_id, ksiega, zrodlo, numer, data_dok, "
                " kwota, termin) VALUES ('d3','k1','fv','reczna','FV 2',"
                " '2026-11-12', NULL, '2026-11-19')")
    defs = {r["conname"]: r["def"] for r in query_all(
        "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint "
        "WHERE conrelid='rozl_dokumenty'::regclass AND contype='c'")}
    assert "kurs" in defs["rozl_dokumenty_zrodlo_check"]
    assert "otwarcie" in defs["rozl_dokumenty_zrodlo_check"]
    assert "czeka_na_kwote" in defs["rozl_dokumenty_stan_zrodla_check"]


# ═══ D13: zaległe dokumenty sprzed startu ══════════════════════════════

START = date(2026, 11, 9)  # domyślna data startu w bazie testowej


def _zalegle(cid="k1", *wiersze):
    return dodaj_zalegle(cid, list(wiersze), "biuro")


def _wiersz(numer, data, kwota, ksiega="fv", termin=None, uwagi=""):
    return {"ksiega": ksiega, "numer": numer, "data": data, "kwota": kwota,
            "termin": termin, "uwagi": uwagi}


def test_zalegle_dokumenty_wchodza_do_ksiegi_mimo_daty_sprzed_startu(db):
    _klient("k1", "TRUVA")

    docs = _zalegle("k1",
                    _wiersz("FV 50/10/2026", date(2026, 10, 10), 1000,
                            termin=date(2026, 10, 24)),
                    _wiersz("FV 60/10/2026", date(2026, 10, 20), 500),
                    _wiersz("WZ 7/10", date(2026, 10, 15), 300, ksiega="wz"))

    assert [d["numer"] for d in docs] == ["FV 50/10/2026", "FV 60/10/2026", "WZ 7/10"]
    rows = query_all("SELECT zrodlo, ksiega, termin, forma, waluta, stan_zrodla, kg "
                     "FROM rozl_dokumenty WHERE client_id='k1' ORDER BY numer")
    assert {r["zrodlo"] for r in rows} == {"otwarcie"}
    assert {r["stan_zrodla"] for r in rows} == {"aktywny"}
    assert all(r["kg"] is None for r in rows)
    # Termin domyślny: data + termin klienta tej księgi (FV 7 dni, WZ 0).
    assert rows[1]["termin"] == date(2026, 10, 27)
    assert rows[2]["termin"] == date(2026, 10, 15)
    assert rows[2]["forma"] == "gotowka" and rows[0]["forma"] == "przelew"

    k = karta("k1", dzis=date(2026, 11, 12))
    assert k["saldo"]["fv"] == -1500.0 and k["saldo"]["wz"] == -300.0
    # Dni po terminie od PRAWDZIWEGO terminu dokumentu.
    [fv50] = [d for d in k["dokumenty"]["fv"] if d["numer"] == "FV 50/10/2026"]
    assert fv50["stan"] == {"kod": "po_terminie", "dni": 19, "czesciowo": False}
    assert fv50["zrodlo"] == "otwarcie" and fv50["otwarcie"] is False
    assert k["saldo"]["najstarsza_dni_fv"] == 19
    # Nigdy w obrocie ani w kg (D3a), także przy okresie „od zawsze”.
    k2 = karta("k1", okres_od=date(2026, 1, 1))
    assert k2["obrot"] == 0.0 and k2["kg"] == 0.0
    # Bramka C1: klient z samymi zaległymi dokumentami jest „otwarty”.
    assert k["rozliczenia_otwarte"] is True
    assert rozliczenia_otwarte("k1") is True
    # Lista: jest, z saldem, bez obrotu.
    [poz] = [r for r in lista()["kontrahenci"] if r["id"] == "k1"]
    assert poz["saldo"] == -1800.0 and poz["obrot"] == 0.0 and poz["kg"] == 0.0
    h = query_all("SELECT akcja, po FROM rozl_historia WHERE client_id='k1' "
                  "AND obiekt='dokument'")
    assert len(h) == 3 and {r["akcja"] for r in h} == {"dodano"}


def test_rozliczanie_od_najstarszych_i_wplata_do_wskazanego_zaleglego(db):
    _klient("k1")
    a, b = _zalegle("k1", _wiersz("FV 1/10", date(2026, 10, 1), 400),
                    _wiersz("FV 2/10", date(2026, 10, 5), 600))
    dodaj_fakture("k1", numer="FV 1/11", data=date(2026, 11, 10), kwota=200, termin=None,
                  forma=None, uwagi="", kto="biuro")

    p = podglad_wplaty("k1", ksiega="fv", kwota=500)
    assert [x["numer"] for x in p["przydzialy"]] == ["FV 1/10", "FV 2/10"]

    dodaj_wplate("k1", ksiega="fv", forma="przelew", kwota=600, data=date(2026, 11, 12),
                 dokument_id=b["id"], uwagi="", kto="biuro")
    d = dokument(b["id"])
    assert d["zostalo"] == 0.0 and d["pokrycie"][0]["rodzaj"] == "wplata"
    assert dokument(a["id"])["zostalo"] == 400.0


def test_zalegle_na_wydrukach_jak_zwykle_dokumenty(db):
    _klient("k1")
    _zalegle("k1", _wiersz("FV 1/10", date(2026, 10, 1), 400))

    z = zestawienie("k1", na_dzien=date(2026, 11, 12))
    assert [p["numer"] for p in z["fv"]["pozycje"]] == ["FV 1/10"]
    assert z["razem"] == 400.0

    h = historia_okresu("k1", date(2026, 9, 1), date(2026, 11, 30))
    assert [w["opis"] for w in h["fv"]["wiersze"]] == ["FV 1/10"]
    h2 = historia_okresu("k1", START, date(2026, 11, 30))
    assert h2["fv"]["saldo_poczatek"] == -400.0


def test_zalegle_walidacja(db):
    _klient("k1")
    _zalegle("k1", _wiersz("FV 1/10", date(2026, 10, 1), 400))

    def blad(*wiersze):
        with pytest.raises(HTTPException) as e:
            _zalegle("k1", *wiersze)
        assert e.value.status_code == 400
        return e.value.detail

    assert "startu" in blad(_wiersz("FV 9/11", START, 100))
    assert "FV 1/10" in blad(_wiersz("FV 1/10", date(2026, 10, 2), 100))
    blad(_wiersz("FV 3/10", date(2026, 10, 1), 100), _wiersz("FV 3/10", date(2026, 10, 2), 5))
    blad(_wiersz("FV 4/10", date(2026, 10, 1), 0))
    blad(_wiersz("FV 4/10", date(2026, 10, 1), -5))
    blad(_wiersz("", date(2026, 10, 1), 5))
    blad(_wiersz("FV 4/10", date(2026, 10, 10), 5, termin=date(2026, 10, 1)))
    blad(_wiersz("FV 4/10", date(2026, 10, 10), 5, ksiega="xx"))
    with pytest.raises(HTTPException):
        dodaj_zalegle("k1", [], "biuro")
    # Nic z odrzuconej paczki się nie zapisało.
    assert query_one("SELECT count(*) AS n FROM rozl_dokumenty")["n"] == 1
    # Ten sam numer w drugiej księdze — wolno.
    _zalegle("k1", _wiersz("FV 1/10", date(2026, 10, 1), 50, ksiega="wz"))
    with pytest.raises(HTTPException):
        _zalegle("k1", _wiersz("FV 1/10", date(2026, 10, 1), 50, ksiega="wz"))
    # Numer zajęty przez WZ z MES tego klienta (ta sama księga) — odmowa.
    _wz("w1", "k1", numer="WZ 1/11", release_date="2026-11-10", lines=_poz(10))
    synchronizuj_wz()
    with pytest.raises(HTTPException):
        _zalegle("k1", _wiersz("WZ 1/11", date(2026, 10, 1), 50, ksiega="wz"))


def test_zalegly_edycja_i_usuwanie_z_powodem_i_historia(db):
    _klient("k1")
    [d] = _zalegle("k1", _wiersz("FV 1/10", date(2026, 10, 1), 400))

    with pytest.raises(HTTPException):
        edytuj_dokument(d["id"], {"kwota": 300}, "biuro")
    edytuj_dokument(d["id"], {"kwota": 300}, "biuro", powod="część zapłacona przed startem")
    edytuj_dokument(d["id"], {"termin": "2026-10-20", "numer": "FV 1A/10"}, "biuro")
    # Data musi zostać sprzed startu.
    with pytest.raises(HTTPException):
        edytuj_dokument(d["id"], {"data": "2026-11-10"}, "biuro")
    edytuj_dokument(d["id"], {"data": "2026-10-02"}, "biuro")
    # Kilogramy zaległych nie mają sensu (nigdy nie wchodzą do kg).
    with pytest.raises(HTTPException):
        edytuj_dokument(d["id"], {"kg": 10}, "biuro")
    assert karta("k1")["saldo"]["fv"] == -300.0

    usun_dokument(d["id"], "wpisany przez pomyłkę", "biuro")

    k = karta("k1")
    assert k["saldo"]["fv"] == 0.0 and k["dokumenty"]["fv"] == []
    assert rozliczenia_otwarte("k1") is False
    akcje = [r["akcja"] for r in query_all(
        "SELECT akcja FROM rozl_historia WHERE obiekt_id=%s ORDER BY kiedy, id", (d["id"],))]
    assert akcje[0] == "dodano" and akcje[-1] == "usunieto" and "kwota" in akcje
    # Po usunięciu numer znów wolny.
    _zalegle("k1", _wiersz("FV 1A/10", date(2026, 10, 1), 10))


def test_trasa_zaleglych_dokumentow(db):
    _klient("k1")

    wynik = route.dodaj_zalegle("k1", {"dokumenty": [
        {"ksiega": "fv", "numer": "FV 1/10", "data": "2026-10-01", "kwota": "1 250,50",
         "termin": "", "uwagi": "z Excela"},
        {"ksiega": "wz", "numer": "WZ 3/10", "data": "2026-10-03", "kwota": 99,
         "termin": "2026-10-10"},
    ]}, KTO)

    assert [d["numer"] for d in wynik["dokumenty"]] == ["FV 1/10", "WZ 3/10"]
    assert wynik["dokumenty"][0]["kwota"] == 1250.5
    assert wynik["dokumenty"][0]["zrodlo"] == "otwarcie"
    assert wynik["dokumenty"][0]["ksiega"] == "fv"
    assert wynik["dokumenty"][1]["termin"] == "2026-10-10"
    assert query_one("SELECT utworzyl FROM rozl_dokumenty WHERE numer='FV 1/10'")[
        "utworzyl"] == "ala"
    with pytest.raises(HTTPException) as e:
        route.dodaj_zalegle("k1", {"dokumenty": "x"}, KTO)
    assert e.value.status_code == 400


def test_kurs_papiery_widza_klienta_z_zaleglymi_jako_otwartego(db):
    from app.services.loading_service import zaladunek
    kurs = _kurs_do_wystawienia()
    assert zaladunek(kurs)["pozycje"][0]["rozliczenia_otwarte"] is False

    dodaj_zalegle("c1", [_wiersz("FV 1/10", date(2026, 10, 1), 10)], "biuro")

    assert zaladunek(kurs)["pozycje"][0]["rozliczenia_otwarte"] is True


# ── Fix round 1: kurs wystawiany po kawałku ────────────────────────────

def test_kurs_wystawiany_w_dwoch_wywolaniach_ten_sam_numer_sumuje_kg(db):
    """Biuro wystawia tylko zamówienia „do wystawienia” — drugie wywołanie
    z tym samym numerem dolicza kg, a nie nadpisuje."""
    kurs = _kurs_dwoch_odbiorcow()

    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 300.0, "invoice_no": "FV 7/11/2026"}])
    _wystaw(kurs, [{"order_id": "o2", "cel_kg": 120.0, "invoice_no": "FV 7/11/2026"}])

    [fv] = _fv_kursu()
    assert float(fv["kg"]) == 420.0
    assert fv["kurs_zamowienia"] == {f"{kurs}/o1": 300.0, f"{kurs}/o2": 120.0}

    # Ponowne wystawienie jednego z nich nic nie psuje.
    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 300.0, "invoice_no": "FV 7/11/2026"}])
    [fv] = _fv_kursu()
    assert float(fv["kg"]) == 420.0


def test_kurs_wystawiany_w_dwoch_wywolaniach_rozne_numery_to_dwie_fv(db):
    kurs = _kurs_dwoch_odbiorcow()
    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 300.0, "invoice_no": "FV A"}])
    [a] = _fv_kursu()
    edytuj_dokument(a["id"], {"kwota": 900}, "biuro")

    _wystaw(kurs, [{"order_id": "o2", "cel_kg": 120.0, "invoice_no": "FV B"}])

    fv = {r["numer"]: r for r in _fv_kursu()}
    assert set(fv) == {"FV A", "FV B"}
    assert fv["FV A"]["id"] == a["id"]
    assert float(fv["FV A"]["kwota"]) == 900.0 and float(fv["FV A"]["kg"]) == 300.0
    assert fv["FV B"]["kwota"] is None and float(fv["FV B"]["kg"]) == 120.0

    # Prawdziwa poprawka numeru (wszystkie zamówienia FV A pod nowym numerem)
    # zmienia numer i zostawia wpisaną kwotę.
    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 300.0, "invoice_no": "FV C"}])
    fv = {r["numer"]: r for r in _fv_kursu()}
    assert set(fv) == {"FV C", "FV B"}
    assert fv["FV C"]["id"] == a["id"] and float(fv["FV C"]["kwota"]) == 900.0


def test_zamowienie_przeniesione_pod_inny_numer_odchodzi_ze_starej_fv(db):
    kurs = _kurs_dwoch_odbiorcow()
    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 300.0, "invoice_no": "FV A"},
                   {"order_id": "o2", "cel_kg": 120.0, "invoice_no": "FV A"}])

    _wystaw(kurs, [{"order_id": "o2", "cel_kg": 120.0, "invoice_no": "FV B"}])

    fv = {r["numer"]: r for r in _fv_kursu()}
    assert float(fv["FV A"]["kg"]) == 300.0 and float(fv["FV B"]["kg"]) == 120.0


def test_ponowne_wystawienie_bez_numeru_zostawia_fv_i_ostrzega(db, caplog):
    kurs = _kurs_do_wystawienia()
    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 180.0, "invoice_no": "FV 10/11/2026"}])

    _wystaw(kurs, [{"order_id": "o1", "cel_kg": 180.0, "invoice_no": ""}])

    [fv] = _fv_kursu()
    assert float(fv["kg"]) == 180.0
    assert any("bez_faktury_przy_ponownym" in r.getMessage() and r.levelname == "WARNING"
               for r in caplog.records)
