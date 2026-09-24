"""Lista Wydań musi nieść SERIĘ dokumentu — na niej stoi podział na zakładki.

Zgłoszenie właściciela 24.09.2026: „w WZ mam dokumenty WM, a powinny być
w WM, a tam jest zero dokumentów — chodzi o filtrowanie".

Przyczyna: `list_wz()` nie zwracało `doc_series`. Ekran dzieli dokumenty
regułą `(doc_series || 'WZ') === 'WM' ? magazynowe : zewnętrzne`, więc brak
pola oznaczał „wszystko jest WZ": zakładka Magazynowe pusta, a WM-y w cudzej.

Testy frontu tego nie złapały, bo podawały `doc_series` wprost w danych
testowych — pilnowały reguły podziału, nie KONTRAKTU listy. Stąd ten test
po stronie backendu: sprawdza, że pole w ogóle wychodzi z bazy.
"""
from __future__ import annotations

import json

from app.db import execute
from app.services.wz_service import list_wz


def _dokument(wid, numer, seria, zakres=None, seq=1):
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, buyer_name, lines, "
        " total_value, valued, status, doc_series, split_scope, issued_date) "
        "VALUES (%s,%s,%s,'2609','YALCIN',%s::jsonb,0,FALSE,'wstepny',%s,%s,'24.09.2026')",
        (wid, numer, seq, json.dumps([{"name": "KEBAB", "qty": 1, "unit": "szt"}]),
         seria, zakres))


def test_lista_niesie_serie_dokumentu(db):
    """Bez tego pola ekran nie odróżni WM od WZ."""
    _dokument("w1", "WM/1/09/26", "WM", "calosc", seq=1)

    doc = next(d for d in list_wz() if d["id"] == "w1")

    assert doc["doc_series"] == "WM"


def test_lista_odroznia_WM_od_WZ(db):
    _dokument("w1", "WM/1/09/26", "WM", "calosc", seq=1)
    _dokument("w2", "WZ/1/09/26", "WZ", "wz_klienta", seq=2)

    wg_id = {d["id"]: d for d in list_wz()}

    assert wg_id["w1"]["doc_series"] == "WM"
    assert wg_id["w2"]["doc_series"] == "WZ"


def test_dokument_bez_serii_wychodzi_jako_WZ(db):
    """Dokumenty sprzed podziału wysyłki (przed 09.2026) nie mają serii —
    z definicji są zewnętrzne. `NULL` w tym polu schowałby całą historię."""
    _dokument("w3", "WZ/9/08/26", None, None, seq=9)

    assert next(d for d in list_wz() if d["id"] == "w3")["doc_series"] == "WZ"


def test_lista_niesie_zakres_podzialu(db):
    """`split_scope` odróżnia WZ klienta od dokumentu na całość — ekran
    używa go przy pasku „nie wydawać klientowi"."""
    _dokument("w2", "WZ/1/09/26", "WZ", "wz_klienta", seq=2)

    assert next(d for d in list_wz() if d["id"] == "w2")["split_scope"] == "wz_klienta"
