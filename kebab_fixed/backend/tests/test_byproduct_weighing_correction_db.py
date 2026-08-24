"""Korekta i usuwanie ważeń ubocznych z biura.

POWÓD ISTNIENIA: 24.08.2026 partia 503 dostała DUBEL grzbietów — dwie palety
minutę po sobie (15:10 i 15:11), ta sama tara i ta sama liczba pojemników.
Nie było jak tego zdjąć: ważenia ubocznych to palety zapisane w JSON-ie
wewnątrz batch_byproducts, a jedyną drogą był SQL na produkcji.

Świadomie NIE piszemy drugiego zapisującego: korekta buduje nową listę palet
i oddaje ją `record()`, czyli tej samej funkcji, której używa hala. Drugi
zapis rozjechałby się z nią przy pierwszej zmianie (loty ABP, pojemniki,
otwieranie zamkniętej partii).

Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.batch_byproducts_service import (
    correct_weighing, ensure_record, get, record,
)

BATCH = "rb-503"


def _partia(quarter_kg: float = 3390.0):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, kg_received, kg_available, status) "
        "VALUES (%s,%s,%s,%s,'active')",
        (BATCH, "503", quarter_kg, 0),
    )
    ensure_record(BATCH, "MARCIN")
    execute("UPDATE batch_byproducts SET quarter_kg=%s WHERE raw_batch_id=%s", (quarter_kg, BATCH))


def _paleta(net: float, gross: float, cont: int, at: str):
    return {"net": net, "gross": gross, "containers": cont,
            "tareLabel": "bez palety", "tareKg": 0, "weighedAt": at}


def _grzbiety():
    """Trzy palety jak na produkcji 24.08 — dwie ostatnie to dubel."""
    return [
        _paleta(445.0, 535.0, 36, "2026-08-24T13:03:24+00:00"),
        _paleta(162.0, 186.0, 12, "2026-08-24T13:10:07+00:00"),
        _paleta(162.5, 186.5, 12, "2026-08-24T13:11:23+00:00"),
    ]


def _zasiej(db_unused=None):
    _partia()
    pallets = _grzbiety()
    record(BATCH, "backs", sum(p["net"] for p in pallets), pallets)


def test_usuniecie_dubla_zdejmuje_palete_i_przelicza_sume(db):
    _zasiej()
    assert float(get(BATCH)["backsKg"]) == 769.5

    out = correct_weighing(BATCH, "backs", "2026-08-24T13:11:23+00:00",
                           delete=True, reason="dubel — ta sama paleta co 15:10",
                           subject="biuro@kebab")

    assert float(out["backsKg"]) == 607.0
    assert len(out["backsPallets"]) == 2


def test_usuniecie_nie_rusza_pozostalych_palet(db):
    _zasiej()
    out = correct_weighing(BATCH, "backs", "2026-08-24T13:11:23+00:00",
                           delete=True, reason="dubel", subject="biuro@kebab")
    czasy = [p["weighedAt"] for p in out["backsPallets"]]
    assert czasy == ["2026-08-24T13:03:24+00:00", "2026-08-24T13:10:07+00:00"]


def test_poprawka_wagi_palety(db):
    _zasiej()
    out = correct_weighing(BATCH, "backs", "2026-08-24T13:10:07+00:00",
                           net_kg=150.0, gross=174.0, containers=12,
                           reason="zla liczba pojemnikow", subject="biuro@kebab")
    assert float(out["backsKg"]) == 757.5
    poprawiona = [p for p in out["backsPallets"] if p["weighedAt"] == "2026-08-24T13:10:07+00:00"][0]
    assert float(poprawiona["net"]) == 150.0


def test_zdjecie_JEDYNEJ_palety_kasuje_wazenie_frakcji(db):
    """Frakcja wraca na kafel jako niezważona, zamiast udawać zważone 0 kg."""
    _partia()
    jedna = [_paleta(100.0, 120.0, 10, "2026-08-24T10:00:00+00:00")]
    record(BATCH, "bones", 100.0, jedna)

    out = correct_weighing(BATCH, "bones", "2026-08-24T10:00:00+00:00",
                           delete=True, reason="wpisane pomylkowo", subject="biuro@kebab")
    assert out["bonesKg"] is None


def test_paleta_o_nieznanym_czasie_nie_kasuje_niczego(db):
    """Identyfikujemy paletę po CZASIE ważenia, nie po numerze porządkowym —
    indeksy przesuwają się po każdym usunięciu."""
    _zasiej()
    with pytest.raises(HTTPException) as err:
        correct_weighing(BATCH, "backs", "2026-08-24T23:59:59+00:00",
                         delete=True, reason="x", subject="biuro@kebab")
    assert err.value.status_code == 404
    assert float(get(BATCH)["backsKg"]) == 769.5


def test_korekta_bez_powodu_odrzucona(db):
    _zasiej()
    with pytest.raises(HTTPException) as err:
        correct_weighing(BATCH, "backs", "2026-08-24T13:11:23+00:00",
                         delete=True, reason="  ", subject="biuro@kebab")
    assert err.value.status_code == 400


def test_korekta_zostawia_slad_ze_stanem_sprzed_zmiany(db):
    _zasiej()
    correct_weighing(BATCH, "backs", "2026-08-24T13:11:23+00:00",
                     delete=True, reason="dubel z 15:11", subject="biuro@kebab")

    slad = query_one(
        "SELECT by_subject, reason, changes FROM byproduct_weighing_corrections "
        "WHERE raw_batch_id=%s", (BATCH,))
    assert slad["by_subject"] == "biuro@kebab"
    assert "dubel" in slad["reason"]
    assert slad["changes"]["action"] == "delete"
    assert slad["changes"]["kind"] == "backs"
    assert float(slad["changes"]["before"]["net"]) == 162.5
    assert float(slad["changes"]["beforeFractionKg"]) == 769.5


def test_zla_frakcja_odrzucona(db):
    _zasiej()
    with pytest.raises(HTTPException):
        correct_weighing(BATCH, "skrzydla", "2026-08-24T13:11:23+00:00",
                         delete=True, reason="x", subject="biuro@kebab")
