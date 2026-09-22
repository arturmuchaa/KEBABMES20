"""Pasek „nie wydawać klientowi" na WM — tylko gdy jest co ukrywać.

Właściciel 22.09.2026: „WM nie pisz na czerwono, że nie dla klienta — czasem
chciałbym dać klientowi papier, bo fakturę wystawiamy dopiero za kilka dni".

Pasek istniał z JEDNEGO powodu: WM niesie CAŁĄ przesyłkę, więc przy wysyłce
z podziałem ujawniłby ilości spoza faktury. Gdy całość idzie na fakturę, nie
ukrywa niczego — i wtedy ma zniknąć.

Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

import json

from app.db import execute
from app.services.wz_service import get_wz


def _dok(wid, numer, seria, scope=None, status="wstepny", oid="o1"):
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, buyer_name, lines, "
        " total_value, valued, status, doc_series, source_type, source_id, split_scope) "
        "VALUES (%s,%s,1,'2609','FUDI',%s::jsonb,0,FALSE,%s,%s,'order',%s,%s)",
        (wid, numer, json.dumps([]), status, seria, oid, scope))
    return wid


def test_calosc_na_fakture_BEZ_paska(db):
    """Nie ma WZ dla klienta = nie ma części poza fakturą = nie ma czego
    ukrywać. Dokładnie przypadek FUDI z 22.09 (150 zamówione, 150 na fakturę)."""
    _dok("wm1", "WM/9/09/26", "WM", scope="calosc")

    assert get_wz("wm1")["ukrywa_czesc_poza_faktura"] is False


def test_wysylka_z_podzialem_Z_paskiem(db):
    """Istnieje WZ dla klienta, czyli część poszła poza fakturę — pasek
    zostaje, bo inaczej klient zobaczyłby ilości, których nie kupił."""
    _dok("wm1", "WM/9/09/26", "WM", scope="calosc")
    _dok("wz1", "WZ/40/09/26", "WZ", scope="wz_klienta")

    assert get_wz("wm1")["ukrywa_czesc_poza_faktura"] is True


def test_anulowany_WZ_klienta_nie_liczy_sie(db):
    """Skoro dokumentu nie ma, nie ma też części, którą miałby opisywać."""
    _dok("wm1", "WM/9/09/26", "WM", scope="calosc")
    _dok("wz1", "WZ/40/09/26", "WZ", scope="wz_klienta", status="anulowany")

    assert get_wz("wm1")["ukrywa_czesc_poza_faktura"] is False


def test_zwykly_WZ_nigdy_nie_niesie_paska(db):
    """Pasek dotyczy wyłącznie serii WM — WZ jest papierem kontrahenta."""
    _dok("wz1", "WZ/40/09/26", "WZ")

    assert get_wz("wz1")["ukrywa_czesc_poza_faktura"] is False
