"""Rozrachunki — składanie karty kontrahenta z danych MES.

Obciążenia mają DWA źródła: WZ zaciągane wprost z MES i faktury wpisywane
przez biuro. WM nigdy nie obciąża — to ruch magazynowy, a nie należność;
gdyby obciążał, ten sam towar liczyłby się dwa razy.

Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

from datetime import date

from app.db import execute
from app.services.rozrachunki_service import karta_klienta, zestawienie


def _klient(cid="c1", waluta="PLN", enabled=True, nazwa="YALCIN"):
    execute("INSERT INTO clients (id, code, name, settlement_enabled, "
            " settlement_currency) VALUES (%s,%s,%s,%s,%s)",
            (cid, cid.upper(), nazwa, enabled, waluta))
    return cid


def _otwarcie(cid="c1", kwota=-1000.0, na="2026-09-01", waluta="PLN"):
    execute("INSERT INTO client_opening_balances (client_id, amount, currency, as_of_date) "
            "VALUES (%s,%s,%s,%s)", (cid, kwota, waluta, na))


def _wz(wid, cid, numer, data, wartosc, seria="WZ", status="wstepny"):
    """`wz_documents` NIE MA kolumny `client_id` — powiązanie idzie przez
    ZAMÓWIENIE albo przez nazwę nabywcy. Tu przez zamówienie, bo to
    pewniejsza droga i tak powstaje większość dokumentów."""
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name) "
            "VALUES (%s,%s,%s,'YALCIN') ON CONFLICT (id) DO NOTHING",
            (f"ord-{wid}", f"ZAM/{wid}", cid))
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, buyer_name, lines, "
        " total_value, valued, status, doc_series, currency, source_type, source_id, "
        " issued_date) "
        "VALUES (%s,%s,1,'2609','YALCIN','[]'::jsonb,%s,true,%s,%s,'PLN','order',%s,%s)",
        (wid, numer, wartosc, status, seria, f"ord-{wid}", data))


def test_WZ_po_odcieciu_obciaza_klienta(db):
    _klient(); _otwarcie()
    _wz("w1", "c1", "WZ/9/09/26", "2026-09-15", 3000.0)

    karta = karta_klienta("c1")

    assert [(o["number"], o["amount"]) for o in karta["obciazenia"]] == \
        [("WZ/9/09/26", -3000.0)]


def test_WZ_SPRZED_odciecia_NIE_obciaza(db):
    """REGUŁA NADRZĘDNA — inaczej historia doliczyłaby się na wierzchu."""
    _klient(); _otwarcie(na="2026-09-10")
    _wz("w1", "c1", "WZ/1/09/26", "2026-09-05", 3000.0)

    assert karta_klienta("c1")["obciazenia"] == []


def test_WM_NIGDY_nie_obciaza(db):
    """WM to ruch magazynowy. Gdyby obciążał, ten sam towar policzyłby się
    dwa razy: raz jako WM, raz jako faktura."""
    _klient(); _otwarcie()
    _wz("w1", "c1", "WM/3/09/26", "2026-09-15", 3000.0, seria="WM")

    assert karta_klienta("c1")["obciazenia"] == []


def test_ANULOWANY_WZ_nie_obciaza(db):
    _klient(); _otwarcie()
    _wz("w1", "c1", "WZ/9/09/26", "2026-09-15", 3000.0, status="anulowany")

    assert karta_klienta("c1")["obciazenia"] == []


def test_faktura_i_wplata_wchodza_do_salda(db):
    _klient(); _otwarcie(kwota=-1000.0)
    execute("INSERT INTO client_charges (id, client_id, kind, number, doc_date, amount, "
            " currency) VALUES ('ch1','c1','invoice','FS 12/09/2026','2026-09-15',"
            " -2000,'PLN')")
    execute("INSERT INTO client_payments (id, client_id, paid_date, amount, currency) "
            "VALUES ('p1','c1','2026-09-20',-500,'PLN')")

    assert karta_klienta("c1")["saldo"]["saldo"] == -2500.0


def test_karta_niesie_TERMIN_i_dni_po_terminie(db):
    _klient(); _otwarcie()
    _wz("w1", "c1", "WZ/9/09/26", "2026-09-15", 3000.0)

    poz = karta_klienta("c1", na_dzien=date(2026, 9, 20))["obciazenia"][0]

    assert poz["termin"] == date(2026, 9, 16)      # WZ = +1 dzień
    assert poz["dni_po_terminie"] == 4


def test_dokument_trafia_do_WLASCIWEJ_spolki_mimo_wspolnej_nazwy(db):
    """PUŁAPKA: w kartotece są DWIE karty o nazwie handlowej YALCIN
    (YBM Gastro i Emin Handels, rozbite 27.08.2026). Dopasowanie po samej
    nazwie dopisałoby dług obcej firmie."""
    _klient("c1"); _otwarcie("c1")
    _klient("c2"); _otwarcie("c2")
    _wz("w1", "c2", "WZ/9/09/26", "2026-09-15", 3000.0)

    assert karta_klienta("c1")["obciazenia"] == []
    assert [o["number"] for o in karta_klienta("c2")["obciazenia"]] == ["WZ/9/09/26"]


def test_klient_bez_salda_otwarcia_jest_oznaczony(db):
    """Review Focus 2."""
    _klient()

    assert karta_klienta("c1")["saldo"]["skonfigurowane"] is False


def test_zestawienie_pomija_klientow_z_WYLACZONYM_rozliczeniem(db):
    _klient("c1", enabled=True); _otwarcie("c1")
    _klient("c2", enabled=False, nazwa="INNY")

    assert [z["clientId"] for z in zestawienie()] == ["c1"]


# ─── Co obciąża saldo: ustawienie per klient (24.09.2026) ───────────────
#
# Właściciel o TRUVIE: „tam saldo nie liczymy osobno na WZ i FV, tylko
# ogólnie". Łączne saldo było od początku — podział na WZ i faktury to
# sposób pokazania listy, nie dwa osobne salda.
#
# Otwarte zostało co innego: czy faktura opisuje TĘ SAMĄ dostawę co WZ.
# Dane pokazują trzy wzorce (TRUVA 49/11, YBM 14/63, NAZAR 1/31), więc to
# jest ustawienie kontrahenta, a nie reguła globalna.

def _podstawa(cid, basis):
    execute("UPDATE clients SET settlement_basis=%s WHERE id=%s", (basis, cid))


def test_domyslnie_obciazaja_OBA_zrodla(db):
    """Odtwarza arkusz biura: `SALDO ŁĄCZNIE` sumuje obie kolumny."""
    _klient(); _otwarcie(kwota=0.0)
    _wz("w1", "c1", "WZ/9/09/26", "2026-09-15", 1000.0)
    execute("INSERT INTO client_charges (id, client_id, kind, number, doc_date, amount, "
            " currency) VALUES ('ch1','c1','invoice','FS 1/2026','2026-09-16',-2000,'PLN')")

    assert karta_klienta("c1")["saldo"]["saldo"] == -3000.0


def test_podstawa_WZ_pomija_faktury(db):
    """Dla odbiorcy, u którego faktura opisuje tę samą dostawę co wydanie —
    liczenie obu podwoiłoby dług."""
    _klient(); _otwarcie(kwota=0.0); _podstawa("c1", "wz")
    _wz("w1", "c1", "WZ/9/09/26", "2026-09-15", 1000.0)
    execute("INSERT INTO client_charges (id, client_id, kind, number, doc_date, amount, "
            " currency) VALUES ('ch1','c1','invoice','FS 1/2026','2026-09-16',-2000,'PLN')")

    karta = karta_klienta("c1")

    assert karta["saldo"]["saldo"] == -1000.0
    assert [o["kind"] for o in karta["obciazenia"]] == ["wz"]


def test_podstawa_FAKTURA_pomija_WZ(db):
    _klient(); _otwarcie(kwota=0.0); _podstawa("c1", "invoice")
    _wz("w1", "c1", "WZ/9/09/26", "2026-09-15", 1000.0)
    execute("INSERT INTO client_charges (id, client_id, kind, number, doc_date, amount, "
            " currency) VALUES ('ch1','c1','invoice','FS 1/2026','2026-09-16',-2000,'PLN')")

    karta = karta_klienta("c1")

    assert karta["saldo"]["saldo"] == -2000.0
    assert [o["kind"] for o in karta["obciazenia"]] == ["invoice"]


def test_nieznana_podstawa_liczy_OBA(db):
    """Literówka w ustawieniu nie może po cichu wyzerować czyjegoś długu —
    w razie wątpliwości pokazujemy wszystko."""
    _klient(); _otwarcie(kwota=0.0); _podstawa("c1", "cos-dziwnego")
    _wz("w1", "c1", "WZ/9/09/26", "2026-09-15", 1000.0)

    assert karta_klienta("c1")["saldo"]["saldo"] == -1000.0


# ─── C4/I5 z recenzji 24.09.2026 ────────────────────────────────────────

def test_WZ_w_INNEJ_WALUCIE_nie_wpada_do_salda(db):
    """C4. `wz_documents.currency` jest zmienialne (biuro wycenia WZ w euro),
    a `policz_saldo` sumuje same kwoty — nie czyta waluty. Klient rozliczany
    w złotówkach dostawał dług „−10 000 zł" zamiast ~−42 700 zł. Liczba
    wyglądała sensownie i nic nie ostrzegało."""
    _klient(waluta="PLN"); _otwarcie(kwota=0.0)
    _wz("w1", "c1", "WZ/9/09/26", "2026-09-15", 10000.0)
    execute("UPDATE wz_documents SET currency='EUR' WHERE id='w1'")

    karta = karta_klienta("c1")

    assert karta["saldo"]["saldo"] == 0.0
    assert karta["obciazenia"] == []


def test_dokument_w_innej_walucie_jest_ZGLOSZONY_a_nie_przemilczany(db):
    """Ciche pominięcie byłoby drugim błędem: należność znikałaby bez śladu.
    Karta ma powiedzieć, ile dokumentów odpadło i dlaczego."""
    _klient(waluta="PLN"); _otwarcie(kwota=0.0)
    _wz("w1", "c1", "WZ/9/09/26", "2026-09-15", 10000.0)
    execute("UPDATE wz_documents SET currency='EUR' WHERE id='w1'")

    ostrz = karta_klienta("c1")["ostrzezenia"]

    assert ostrz["inna_waluta"] == 1


def test_zgodna_waluta_wchodzi_normalnie(db):
    _klient(waluta="EUR"); _otwarcie(kwota=0.0, waluta="EUR")
    _wz("w1", "c1", "WZ/9/09/26", "2026-09-15", 10000.0)
    execute("UPDATE wz_documents SET currency='EUR' WHERE id='w1'")

    assert karta_klienta("c1")["saldo"]["saldo"] == -10000.0
