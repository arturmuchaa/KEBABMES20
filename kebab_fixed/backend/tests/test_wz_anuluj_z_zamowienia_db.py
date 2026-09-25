"""Anulowanie WZ wystawionego z zamówienia (bez podziału).

25.09.2026: biuro wystawiło dla SAS ISSA najpierw WZ/91/09/26, a potem nie
mogło wystawić HDI. Przycisk „Anuluj" działał tylko dla ręcznych WZ,
a „anuluj komplet" tylko dla dokumentów podziału. WZ z zamówienia bez
podziału nie dało się cofnąć inaczej niż ręcznie w bazie. Tak było już
drugi raz (ANUL WZ/68/08/26).

Anulujemy takie WZ tylko wtedy, gdy da się to zrobić uczciwie:
* dokument NIE jest załadowany (po załadunku towar jest na naczepie,
  zwrot opisywałby magazyn, którego nie ma),
* KAŻDA pozycja wyrobu ma `stock_id` (bez niego status zmieniłby się
  na „anulowany" BEZ zwrotu towaru),
* nie ma do niego HDI (papier klienta zostałby bez dokumentu źródłowego).

Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

import json

import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.services.wz_service import cancel_wz


def _wyrob(gid="f1", na_stanie=5, wydane=10, kg=15):
    """Stan PO wystawieniu WZ: 10 szt. już zeszło (qty_shipped), 5 leży."""
    execute(
        "INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, product_type_id, "
        " product_type_name, qty, kg_per_unit, total_kg, qty_available, qty_shipped, "
        " produced_date) VALUES (%s,'250926 600','r1','BEYAZ','pt1','KEBAB UDO',%s,%s,%s,%s,%s,"
        " '2026-09-24')",
        (gid, na_stanie + wydane, kg, (na_stanie + wydane) * kg, na_stanie, wydane))
    return gid


def _linia(gid="f1", qty=10, kg=15, stock_id=True):
    l = {"stock_type": "fg", "qty": qty, "unit": "szt", "kg_per_unit": kg,
         "name": "KEBAB UDO BEYAZ HALAL 15kg"}
    if stock_id:
        l["stock_id"] = gid
    return l


def _wz(wid="w1", linie=None, nr=91, split_scope=None, loaded=False):
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, source_type, source_id, "
        " buyer_name, valued, lines, status, currency, pallets_h1, pallets_other, "
        " issued_date, created_at, split_scope, loaded_at) "
        "VALUES (%s,%s,%s,'2609','order','o1','SAS ISSA DISTRIB',false,%s::jsonb,'wstepny',"
        " 'EUR',0,0,'2026-09-25',now(),%s," + ("now()" if loaded else "NULL") + ")",
        (wid, f"WZ/{nr}/09/26", nr, json.dumps(linie or []), split_scope))
    return wid


def _stan(gid="f1"):
    return query_one("SELECT qty_available, qty_shipped FROM finished_goods WHERE id=%s", (gid,))


def _status(wid="w1"):
    return query_one("SELECT status, number FROM wz_documents WHERE id=%s", (wid,))


def test_wz_z_zamowienia_wraca_na_magazyn(db):
    _wyrob()
    _wz(linie=[_linia()])

    cancel_wz("w1")

    s = _stan()
    assert int(s["qty_available"]) == 15, "10 szt. wraca na stan"
    assert int(s["qty_shipped"]) == 0
    assert _status()["status"] == "anulowany"


def test_zwrot_zostawia_ruch_CANCEL_w_ksiedze(db):
    _wyrob()
    _wz(linie=[_linia()])

    cancel_wz("w1")

    ruchy = query_all("SELECT movement_type, qty FROM stock_movements WHERE source_id='w1'")
    assert [(r["movement_type"], float(r["qty"])) for r in ruchy] == [("CANCEL", 150.0)]


def test_numer_wraca_do_puli(db):
    _wyrob()
    _wz(linie=[_linia()])

    cancel_wz("w1")

    assert _status()["number"] == "ANUL WZ/91/09/26"
    assert query_one("SELECT 1 AS x FROM numery_zwolnione WHERE seq=91")


def test_po_zaladunku_NIE_wolno(db):
    _wyrob()
    _wz(linie=[_linia()], loaded=True)

    with pytest.raises(HTTPException) as e:
        cancel_wz("w1")

    assert e.value.status_code == 409
    assert "załad" in e.value.detail
    assert _status()["status"] == "wstepny"
    assert int(_stan()["qty_available"]) == 5, "stan nietknięty"


def test_pozycja_bez_sladu_magazynowego_blokuje(db):
    """Bez `stock_id` zwrot by się nie odbył, a status i tak by się zmienił."""
    _wyrob()
    _wz(linie=[_linia(stock_id=False)])

    with pytest.raises(HTTPException) as e:
        cancel_wz("w1")

    assert e.value.status_code == 409
    assert _status()["status"] == "wstepny"


def test_z_HDI_NIE_wolno(db):
    _wyrob()
    _wz(linie=[_linia()])
    execute("INSERT INTO hdi_documents (id, number, seq, year_month, order_id, wz_id) "
            "VALUES ('h1','HDI/1/09/26',1,'2609','o1','w1')")

    with pytest.raises(HTTPException) as e:
        cancel_wz("w1")

    assert e.value.status_code == 409
    assert "HDI" in e.value.detail
    assert _status()["status"] == "wstepny"


def test_dokument_podzialu_odsyla_do_kompletu(db):
    """Dokumenty podziału anuluje się razem („anuluj komplet"), nie pojedynczo."""
    _wyrob()
    _wz(linie=[_linia()], split_scope="calosc")

    with pytest.raises(HTTPException) as e:
        cancel_wz("w1")

    assert e.value.status_code == 409
    assert "komplet" in e.value.detail.lower()
    assert _status()["status"] == "wstepny"


# ── 25.09.2026, ciąg dalszy ISSY: po cofnięciu WZ zamówienie zostało
# w „Zrealizowanych" (status `done` stawia `close_shipped_orders` po wydaniu),
# a `generate_hdi` dla zamkniętego zamówienia oddaje dokument zamrożony —
# HDI dalej się nie dało wystawić. Anulowanie kompletu podziału robi już
# to samo przywrócenie (`split_documents_service`).

def _zamowienie(status="done"):
    execute("INSERT INTO client_orders (id, order_no, client_name, order_date, status) "
            "VALUES ('o1','ISSA-DISTRIB/Z/4/09/26','ISSA DISTRIB','2026-09-22',%s)", (status,))


def _status_zamowienia():
    return query_one("SELECT status FROM client_orders WHERE id='o1'")["status"]


def test_anulowanie_otwiera_zamowienie_z_powrotem(db):
    _zamowienie("done")
    _wyrob()
    _wz(linie=[_linia()])

    cancel_wz("w1")

    assert _status_zamowienia() == "confirmed"


def test_inny_aktywny_dokument_trzyma_zamowienie_zamkniete(db):
    """Zamówienie wydane DWOMA dokumentami — anulowanie jednego nie otwiera."""
    _zamowienie("done")
    _wyrob()
    _wz(linie=[_linia(qty=5)])
    _wz(wid="w2", linie=[_linia(qty=5)], nr=92)

    cancel_wz("w1")

    assert _status_zamowienia() == "done"


def test_anulowane_zamowienie_zostaje_anulowane(db):
    _zamowienie("cancelled")
    _wyrob()
    _wz(linie=[_linia()])

    cancel_wz("w1")

    assert _status_zamowienia() == "cancelled"
