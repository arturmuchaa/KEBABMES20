"""Numeracja bez dziur: anulowanie ZWALNIA numer, a nowe przyjęcie go bierze.

Decyzja właściciela 20.08.2026: numery przyjęć i numery porządkowe mają być
CIĄGŁE. Anulowana rejestracja to korekta naszej pomyłki przy wpisywaniu, a nie
zdarzenie przy rampie — nie ma prawa zjadać numeru w serii, którą biuro czyta
jako listę dostaw i którą drukuje na karcie HACCP 1.1.1.

Dotąd numer partii wracał do puli tylko z nazwy: kolejne przyjęcie i tak brało
następny z licznika, więc po każdej pomyłce zostawała dziura (19.08: widoczna
przerwa między 27/08 a 29/08; w numerach porządkowych brakowało 416 i 448-450).

Ponowne użycie numeru jest bezpieczne WYŁĄCZNIE dlatego, że anulować da się
tylko partię NIETKNIĘTĄ — taki numer nigdy nie trafił na dokument, etykietę
ani kartę HACCP (anulowane pomijamy w rejestrze).

Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
from app.models.raw_batches import RawBatchCreate
from app.models.receptions import ReceptionCreate
from app.services.raw_batches_service import cancel_batch, create_batch
from app.services.receptions_service import cancel_reception_document, create_reception
from app.db import execute, query_all, query_one
from app.utils.ids import now_iso

DZIEN = "2026-09-10"          # osobny miesiąc — własna seria numerów przyjęć


def _dostawca(sid="sup-ciag"):
    execute(
        "INSERT INTO suppliers (id, code, name, display_name, created_at) "
        "VALUES (%s,'CIAG','DOSTAWCA CIAG','CIAG',%s) ON CONFLICT (id) DO NOTHING",
        (sid, now_iso()))
    for mid, nazwa, rozbior in (("mat-cwiartka", "Ćwiartka z kurczaka", True),
                                ("mat-mieso-zs", "Mięso z/s", False)):
        execute("INSERT INTO raw_material_types (id, name, requires_deboning) "
                "VALUES (%s,%s,%s) ON CONFLICT (id) DO NOTHING", (mid, nazwa, rozbior))
    return sid


def _przyjmij(sid, kg=1000.0):
    return create_reception(ReceptionCreate.model_validate({
        "supplierId": sid, "materialTypeId": "mat-cwiartka", "receivedDate": DZIEN,
        "documentNo": "CIAG", "pricePerKg": 5,
        "groups": [{"kgReceived": kg, "supplierBatches": []}],
    }))


def test_numer_porzadkowy_wraca_do_puli_i_jest_uzyty_ponownie(db):
    sid = _dostawca()
    pierwsza = create_batch(RawBatchCreate(supplierId=sid, kgReceived=500, pricePerKg=5))
    numer = pierwsza["internal_batch_no"]

    cancel_batch(pierwsza["id"])
    druga = create_batch(RawBatchCreate(supplierId=sid, kgReceived=600, pricePerKg=5))

    assert druga["internal_batch_no"] == numer, "zwolniony numer ma zostać użyty ponownie"


def test_dziura_w_srodku_serii_zostaje_zalatana(db):
    """Anulowana jest ŚRODKOWA partia — następne przyjęcie bierze właśnie ją,
    a nie kolejny numer z licznika."""
    sid = _dostawca()
    a = create_batch(RawBatchCreate(supplierId=sid, kgReceived=100, pricePerKg=5))
    b = create_batch(RawBatchCreate(supplierId=sid, kgReceived=200, pricePerKg=5))
    c = create_batch(RawBatchCreate(supplierId=sid, kgReceived=300, pricePerKg=5))
    srodkowy = b["internal_batch_no"]

    cancel_batch(b["id"])
    nowa = create_batch(RawBatchCreate(supplierId=sid, kgReceived=400, pricePerKg=5))

    assert nowa["internal_batch_no"] == srodkowy
    zywe = sorted(int(r["internal_batch_no"]) for r in query_all(
        "SELECT internal_batch_no FROM raw_batches "
        "WHERE COALESCE(status,'') <> 'cancelled' AND internal_batch_no ~ '^[0-9]+$'"))
    assert zywe == list(range(zywe[0], zywe[0] + len(zywe))), f"ciąg ma dziurę: {zywe}"
    assert int(a["internal_batch_no"]) < int(srodkowy) < int(c["internal_batch_no"])


def test_numer_przyjecia_wraca_do_puli_po_anulowaniu_dokumentu(db):
    sid = _dostawca()
    pierwsze = _przyjmij(sid)
    nr = pierwsze["reception"]["reception_no"]

    cancel_reception_document(pierwsze["reception"]["id"])
    drugie = _przyjmij(sid, kg=2000)

    assert drugie["reception"]["reception_no"] == nr, "numer przyjęcia ma wrócić do puli"


def test_anulowany_dokument_zostaje_w_historii_poza_seria(db):
    """Ślad musi zostać — znika tylko z serii numerów, nie z bazy."""
    sid = _dostawca()
    p = _przyjmij(sid)
    rec_id = p["reception"]["id"]

    cancel_reception_document(rec_id)

    rec = query_one("SELECT reception_no, reception_seq FROM receptions WHERE id=%s", (rec_id,))
    assert rec is not None, "dokument nie może zniknąć z bazy"
    assert rec["reception_no"].startswith("ANUL"), "poza serią, z czytelnym znacznikiem"


def test_dwa_anulowania_pod_tym_samym_numerem_nie_koliduja(db):
    """Numer wraca do puli, więc DRUGI dokument może dostać ten sam numer —
    i też bywa anulowany. Obie anulowane wersje muszą się zmieścić poza serią.

    Znalezione próbą generalną na kopii produkcji 20.08.2026: przesuwanie
    o stałe 9000 dawało kolizję z unikatem (period, seq, is_service).
    """
    sid = _dostawca()
    pierwsze = _przyjmij(sid)
    nr = pierwsze["reception"]["reception_no"]
    cancel_reception_document(pierwsze["reception"]["id"])

    drugie = _przyjmij(sid, kg=2000)
    assert drugie["reception"]["reception_no"] == nr
    cancel_reception_document(drugie["reception"]["id"])   # przed poprawką: UniqueViolation

    poza = query_all(
        "SELECT reception_seq FROM receptions WHERE reception_period=%s AND reception_seq >= 9000",
        (pierwsze["reception"]["reception_period"],))
    assert len({r["reception_seq"] for r in poza}) == len(poza), "numery poza serią muszą być różne"

    trzecie = _przyjmij(sid, kg=3000)
    assert trzecie["reception"]["reception_no"] == nr, "numer nadal wraca do puli"
