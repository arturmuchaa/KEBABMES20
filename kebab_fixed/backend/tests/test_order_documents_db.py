"""Wszystkie dokumenty zamówienia w jednym miejscu (właściciel 13.11.2026):
„jak wejdę w zamówienie zrealizowane, w sekcji dokumenty wszystkie dokumenty
wystawione do tego zamówienia — tam jest tylko WM/WZ, a chciałbym wszystkie".

Wymaga TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
import pytest
from fastapi import HTTPException

from app.db import execute
from app.services import orders_service
from tests.test_finalize_loading_db import _klient, _receptura, _zamowienie


def _dokumenty():
    execute("INSERT INTO wz_documents (id, number, seq, year_month, source_type, source_id, status, doc_series, issued_date, created_at) VALUES "
            "('w1','WM/1/11/26',1,'2611','order','o1','wstepny','WM','2026-11-12','2026-11-12 10:00+00'),"
            "('w2','WZ/7/11/26',2,'2611','order','o1','wstepny','WZ','2026-11-12','2026-11-12 10:01+00'),"
            "('w3','WZ/8/11/26',3,'2611','order','o1','anulowany','WZ','2026-11-12','2026-11-12 10:02+00'),"
            "('w9','WZ/9/11/26',4,'2611','order','inne','wstepny','WZ','2026-11-12','2026-11-12 10:03+00')")
    execute("INSERT INTO hdi_documents (id, number, seq, year_month, order_id, status, scope, issue_date, created_at) VALUES "
            "('h1','HDI/1/11/26',1,'2611','o1','wstepny','calosc','2026-11-12','2026-11-12 10:04+00'),"
            "('h2','HDI/2/11/26',2,'2611','o1','wstepny','fv','2026-11-12','2026-11-12 10:05+00')")
    execute("INSERT INTO cmr_documents (id, number, seq, order_id, status, scope, issue_date, created_at) VALUES "
            "('c1','CMR/1/11/26',1,'o1','wystawiony','fv','2026-11-12','2026-11-12 10:06+00')")


def test_dokumenty_zamowienia_wm_wz_hdi_cmr_bez_anulowanych_i_obcych(db):
    _klient(); _receptura(); _zamowienie()
    _dokumenty()
    d = orders_service.order_documents('o1')
    assert (d['order_id'], d['order_no'], d['client_id']) == ('o1', 'YALCIN/Z/4/09/26', 'c1')
    assert [(w['number'], w['doc_series']) for w in d['wz']] == [('WM/1/11/26', 'WM'), ('WZ/7/11/26', 'WZ')]
    assert [(h['number'], h['scope']) for h in d['hdi']] == [('HDI/1/11/26', 'calosc'), ('HDI/2/11/26', 'fv')]
    assert [(c['number'], c['scope'], c['date']) for c in d['cmr']] == [('CMR/1/11/26', 'fv', '2026-11-12')]
    assert d['wz'][0]['date'] == '2026-11-12'
    assert d['rozliczenia_otwarte'] is False


def test_dokumenty_nieistniejacego_zamowienia_404(db):
    with pytest.raises(HTTPException) as e:
        orders_service.order_documents('brak')
    assert e.value.status_code == 404
