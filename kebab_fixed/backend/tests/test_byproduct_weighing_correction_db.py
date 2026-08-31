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
    correct_weighing, ensure_record, get, move_weighing, record,
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


# ─── Przeniesienie ważenia na inną partię ─────────────────────────────
#
# POWÓD ISTNIENIA: 31.08.2026 paleta grzbietów zważona o 12:37 (490,5 kg)
# poszła pod partię 519, choć materiał był już z 520 — dwie partie szły
# równolegle i kreator na HMI trzymał starą (patrz kebab-abp-przypisanie-
# miedzy-partiami). Bilans 519 skoczył do 122% ćwiartki, a 520 pokazywała
# zero grzbietów. Do tej pory jedyną drogą był SQL na produkcji.

CEL = "rb-520"


def _partia_docelowa(quarter_kg: float = 1650.0):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, kg_received, kg_available, status) "
        "VALUES (%s,%s,%s,%s,'active')",
        (CEL, "520", quarter_kg, 0),
    )
    ensure_record(CEL, "MARCIN")
    execute("UPDATE batch_byproducts SET quarter_kg=%s WHERE raw_batch_id=%s", (quarter_kg, CEL))


def test_przeniesienie_zdejmuje_palete_ze_zrodla_i_dokłada_do_celu(db):
    _zasiej()
    _partia_docelowa()

    out = move_weighing(BATCH, "backs", "2026-08-24T13:03:24+00:00", CEL,
                        reason="material byl juz z 520", subject="biuro@kebab")

    # Zwracamy partię DOCELOWĄ — biuro patrzy, gdzie paleta wylądowała.
    assert out["rawBatchNo"] == "520"
    assert float(out["backsKg"]) == 445.0
    assert float(get(BATCH)["backsKg"]) == 324.5


def test_przeniesienie_zachowuje_czas_wazenia(db):
    """Paleta należy do dnia SWOJEGO ważenia — stempel nie może się zmienić,
    inaczej dziennik i pasek HMI przerzucą ją na dzień korekty."""
    _zasiej()
    _partia_docelowa()

    out = move_weighing(BATCH, "backs", "2026-08-24T13:03:24+00:00", CEL,
                        reason="zla partia", subject="biuro@kebab")

    assert [p["weighedAt"] for p in out["backsPallets"]] == ["2026-08-24T13:03:24+00:00"]
    przeniesiona = out["backsPallets"][0]
    assert float(przeniesiona["net"]) == 445.0
    assert int(przeniesiona["containers"]) == 36


def test_przeniesienie_przenosi_kilogramy_i_pojemniki_na_magazynie(db):
    _zasiej()
    _partia_docelowa()

    move_weighing(BATCH, "backs", "2026-08-24T13:03:24+00:00", CEL,
                  reason="zla partia", subject="biuro@kebab")

    zrodlo = query_one(
        "SELECT kg, containers_available FROM byproduct_lots WHERE raw_batch_id=%s "
        "AND kind='backs' AND deboning_entry_id IS NULL AND status='open'", (BATCH,))
    cel = query_one(
        "SELECT kg, containers_available FROM byproduct_lots WHERE raw_batch_id=%s "
        "AND kind='backs' AND deboning_entry_id IS NULL AND status='open'", (CEL,))
    assert float(zrodlo["kg"]) == 324.5
    assert int(zrodlo["containers_available"]) == 24
    assert float(cel["kg"]) == 445.0
    assert int(cel["containers_available"]) == 36


def test_przeniesienie_jedynej_palety_kasuje_frakcje_zrodla(db):
    """Źródło wraca na kafel jako niezważone, zamiast udawać zważone 0 kg."""
    _partia()
    _partia_docelowa()
    record(BATCH, "bones", 100.0, [_paleta(100.0, 120.0, 10, "2026-08-24T10:00:00+00:00")])

    move_weighing(BATCH, "bones", "2026-08-24T10:00:00+00:00", CEL,
                  reason="zla partia", subject="biuro@kebab")

    assert get(BATCH)["bonesKg"] is None
    assert float(get(CEL)["bonesKg"]) == 100.0


def test_przeniesienie_dokłada_do_frakcji_ktora_juz_ma_palety(db):
    _zasiej()
    _partia_docelowa()
    record(CEL, "backs", 200.0, [_paleta(200.0, 236.0, 16, "2026-08-24T12:00:00+00:00")])

    out = move_weighing(BATCH, "backs", "2026-08-24T13:03:24+00:00", CEL,
                        reason="zla partia", subject="biuro@kebab")

    assert float(out["backsKg"]) == 645.0
    assert len(out["backsPallets"]) == 2


def test_przeniesienie_zostawia_slad_w_obu_partiach(db):
    _zasiej()
    _partia_docelowa()

    move_weighing(BATCH, "backs", "2026-08-24T13:03:24+00:00", CEL,
                  reason="material byl juz z 520", subject="biuro@kebab")

    z = query_one("SELECT reason, changes FROM byproduct_weighing_corrections "
                  "WHERE raw_batch_id=%s", (BATCH,))
    c = query_one("SELECT reason, changes FROM byproduct_weighing_corrections "
                  "WHERE raw_batch_id=%s", (CEL,))
    assert z["changes"]["action"] == "move_out"
    assert z["changes"]["targetRawBatchNo"] == "520"
    assert float(z["changes"]["beforeFractionKg"]) == 769.5
    assert float(z["changes"]["afterFractionKg"]) == 324.5
    assert c["changes"]["action"] == "move_in"
    assert c["changes"]["sourceRawBatchNo"] == "503"
    assert z["reason"] == "material byl juz z 520"


def test_przeniesienie_na_te_sama_partie_odrzucone(db):
    _zasiej()
    with pytest.raises(HTTPException) as err:
        move_weighing(BATCH, "backs", "2026-08-24T13:03:24+00:00", BATCH,
                      reason="x", subject="biuro@kebab")
    assert err.value.status_code == 400


def test_przeniesienie_na_nieistniejaca_partie_odrzucone(db):
    _zasiej()
    with pytest.raises(HTTPException) as err:
        move_weighing(BATCH, "backs", "2026-08-24T13:03:24+00:00", "rb-nie-ma",
                      reason="x", subject="biuro@kebab")
    assert err.value.status_code == 404
    assert float(get(BATCH)["backsKg"]) == 769.5


def test_przeniesienie_bez_powodu_odrzucone(db):
    _zasiej()
    _partia_docelowa()
    with pytest.raises(HTTPException) as err:
        move_weighing(BATCH, "backs", "2026-08-24T13:03:24+00:00", CEL,
                      reason="  ", subject="biuro@kebab")
    assert err.value.status_code == 400


def test_przeniesienie_palety_o_nieznanym_czasie_nie_rusza_niczego(db):
    _zasiej()
    _partia_docelowa()
    with pytest.raises(HTTPException) as err:
        move_weighing(BATCH, "backs", "2026-08-24T23:59:59+00:00", CEL,
                      reason="x", subject="biuro@kebab")
    assert err.value.status_code == 404
    assert float(get(BATCH)["backsKg"]) == 769.5
    assert get(CEL)["backsKg"] is None


def test_przeniesienie_wiekszej_masy_niz_zostalo_na_magazynie_odrzucone(db):
    """Frakcja częściowo wydana na WZ: po przeniesieniu na źródle zostałoby
    mniej kg, niż już wyjechało — magazyn dostałby FANTOMOWE kilogramy
    (klasa incydentu 411). Najpierw poprawia się dokument WZ."""
    _zasiej()
    _partia_docelowa()
    # WZ zabrało 600 kg z lotu 769,5 kg — zostało 169,5 kg żywego stanu.
    execute("UPDATE byproduct_lots SET kg=169.5, containers_available=13 "
            "WHERE raw_batch_id=%s AND kind='backs' AND deboning_entry_id IS NULL",
            (BATCH,))

    with pytest.raises(HTTPException) as err:
        move_weighing(BATCH, "backs", "2026-08-24T13:03:24+00:00", CEL,
                      reason="zla partia", subject="biuro@kebab")
    assert err.value.status_code == 400
    assert "WZ" in err.value.detail
    assert float(get(BATCH)["backsKg"]) == 769.5


def test_przeniesienie_po_czesciowym_wydaniu_zostawia_wydane_na_zrodle(db):
    """Wydane kg zostają na źródle (WZ ich dotyczy), przenosi się tylko to,
    co fizycznie leży na magazynie."""
    _zasiej()
    _partia_docelowa()
    # WZ zabrało 162,5 kg (najmniejsza paleta) — zostało 607 kg żywego stanu.
    execute("UPDATE byproduct_lots SET kg=607.0, containers_available=48 "
            "WHERE raw_batch_id=%s AND kind='backs' AND deboning_entry_id IS NULL",
            (BATCH,))

    move_weighing(BATCH, "backs", "2026-08-24T13:03:24+00:00", CEL,
                  reason="zla partia", subject="biuro@kebab")

    zrodlo = query_one(
        "SELECT kg FROM byproduct_lots WHERE raw_batch_id=%s AND kind='backs' "
        "AND deboning_entry_id IS NULL AND status='open'", (BATCH,))
    cel = query_one(
        "SELECT kg FROM byproduct_lots WHERE raw_batch_id=%s AND kind='backs' "
        "AND deboning_entry_id IS NULL AND status='open'", (CEL,))
    assert float(zrodlo["kg"]) == 162.0     # 324,5 zważone − 162,5 wydane
    assert float(cel["kg"]) == 445.0
