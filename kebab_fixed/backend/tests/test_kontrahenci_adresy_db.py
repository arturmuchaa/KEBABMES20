"""„Popraw adresy” — propozycje poprawy zapisanych adresów (27.11.2026).

Tylko z pól kartoteki (bez rejestrów): wielkie litery, spacje brzegowe, kod
w formacie kraju. Zmiany idą dopiero po zatwierdzeniu przez biuro.
Testy DB — bez TEST_DATABASE_URL skip.
"""
from app.db import execute, query_one
from app.services import kontrahenci_adresy_service as svc


def _klient(cid, nip, address, postal, city, country=""):
    execute("INSERT INTO clients (id, code, name, nip, address, postal_code, city, country) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)", (cid, cid, f"K {cid}", nip, address, postal, city, country))


def _dostawca(sid, nip, address, postal, city, country="PL"):
    execute("INSERT INTO suppliers (id, code, name, nip, address, postal_code, city, country) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)", (sid, sid, f"D {sid}", nip, address, postal, city, country))


def test_propozycje_sk_i_pl(db):
    _klient("sk", "SK1020304050", "Hlavná 1200/4", "04022 ", " Košice", "SK")
    _klient("pl", "2223334445", "JANA KILIŃSKIEGO 17", "40-001", "KATOWICE", "PL")
    p = {x["id"]: x for x in svc.propozycje()}
    assert p["sk"]["rodzaj"] == "odbiorca"
    assert p["sk"]["proponowane"]["postal_code"] == "040 22"
    assert p["sk"]["proponowane"]["city"] == "Košice"
    assert p["sk"]["proponowane"]["address"] == "Hlavná 1200/4"
    assert p["pl"]["proponowane"]["address"] == "Jana Kilińskiego 17"
    assert p["pl"]["proponowane"]["city"] == "Katowice"
    assert p["pl"]["obecne"]["city"] == "KATOWICE"


def test_poprawny_adres_nie_trafia_na_liste(db):
    _klient("de", "DE111222333", "Hauptstr. 21", "50667", "Köln", "DE")
    _dostawca("koko", "3334445556", "Rynek 2A", "32-065", "Krzeszowice")
    assert svc.propozycje() == []


def test_dostawcy_tez(db):
    _dostawca("w", "6667778889", "SZKOLNA 3", "", "")
    p = svc.propozycje()
    assert p[0]["rodzaj"] == "dostawca" and p[0]["proponowane"]["address"] == "Szkolna 3"


def test_nieaktywni_pominieci(db):
    _klient("x", "", "DŁUGA 1", "", "", "PL")
    execute("UPDATE clients SET active=false WHERE id='x'")
    assert svc.propozycje() == []


def test_zastosuj_zmienia_tylko_wskazane(db):
    _klient("a", "", "DŁUGA 1", "31147", "KRAKÓW", "PL")
    _klient("b", "", "KRÓTKA 2", "", "NYSA", "PL")
    out = svc.zastosuj([{"rodzaj": "odbiorca", "id": "a", "address": "Długa 1", "postal_code": "31-147",
                         "city": "Kraków", "country": "PL"}])
    assert out == {"zmieniono": 1}
    a = query_one("SELECT address, postal_code, city FROM clients WHERE id='a'")
    assert (a["address"], a["postal_code"], a["city"]) == ("Długa 1", "31-147", "Kraków")
    assert query_one("SELECT city FROM clients WHERE id='b'")["city"] == "NYSA"


def test_zastosuj_dostawcy(db):
    _dostawca("w", "", "SZKOLNA 3", "", "")
    svc.zastosuj([{"rodzaj": "dostawca", "id": "w", "address": "Szkolna 3", "postal_code": "", "city": "", "country": "PL"}])
    assert query_one("SELECT address FROM suppliers WHERE id='w'")["address"] == "Szkolna 3"
