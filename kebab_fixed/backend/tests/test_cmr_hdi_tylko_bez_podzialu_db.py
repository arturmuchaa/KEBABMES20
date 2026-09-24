"""Numer HDI na CMR tylko wtedy, gdy zamówienie NIE jest dzielone.

Decyzja właściciela 24.09.2026: „HDI wstawiaj tylko jeżeli nie ma WZ
i wszystko jedzie na całość; jeżeli dzielimy — pole puste".

Skąd temat: CMR-y wychodzą parami (jeden „na drogę", drugi pod fakturę),
a HDI wystawiane jest tylko na całość. Jeden z pary dostawał numer, drugi
nigdy — i na papierze wyglądało to jak pomyłka.

Kryterium „dzielimy" to ISTNIENIE WZ DLA KLIENTA (`split_scope='wz_klienta'`),
bo dokładnie to znaczy „część poszła osobnym dokumentem, nie całość".
"""
from __future__ import annotations

import json
from datetime import date

from app.db import execute
from app.services.cmr_service import build_cmr


def _forma():
    """CMR bez towaru jest odrzucany — podajemy pozycję ręczną, bo ten test
    dotyczy wyłącznie numeru HDI w załącznikach."""
    return {"goods_manual": [{"name": "KEBAB UDO", "qty": 10, "kg": 400}]}


def _zamowienie(oid="o1", numer="YALCIN/Z/1/09/26"):
    execute("INSERT INTO clients (id, code, name) VALUES ('c1','YAL','YALCIN') "
            "ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name, "
            " order_date, status) VALUES (%s,%s,'c1','YALCIN',%s,'confirmed')",
            (oid, numer, date.today()))
    return oid


def _hdi(oid="o1", numer="44/09/26"):
    execute("INSERT INTO hdi_documents (id, order_id, number, seq, year_month, scope) "
            "VALUES ('h1',%s,%s,44,'2609','calosc')", (oid, numer))


def _wz_klienta(oid="o1"):
    """Dokument, którego istnienie ZNACZY „dzielimy"."""
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, buyer_name, lines, "
        " total_value, valued, status, doc_series, split_scope, source_type, source_id, "
        " issued_date) VALUES ('wz1','WZ/1/09/26',1,'2609','YALCIN',%s::jsonb,0,FALSE,"
        " 'wstepny','WZ','wz_klienta','order',%s,'24.09.2026')",
        (json.dumps([{"name": "KEBAB", "qty": 1, "unit": "szt"}]), oid))


def test_bez_podzialu_CMR_niesie_numer_HDI(db):
    """Całość jedzie jednym papierem — CMR powołuje się na HDI."""
    _zamowienie()
    _hdi()

    cmr = build_cmr("o1", _forma(), scope="calosc")

    assert cmr["payload"]["attachments"]["hdi_number"] == "44/09/26"


def test_przy_PODZIALE_pole_HDI_zostaje_puste(db):
    """Decyzja właściciela: gdy dzielimy na fakturę i WZ, numeru HDI na CMR
    nie ma — ani na jednym, ani na drugim papierze."""
    _zamowienie()
    _hdi()
    _wz_klienta()

    cmr = build_cmr("o1", _forma(), scope="calosc")

    assert cmr["payload"]["attachments"]["hdi_number"] == ""


def test_anulowany_WZ_klienta_NIE_liczy_sie_jako_podzial(db):
    """Anulowany dokument nic już nie wydaje — zamówienie znów jest „na
    całość", więc HDI wraca na CMR. Inaczej jedna pomyłka biura kasowałaby
    numer na papierze na zawsze."""
    _zamowienie()
    _hdi()
    _wz_klienta()
    execute("UPDATE wz_documents SET status='anulowany' WHERE id='wz1'")

    cmr = build_cmr("o1", _forma(), scope="calosc")

    assert cmr["payload"]["attachments"]["hdi_number"] == "44/09/26"


def test_brak_HDI_zostawia_pole_puste(db):
    """Zachowanie wsteczne: nie ma dokumentu, nie ma numeru."""
    _zamowienie()

    cmr = build_cmr("o1", _forma(), scope="calosc")

    assert cmr["payload"]["attachments"]["hdi_number"] == ""
