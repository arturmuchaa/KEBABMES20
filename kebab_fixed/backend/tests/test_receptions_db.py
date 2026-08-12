"""Przyjęcie = dokument całej dostawy, rozbity na numery porządkowe.

Model: 10 t ćwiartki przyjeżdża pod JEDNYM numerem przyjęcia („1/08")
i rozpada się na 2-3 numery porządkowe; partie dostawcy (jego numery) wiszą
pod tą grupą, do której fizycznie trafiły.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.raw_batches import RawBatchCreate
from app.models.receptions import ReceptionCreate
from app.services.raw_batches_service import cancel_batch, create_batch
from app.services.receptions_service import (
    create_reception,
    get_reception,
    next_delivery_number,
)
from app.utils.ids import cuid, now_iso


def _seed_supplier():
    execute("INSERT INTO suppliers (id, code, name, nip, active, created_at) "
            "VALUES ('sup1','SUP1','KOKO','5130064478',true,%s)", (now_iso(),))
    execute("INSERT INTO suppliers (id, code, name, nip, active, created_at) "
            "VALUES ('sup2','SUP2','FARMEX','5130064479',true,%s)", (now_iso(),))


def _dto(**kw):
    """Dostawa 10 t rozbita na 6000 + 4000 kg, po stronie dostawcy 8 partii."""
    base = dict(
        receivedDate="2026-08-11",
        supplierId="sup1",
        materialTypeId="mat-cwiartka",
        documentNo="WZ-12345",
        pricePerKg=5.0,
        groups=[
            dict(kgReceived=6000.0, supplierBatches=[
                dict(supplierBatchNo="A001", kg=600.0, slaughterDate="2026-08-10",
                     expiryDate="2026-08-17"),
                dict(supplierBatchNo="A002", kg=1200.0, slaughterDate="2026-08-10",
                     expiryDate="2026-08-17"),
                dict(supplierBatchNo="A003", kg=2400.0, slaughterDate="2026-08-09",
                     expiryDate="2026-08-16"),
                dict(supplierBatchNo="A004", kg=800.0, slaughterDate="2026-08-10",
                     expiryDate="2026-08-17"),
                dict(supplierBatchNo="A005", kg=1000.0, slaughterDate="2026-08-10",
                     expiryDate="2026-08-17"),
            ]),
            dict(kgReceived=4000.0, supplierBatches=[
                dict(supplierBatchNo="A006", kg=1500.0, slaughterDate="2026-08-10",
                     expiryDate="2026-08-17"),
                dict(supplierBatchNo="A007", kg=1500.0, slaughterDate="2026-08-10",
                     expiryDate="2026-08-17"),
                dict(supplierBatchNo="A008", kg=1000.0, slaughterDate="2026-08-10",
                     expiryDate="2026-08-17"),
            ]),
        ],
    )
    base.update(kw)
    return ReceptionCreate.model_validate(base)


# --- numer przyjęcia -------------------------------------------------------
def test_jedna_dostawa_jeden_numer_przyjecia_dwa_porzadkowe(db):
    _seed_supplier()
    out = create_reception(_dto())

    assert out["reception"]["reception_no"] == "1/08"
    assert len(out["batches"]) == 2
    # Numery porządkowe są kolejne i RÓŻNE — to one jadą przez halę.
    nos = [b["internal_batch_no"] for b in out["batches"]]
    assert len(set(nos)) == 2
    assert [float(b["kg_received"]) for b in out["batches"]] == [6000.0, 4000.0]
    # Obie partie wiszą pod tym samym dokumentem dostawy.
    assert {b["reception_id"] for b in out["batches"]} == {out["reception"]["id"]}


def test_numer_przyjecia_rosnie_w_miesiacu_i_resetuje_sie_z_nowym(db):
    _seed_supplier()
    assert create_reception(_dto())["reception"]["reception_no"] == "1/08"
    assert create_reception(_dto())["reception"]["reception_no"] == "2/08"
    # Nowy miesiąc = numeracja od nowa; karta 1.1.1 jest miesięczna.
    wrzesien = create_reception(_dto(receivedDate="2026-09-01"))
    assert wrzesien["reception"]["reception_no"] == "1/09"


def test_numer_przyjecia_mozna_wpisac_recznie(db):
    _seed_supplier()
    out = create_reception(_dto(receptionNo="7/08"))
    assert out["reception"]["reception_no"] == "7/08"
    # Kolejne auto-numery nie mogą cofnąć się pod wpisany ręcznie.
    assert create_reception(_dto())["reception"]["reception_no"] == "8/08"


def test_duplikat_numeru_przyjecia_odrzucony(db):
    _seed_supplier()
    create_reception(_dto(receptionNo="3/08"))
    with pytest.raises(HTTPException) as exc:
        create_reception(_dto(receptionNo="3/08"))
    assert exc.value.status_code == 409


def test_next_delivery_number_podpowiada_kolejny(db):
    _seed_supplier()
    assert next_delivery_number("2026-08-11")["nextNo"] == "1/08"
    create_reception(_dto())
    assert next_delivery_number("2026-08-11")["nextNo"] == "2/08"


# --- partie dostawcy -------------------------------------------------------
def test_partie_dostawcy_zapisane_z_kilogramami_pod_wlasciwa_grupa(db):
    _seed_supplier()
    out = create_reception(_dto())
    first, second = out["batches"][0], out["batches"][1]

    rows = query_all(
        "SELECT supplier_batch_no, kg, raw_batch_id FROM reception_supplier_batches "
        "WHERE reception_id=%s ORDER BY seq", (out["reception"]["id"],))
    assert len(rows) == 8
    assert sum(float(r["kg"]) for r in rows) == 10000.0
    # A003 (2400 kg) w całości w pierwszym numerze porządkowym — partii
    # dostawcy nie dzielimy między nasze numery.
    a003 = next(r for r in rows if r["supplier_batch_no"] == "A003")
    assert a003["raw_batch_id"] == first["id"]
    assert float(a003["kg"]) == 2400.0
    assert {r["raw_batch_id"] for r in rows if r["supplier_batch_no"] in
            ("A006", "A007", "A008")} == {second["id"]}


def test_numery_dostawcy_widoczne_na_partii(db):
    """Kolumna `supplier_batch_no` zostaje — czyta ją WZ, HDI i traceability."""
    _seed_supplier()
    out = create_reception(_dto())
    assert out["batches"][0]["supplier_batch_no"] == "A001, A002, A003, A004, A005"
    assert out["batches"][1]["supplier_batch_no"] == "A006, A007, A008"


def test_daty_grupy_z_najwczesniejszej_partii_dostawcy(db):
    """FEFO liczy się od najkrótszej daty w stosie, nie od średniej."""
    _seed_supplier()
    out = create_reception(_dto())
    first = query_one("SELECT slaughter_date, expiry_date FROM raw_batches WHERE id=%s",
                      (out["batches"][0]["id"],))
    assert str(first["slaughter_date"]) == "2026-08-09"   # A003
    assert str(first["expiry_date"]) == "2026-08-16"


# --- kontrole --------------------------------------------------------------
def test_suma_partii_dostawcy_musi_zgadzac_sie_z_kg_grupy(db):
    _seed_supplier()
    dto = _dto()
    dto.groups[0].kg_received = 5500.0        # a partie dostawcy dają 6000
    with pytest.raises(HTTPException) as exc:
        create_reception(dto)
    assert exc.value.status_code == 400
    assert "6000" in str(exc.value.detail)
    # Nic nie zostało po odrzuconym przyjęciu — cała dostawa w jednej transakcji.
    assert query_all("SELECT id FROM raw_batches") == []
    assert query_all("SELECT id FROM receptions") == []


def test_przyjecie_bez_grup_odrzucone(db):
    _seed_supplier()
    with pytest.raises(HTTPException) as exc:
        create_reception(_dto(groups=[]))
    assert exc.value.status_code == 400


def test_partia_dostawcy_w_dwoch_grupach_daje_ostrzezenie_ale_nie_blokuje(db):
    """Jednej partii dostawcy nie dzielimy między nasze numery — ale to
    ostrzeżenie, nie blokada: o 6 rano dostawa musi wejść do systemu, a
    anomalię widać w odpowiedzi i na ekranie."""
    _seed_supplier()
    dto = _dto()
    dto.groups[1].supplier_batches[0].supplier_batch_no = "A003"
    out = create_reception(dto)
    assert len(out["batches"]) == 2
    assert any("A003" in w for w in out["warnings"])


def test_grupa_bez_partii_dostawcy_przechodzi(db):
    """Mięso z/s bywa dostarczane bez numerów partii dostawcy — kontrola sumy
    nie może wtedy blokować przyjęcia."""
    _seed_supplier()
    out = create_reception(_dto(groups=[dict(kgReceived=2400.0, supplierBatches=[])]))
    assert float(out["batches"][0]["kg_received"]) == 2400.0
    assert out["reception"]["reception_no"] == "1/08"


# --- integracja z resztą systemu -------------------------------------------
def test_pojedyncze_przyjecie_dopina_sie_do_dokumentu_z_tego_dnia(db):
    """Stara ścieżka (jedna partia naraz) nie może zostawiać partii bez
    dokumentu — dopina się do przyjęcia tego dnia od tego dostawcy."""
    _seed_supplier()
    out = create_reception(_dto())
    b = create_batch(RawBatchCreate.model_validate(dict(
        supplierId="sup1", kgReceived=1500.0, receivedDate="2026-08-11",
        materialTypeId="mat-cwiartka", supplierBatchNo="A009")))
    assert b["reception_id"] == out["reception"]["id"]


def test_inny_dostawca_tego_samego_dnia_to_osobne_przyjecie(db):
    _seed_supplier()
    a = create_batch(RawBatchCreate.model_validate(dict(
        supplierId="sup1", kgReceived=1000.0, receivedDate="2026-08-11",
        materialTypeId="mat-cwiartka")))
    b = create_batch(RawBatchCreate.model_validate(dict(
        supplierId="sup2", kgReceived=1000.0, receivedDate="2026-08-11",
        materialTypeId="mat-cwiartka")))
    assert a["reception_id"] != b["reception_id"]


def test_surowiec_bez_rozbioru_nadal_ladzie_na_magazynie_miesa(db):
    """Regresja refaktoru create_batch_cx: filet ma po przyjęciu iść prosto
    do meat_stock, a partia zostaje zapisem traceability z kg_available=0."""
    _seed_supplier()
    out = create_reception(_dto(
        materialTypeId="mat-filet-kurczak",
        groups=[dict(kgReceived=816.0, supplierBatches=[
            dict(supplierBatchNo="10508/34", kg=816.0)])]))
    batch = out["batches"][0]
    assert float(query_one("SELECT kg_available FROM raw_batches WHERE id=%s",
                           (batch["id"],))["kg_available"]) == 0.0
    lot = query_one("SELECT kg_available FROM meat_stock WHERE raw_batch_id=%s",
                    (batch["id"],))
    assert float(lot["kg_available"]) == 816.0


def test_przyjmuje_ksztalt_wysylany_przez_formularz(db):
    """Formularz nazywa wagę pozycji HDI `kgReceived`, kolumna w bazie to `kg`.

    Bez obu nazw kilogramy partii dostawcy wpadały jako 0: kontrola sumy nie
    miała czego sprawdzać, a w bazie lądowały same NULL-e.
    """
    _seed_supplier()
    out = create_reception(ReceptionCreate.model_validate({
        "receivedDate": "2026-08-11", "supplierId": "sup1",
        "materialTypeId": "mat-cwiartka", "documentNo": "WZ 27", "pricePerKg": 5.2,
        "groups": [{
            "kgReceived": 5235.0,
            "supplierBatches": [
                {"supplierBatchNo": "112819", "kgReceived": 2000.0,
                 "slaughterDate": "2026-08-10", "expiryDate": "2026-08-17"},
                {"supplierBatchNo": "112820", "kgReceived": 3235.0,
                 "slaughterDate": "2026-08-09", "expiryDate": "2026-08-16"},
            ],
        }],
    }))
    rows = query_all("SELECT supplier_batch_no, kg FROM reception_supplier_batches "
                     "WHERE reception_id=%s ORDER BY seq", (out["reception"]["id"],))
    assert [float(r["kg"]) for r in rows] == [2000.0, 3235.0]


def test_get_reception_zwraca_dokument_z_partiami(db):
    _seed_supplier()
    out = create_reception(_dto())
    doc = get_reception(out["reception"]["id"])
    assert doc["reception_no"] == "1/08"
    assert float(doc["kg_total"]) == 10000.0
    assert len(doc["batches"]) == 2
    assert len(doc["batches"][0]["supplier_batches"]) == 5


def test_mieso_z_rozbioru_dolaczone_do_numeru_porzadkowego(db):
    """Kolumna „Mięso [kg]" karty 1.1.1/2 — znana dopiero po rozbiorze.

    Liczona jak wszędzie indziej: tylko wpisy `complete`, więc storno ani
    pobranie w trakcie ważenia nie zawyża dokumentu.
    """
    _seed_supplier()
    out = create_reception(_dto())
    first = out["batches"][0]
    for kg, status in ((900.0, "complete"), (500.0, "complete"), (300.0, "cancelled")):
        execute(
            "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, kg_meat, status, created_at) "
            "VALUES (%s,%s,%s,%s,%s,%s)",
            (cuid(), first["id"], first["internal_batch_no"], kg, status, now_iso()))

    doc = get_reception(out["reception"]["id"])
    assert float(doc["batches"][0]["kg_meat"]) == 1400.0
    # Partia jeszcze nierozebrana ma zero, a nie brak klucza — wydruk czyta
    # to pole bezwarunkowo.
    assert float(doc["batches"][1]["kg_meat"]) == 0.0


def test_surowiec_bez_rozbioru_ma_mieso_rowne_dostawie(db):
    """Filet nie idzie na rozbiór — cała dostawa JEST mięsem i tak ma się
    pokazać na karcie, zamiast zera wyglądającego na partię nieprzerobioną."""
    _seed_supplier()
    out = create_reception(_dto(
        materialTypeId="mat-filet-kurczak",
        groups=[dict(kgReceived=816.0, supplierBatches=[
            dict(supplierBatchNo="10508/34", kg=816.0)])]))
    doc = get_reception(out["reception"]["id"])
    assert float(doc["batches"][0]["kg_meat"]) == 816.0


def test_anulowana_rejestracja_nie_podbija_wagi_dokumentu(db):
    """7/08 pokazywało 20 010 kg od FARMEXU zamiast 10 005: anulowane
    rejestracje (korekta naszej pomyłki) sumowały się jak dostawy."""
    _seed_supplier()
    out = create_reception(_dto())
    cancel_batch(out["batches"][1]["id"])

    doc = get_reception(out["reception"]["id"])
    assert float(doc["kg_total"]) == 6000.0
    # Sam rekord zostaje w dokumencie — kasowanie danych jest zabronione,
    # z kart wycina go dopiero warstwa wydruku.
    assert len(doc["batches"]) == 2


def _scans_in(monkeypatch, katalog):
    """Kieruje magazyn skanów na katalog testu.

    `settings` jest zamrożone (frozen dataclass), więc podmieniamy całą
    referencję w module magazynu — to on jako jedyny czyta `hdi_scans_dir`.
    """
    from dataclasses import replace

    from app.config import settings
    from app.services import hdi_scan_store as store

    monkeypatch.setattr(store, "settings", replace(settings, hdi_scans_dir=katalog))


def test_skan_hdi_staje_sie_zalacznikiem_przyjecia(db, tmp_path, monkeypatch):
    """Skan wjeżdża do poczekalni, a ZAPIS przyjęcia czyni go załącznikiem.

    Ta ścieżka do 2026-08-12 nie wykonała się na produkcji ani razu (46
    przyjęć, zero załączników) — a to od niej zależy, czy przy kontroli
    da się pokazać, NA PODSTAWIE CZEGO przyjęto surowiec.
    """
    from app.services import hdi_scan_store as store

    _scans_in(monkeypatch, tmp_path)
    _seed_supplier()

    scan_id = store.save_temp(b"%PDF-1.4 udawany skan", ".pdf")
    assert store.find_temp(scan_id) is not None

    out = create_reception(_dto(hdiScanId=scan_id))
    rid = out["reception"]["id"]

    # Nazwa w bazie + plik pod nią rzeczywiście do pobrania.
    nazwa = query_one("SELECT hdi_scan FROM receptions WHERE id=%s", (rid,))["hdi_scan"]
    assert nazwa == f"{rid}.pdf"
    plik = store.find_attached(nazwa)
    assert plik is not None and plik.read_bytes().startswith(b"%PDF")

    # Z poczekalni znika — załącznik ma jedno miejsce, nie dwa.
    assert store.find_temp(scan_id) is None


def test_przyjecie_bez_skanu_nie_udaje_zalacznika(db, tmp_path, monkeypatch):
    """Brak skanu ma zostawić puste pole, a nie nazwę pliku, którego nie ma —
    inaczej w tabeli pojawiłby się link prowadzący donikąd."""
    _scans_in(monkeypatch, tmp_path)
    _seed_supplier()
    out = create_reception(_dto())
    rec = query_one("SELECT hdi_scan FROM receptions WHERE id=%s", (out["reception"]["id"],))
    assert (rec["hdi_scan"] or "") == ""


def test_skan_mozna_dopiac_do_juz_zapisanej_dostawy(db, tmp_path, monkeypatch):
    """46 dostaw na produkcji nie ma dokumentu, bo powstały przed archiwum.
    Bez dopinania po fakcie zostałyby bez HDI na zawsze."""
    from app.services import hdi_scan_store as store
    from app.services.receptions_service import attach_scan

    _scans_in(monkeypatch, tmp_path)
    _seed_supplier()
    rid = create_reception(_dto())["reception"]["id"]

    out = attach_scan(rid, b"%PDF-1.4 dokument dostawy", "hdi.pdf")
    assert out["replaced"] is False
    assert store.find_attached(out["hdi_scan"]) is not None
    assert query_one("SELECT hdi_scan FROM receptions WHERE id=%s", (rid,))["hdi_scan"] == f"{rid}.pdf"


def test_dopiecie_skanu_zastepuje_poprzedni_i_to_odnotowuje(db, tmp_path, monkeypatch):
    """Operator wgrał nie ten dokument — podmiana musi być możliwa, ale
    oznaczona: to zmiana w dokumentacji pokazywanej kontroli."""
    from app.services import hdi_scan_store as store
    from app.services.receptions_service import attach_scan

    _scans_in(monkeypatch, tmp_path)
    _seed_supplier()
    rid = create_reception(_dto())["reception"]["id"]

    attach_scan(rid, b"%PDF-1.4 zly", "a.pdf")
    out = attach_scan(rid, b"%PDF-1.4 wlasciwy", "b.pdf")
    assert out["replaced"] is True
    assert store.find_attached(out["hdi_scan"]).read_bytes().endswith(b"wlasciwy")


def test_dopiecie_do_nieistniejacej_dostawy_konczy_sie_404(db, tmp_path, monkeypatch):
    from app.services.receptions_service import attach_scan

    _scans_in(monkeypatch, tmp_path)
    with pytest.raises(HTTPException) as e:
        attach_scan("nie-ma-takiego", b"%PDF", "x.pdf")
    assert e.value.status_code == 404


def test_ten_sam_numer_moze_wrocic_w_kolejnym_roku(db):
    """Numer nie niesie roku („1/08"), więc w sierpniu 2027 wraca ten sam.

    To ŚWIADOMA konsekwencja formatu z kart HACCP. Unikalności pilnuje para
    (miesiąc dostawy, numer w miesiącu), nie sam napis — dawny unikat na
    `reception_no` wywaliłby zapis pierwszej sierpniowej dostawy 2027 roku.
    """
    _seed_supplier()
    a = create_reception(_dto(receivedDate="2026-08-11"))["reception"]
    b = create_reception(_dto(receivedDate="2027-08-11"))["reception"]

    assert a["reception_no"] == b["reception_no"] == "1/08"
    assert a["reception_period"] == "2026-08"
    assert b["reception_period"] == "2027-08"
    assert a["id"] != b["id"]


def test_reczny_numer_musi_zgadzac_sie_z_miesiacem_dostawy(db):
    """„5/07" przy dostawie z sierpnia to pomyłka w przepisywaniu — dokument
    wylądowałby w innym miesiącu, niż mówi jego własny numer."""
    _seed_supplier()
    with pytest.raises(HTTPException) as e:
        create_reception(_dto(receivedDate="2026-08-11", receptionNo="5/07"))
    assert e.value.status_code == 400
    assert "miesi" in str(e.value.detail).lower()
