"""Numeracja WZ bez dziur — anulowany dokument ODDAJE swój numer.

Biuro czyta serię WZ jak rejestr faktur w Subiekcie: numery aktywnych
dokumentów mają iść po kolei. Do 21.08.2026 anulowanie zostawiało numer
zajęty na zawsze — w sierpniu 12 z 34 numerów było dziurami po anulowanych.

Anulowany dokument NIE znika: schodzi z serii pod numerem „ANUL WZ/11/08/26"
i zostaje w rejestrze (osobna zakładka), żeby dało się odtworzyć, co się
wydarzyło.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.wz_service import cancel_wz, create_manual_wz
from app.utils.ids import now_iso

BUYER = {"name": "ODBIORCA SP. Z O.O.", "address": "Kraków", "nip": "1111111111"}


def _seed_raw_batch(bid="rb1", no="900", kg=6000.0):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, container_kg, created_at) "
        "VALUES (%s,%s,'KOKO',%s,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',15,%s)",
        (bid, no, kg, kg, now_iso()))


def _wz(qty=100.0):
    return create_manual_wz(
        buyer=BUYER,
        selections=[{"stock_type": "raw", "stock_id": "rb1", "name": "Ćwiartka",
                     "unit": "kg", "qty": qty, "price": 5.0, "batch_no": "900",
                     "containers": 7}],
        valued=True)


def _seq(wz_id):
    return query_one("SELECT seq, number, status FROM wz_documents WHERE id=%s", (wz_id,))


def test_numery_ida_po_kolei(db):
    _seed_raw_batch()
    assert [_seq(_wz()["id"])["seq"] for _ in range(3)] == [1, 2, 3]


def test_anulowany_oddaje_numer_nastepnemu(db):
    _seed_raw_batch()
    pierwszy, drugi = _wz(), _wz()
    assert _seq(drugi["id"])["seq"] == 2

    cancel_wz(drugi["id"])

    # Numer 2 wrócił do puli — bierze go kolejny wystawiony dokument.
    assert _seq(_wz()["id"])["seq"] == 2


def test_anulowany_schodzi_z_serii_i_zostaje_w_rejestrze(db):
    _seed_raw_batch()
    doc = _wz()
    numer = _seq(doc["id"])["number"]

    cancel_wz(doc["id"])

    po = _seq(doc["id"])
    assert po["status"] == "anulowany"
    assert po["number"] == f"ANUL {numer}", "anulowany zostaje z czytelnym śladem"
    assert po["seq"] >= 9000, "poza serią, żeby nie blokował numeru"


def test_dwa_anulowania_oddaja_numery_w_kolejnosci(db):
    _seed_raw_batch()
    a, b, c = _wz(), _wz(), _wz()          # 1, 2, 3
    cancel_wz(c["id"])
    cancel_wz(b["id"])

    # Pula oddaje od najniższego, żeby seria zasypywała się od dołu.
    assert _seq(_wz()["id"])["seq"] == 2
    assert _seq(_wz()["id"])["seq"] == 3
    assert _seq(_wz()["id"])["seq"] == 4
    assert _seq(a["id"])["seq"] == 1


def test_anulowanie_tego_samego_numeru_dwa_razy_nie_koliduje(db):
    # Numer wraca do puli, kolejny dokument go bierze i też bywa anulowany —
    # stałe przesunięcie „numer + 9000" dawało wtedy kolizję unikatu.
    _seed_raw_batch()
    pierwszy = _wz()
    cancel_wz(pierwszy["id"])
    drugi = _wz()
    assert _seq(drugi["id"])["seq"] == 1

    cancel_wz(drugi["id"])

    assert _seq(drugi["id"])["status"] == "anulowany"
    assert _seq(pierwszy["id"])["seq"] != _seq(drugi["id"])["seq"]


def test_juz_anulowanego_nie_da_sie_anulowac_drugi_raz(db):
    _seed_raw_batch()
    doc = _wz()
    cancel_wz(doc["id"])
    with pytest.raises(HTTPException) as e:
        cancel_wz(doc["id"])
    assert e.value.status_code == 409


def test_baza_nie_pozwoli_dwom_wz_nosic_tego_samego_numeru(db):
    # Numery wracają do puli, więc o pomyłkę łatwiej niż dotąd — unikat w bazie
    # jest ostatnią linią obrony przed dwoma dokumentami o tym samym numerze.
    import psycopg2
    _seed_raw_batch()
    doc = _wz()
    row = _seq(doc["id"])
    with pytest.raises(psycopg2.errors.UniqueViolation):
        execute(
            "INSERT INTO wz_documents (id, number, seq, year_month, source_type, "
            " seller, buyer_name, valued, lines, total_value, status, created_at) "
            "VALUES ('inny', %s, %s, (SELECT year_month FROM wz_documents WHERE id=%s), "
            " 'manual', '{}'::jsonb, 'X', false, '[]'::jsonb, 0, 'wstepny', %s)",
            (row["number"] + " BIS", row["seq"], doc["id"], now_iso()))


def test_podpowiedz_numeru_pokazuje_ten_ktory_dostanie_dokument(db):
    from app.services.wz_service import next_wz_number
    _seed_raw_batch()

    assert next_wz_number()["seq"] == 1
    doc = _wz()
    assert _seq(doc["id"])["seq"] == 1
    assert next_wz_number()["seq"] == 2


def test_podpowiedz_widzi_numer_zwolniony_anulowaniem(db):
    from app.services.wz_service import next_wz_number
    _seed_raw_batch()
    _wz(); drugi = _wz()          # 1, 2
    cancel_wz(drugi["id"])

    # Formularz musi pokazać TEN numer, który nada zapis — inaczej biuro widzi
    # jeden, a dokument wychodzi z drugim (przyjęcia, 21.08.2026).
    assert next_wz_number()["seq"] == 2
    assert next_wz_number()["number"].startswith("WZ/2/")


def test_podpowiedz_nie_zabiera_numeru_z_puli(db):
    from app.services.wz_service import next_wz_number
    _seed_raw_batch()
    _wz(); drugi = _wz()
    cancel_wz(drugi["id"])

    next_wz_number(); next_wz_number()      # podgląd, nie pobranie

    assert _seq(_wz()["id"])["seq"] == 2
