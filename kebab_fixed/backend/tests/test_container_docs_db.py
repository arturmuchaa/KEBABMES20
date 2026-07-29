"""Dokument WZ na POJEMNIKI: numeracja, księgowanie, saldo, anulowanie."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one, transaction
from app.services.container_docs_service import (
    cancel_doc, create_doc, get_doc, list_docs, partner_deliveries, settle_doc,
)
from app.services.container_ledger_service import book_assets, partner_balance_cx
from app.utils.ids import cuid, now_iso


def _partner(name="KOKO", nip="5130064478") -> str:
    pid = cuid()
    execute("INSERT INTO container_partners (id, nip, name, created_at) VALUES (%s,%s,%s,%s)",
            (pid, nip or None, name, now_iso()))
    return pid


def _lines(e2_in=0, e2_out=0, h1_in=0, h1_out=0, other_in=0, other_out=0):
    return [
        {"assetType": "e2", "inQty": e2_in, "outQty": e2_out},
        {"assetType": "pallet_h1", "inQty": h1_in, "outQty": h1_out},
        {"assetType": "pallet_other", "inQty": other_in, "outQty": other_out},
    ]


def test_wydanie_domyka_dostawe_do_zera(db):
    pid = _partner()
    with transaction() as conn:  # dostawa: 400 pojemników + 10 palet przyjechało do nas
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb1",
                    targets={"e2": 400, "pallet_h1": 10}, movement_date="2026-07-28")
    doc = create_doc(partner_id=pid, doc_date="2026-07-29", driver="Jan Kowalski",
                     vehicle="KR 12345", lines=_lines(e2_out=400, h1_out=10))
    assert doc["balanceAfter"] == {"e2": 0, "pallet_h1": 0, "pallet_other": 0}
    with transaction() as conn:
        assert partner_balance_cx(conn, pid)["e2"] == 0


def test_numeracja_rosnie_w_obrebie_miesiaca(db):
    pid = _partner()
    a = create_doc(partner_id=pid, doc_date="2026-07-29", lines=_lines(e2_out=1))
    b = create_doc(partner_id=pid, doc_date="2026-07-30", lines=_lines(e2_out=1))
    assert a["number"].startswith("POJ/1/")
    assert b["number"].startswith("POJ/2/")


def test_saldo_na_dokumencie_jest_ZAMROZONE_w_chwili_wystawienia(db):
    pid = _partner()
    doc = create_doc(partner_id=pid, doc_date="2026-07-29", lines=_lines(e2_in=100))
    assert doc["balanceAfter"]["e2"] == 100
    with transaction() as conn:  # późniejszy ruch nie może zmienić wydruku
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb9",
                    targets={"e2": 500}, movement_date="2026-07-31")
    assert get_doc(doc["id"])["balanceAfter"]["e2"] == 100


def test_dostawa_i_zwrot_na_jednym_dokumencie(db):
    pid = _partner()
    doc = create_doc(partner_id=pid, doc_date="2026-07-29", lines=_lines(e2_in=400, e2_out=380))
    assert doc["balanceAfter"]["e2"] == 20
    line = next(l for l in doc["lines"] if l["assetType"] == "e2")
    assert (line["inQty"], line["outQty"], line["balance"]) == (400, 380, 20)


def test_anulowanie_zeruje_ruchy_ale_zostawia_dokument(db):
    pid = _partner()
    doc = create_doc(partner_id=pid, doc_date="2026-07-29", lines=_lines(e2_out=400))
    cancel_doc(doc["id"])
    with transaction() as conn:
        assert partner_balance_cx(conn, pid)["e2"] == 0
    after = get_doc(doc["id"])
    assert after["status"] == "anulowany"
    assert query_one("SELECT COUNT(*) AS n FROM container_docs")["n"] == 1


def test_ponowne_anulowanie_odrzucone(db):
    pid = _partner()
    doc = create_doc(partner_id=pid, doc_date="2026-07-29", lines=_lines(e2_out=5))
    cancel_doc(doc["id"])
    with pytest.raises(HTTPException) as e:
        cancel_doc(doc["id"])
    assert e.value.status_code == 409


def test_dokument_bez_zadnej_ilosci_odrzucony(db):
    pid = _partner()
    with pytest.raises(HTTPException) as e:
        create_doc(partner_id=pid, doc_date="2026-07-29", lines=_lines())
    assert e.value.status_code == 400


def test_partner_z_kartoteki_dostawcow(db):
    execute("INSERT INTO suppliers (id, code, name, nip, active, created_at) "
            "VALUES ('sup1','SUP1','KOKO','5130064478',true,%s)", (now_iso(),))
    doc = create_doc(ref_type="supplier", ref_id="sup1", doc_date="2026-07-29",
                     lines=_lines(e2_out=100))
    assert doc["partner"]["nip"] == "5130064478"
    assert query_one("SELECT COUNT(*) AS n FROM container_partners")["n"] == 1


def test_lista_dokumentow_partnera(db):
    pid = _partner()
    create_doc(partner_id=pid, doc_date="2026-07-29", lines=_lines(e2_out=1))
    create_doc(partner_id=pid, doc_date="2026-07-30", lines=_lines(e2_out=2))
    assert len(list_docs(pid)) == 2


# ── Powiązanie dokumentu z konkretną dostawą (2026-07-29) ────────────
# Przyjęcie surowca JUŻ księguje nośniki na saldzie. Dokument powiązany
# z dostawą pokazuje jej liczby na papierze („600 dostawa / 600 zwrot"),
# ale księguje WYŁĄCZNIE zwrot — inaczej jedna fizyczna dostawa 600 sztuk
# podbiłaby saldo o 1200.
def _delivery(pid, source_id="rb1", e2=600, h1=13):
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id=source_id,
                    targets={"e2": e2, "pallet_h1": h1}, movement_date="2026-07-29",
                    note="Przyjęcie 900")


def test_dokument_powiazany_ksieguje_TYLKO_zwrot(db):
    pid = _partner()
    _delivery(pid)                       # saldo: +600 / +13
    doc = create_doc(partner_id=pid, doc_date="2026-07-30",
                     linked_source_type="raw_batch", linked_source_id="rb1",
                     lines=_lines(e2_in=600, e2_out=600, h1_in=13, h1_out=13))
    # gdyby kolumna "dostawa" też księgowała, wyszłoby +600/+13
    assert doc["balanceAfter"] == {"e2": 0, "pallet_h1": 0, "pallet_other": 0}
    with transaction() as conn:
        assert partner_balance_cx(conn, pid)["e2"] == 0


def test_powiazany_dokument_zachowuje_liczby_dostawy_na_druku(db):
    pid = _partner()
    _delivery(pid)
    doc = create_doc(partner_id=pid, doc_date="2026-07-30",
                     linked_source_type="raw_batch", linked_source_id="rb1",
                     lines=_lines(e2_in=600, e2_out=600, h1_in=13, h1_out=13))
    line = next(l for l in doc["lines"] if l["assetType"] == "e2")
    assert (line["inQty"], line["outQty"]) == (600, 600), "druk musi pokazać obie kolumny"
    assert doc["linkedSourceId"] == "rb1"


def test_zwrot_czesciowy_z_powiazaniem_zostawia_reszte(db):
    pid = _partner()
    _delivery(pid)
    doc = create_doc(partner_id=pid, doc_date="2026-07-30",
                     linked_source_type="raw_batch", linked_source_id="rb1",
                     lines=_lines(e2_in=600, e2_out=400, h1_in=13, h1_out=13))
    assert doc["balanceAfter"]["e2"] == 200
    assert doc["balanceAfter"]["pallet_h1"] == 0


def test_dokument_BEZ_powiazania_ksieguje_obie_kolumny(db):
    """Regresja: nośniki przywiezione poza dostawą towaru (puste pojemniki
    podrzucone do napełnienia) nadal muszą wchodzić na saldo."""
    pid = _partner()
    doc = create_doc(partner_id=pid, doc_date="2026-07-30",
                     lines=_lines(e2_in=600, e2_out=400))
    assert doc["balanceAfter"]["e2"] == 200


def test_anulowanie_powiazanego_dokumentu_cofa_tylko_zwrot(db):
    pid = _partner()
    _delivery(pid)
    doc = create_doc(partner_id=pid, doc_date="2026-07-30",
                     linked_source_type="raw_batch", linked_source_id="rb1",
                     lines=_lines(e2_in=600, e2_out=600, h1_in=13, h1_out=13))
    cancel_doc(doc["id"])
    with transaction() as conn:
        # wraca do stanu po samej dostawie, nie do zera i nie do 1200
        assert partner_balance_cx(conn, pid) == {"e2": 600, "pallet_h1": 13, "pallet_other": 0}


def test_lista_dostaw_do_rozliczenia(db):
    pid = _partner()
    _delivery(pid, "rb1", e2=600, h1=13)
    _delivery(pid, "rb2", e2=200, h1=4)
    rows = partner_deliveries(pid)
    assert [r["sourceId"] for r in rows] == ["rb2", "rb1"] or \
           [r["sourceId"] for r in rows] == ["rb1", "rb2"]
    r1 = next(r for r in rows if r["sourceId"] == "rb1")
    assert r1["assets"] == {"e2": 600, "pallet_h1": 13, "pallet_other": 0}
    assert r1["settled"] is False

    create_doc(partner_id=pid, doc_date="2026-07-30",
               linked_source_type="raw_batch", linked_source_id="rb1",
               lines=_lines(e2_in=600, e2_out=600, h1_in=13, h1_out=13))
    r1b = next(r for r in partner_deliveries(pid) if r["sourceId"] == "rb1")
    assert r1b["settled"] is True, "dostawa z wystawionym dokumentem jest oznaczona"


# ── Dwufazowy zwrot: druk z pustą kolumną, zwrot wpisany po powrocie ──
# Odbiorca (WZ) to LUSTRO dostawcy (przyjęcie): nasze pojemniki jadą do
# niego (−225), więc jego zwrot ma znak DODATNI. Znak zwrotu jest zawsze
# przeciwny do tego, co zaksięgowało źródło.
def _wz_out(pid, source_id="wz1", e2=225, h1=7):
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="wz", source_id=source_id,
                    targets={"e2": -e2, "pallet_h1": -h1}, movement_date="2026-07-29",
                    note="WZ WZ/41/07/26")


def test_druk_dla_odbiorcy_ma_pusta_kolumne_zwrotu(db):
    pid = _partner()
    _wz_out(pid)                                  # saldo: -225 / -7
    doc = create_doc(partner_id=pid, doc_date="2026-07-29",
                     linked_source_type="wz", linked_source_id="wz1",
                     pending_return=True,
                     lines=_lines(e2_in=225, h1_in=7))
    assert doc["status"] == "oczekuje"
    e2 = next(l for l in doc["lines"] if l["assetType"] == "e2")
    assert (e2["inQty"], e2["outQty"]) == (225, 0), "zwrot pusty — wypełnia go odbiorca"
    with transaction() as conn:  # samo wystawienie druku nie rusza salda
        assert partner_balance_cx(conn, pid) == {"e2": -225, "pallet_h1": -7, "pallet_other": 0}


def test_zwrot_odbiorcy_ma_znak_DODATNI(db):
    pid = _partner()
    _wz_out(pid)
    doc = create_doc(partner_id=pid, doc_date="2026-07-29",
                     linked_source_type="wz", linked_source_id="wz1",
                     pending_return=True, lines=_lines(e2_in=225, h1_in=7))
    settle_doc(doc["id"], {"e2": 225, "pallet_h1": 7})
    with transaction() as conn:
        # oddali wszystko → saldo zeruje się (a NIE schodzi do -450)
        assert partner_balance_cx(conn, pid) == {"e2": 0, "pallet_h1": 0, "pallet_other": 0}


def test_zwrot_czesciowy_zamyka_dokument_reszta_na_saldzie(db):
    pid = _partner()
    _wz_out(pid)
    doc = create_doc(partner_id=pid, doc_date="2026-07-29",
                     linked_source_type="wz", linked_source_id="wz1",
                     pending_return=True, lines=_lines(e2_in=225, h1_in=7))
    after = settle_doc(doc["id"], {"e2": 100, "pallet_h1": 7})
    assert after["status"] == "rozliczony"
    with transaction() as conn:
        assert partner_balance_cx(conn, pid)["e2"] == -125, "reszta zostaje na saldzie"


def test_zwrot_zerowy_tez_zamyka_dokument(db):
    pid = _partner()
    _wz_out(pid)
    doc = create_doc(partner_id=pid, doc_date="2026-07-29",
                     linked_source_type="wz", linked_source_id="wz1",
                     pending_return=True, lines=_lines(e2_in=225, h1_in=7))
    after = settle_doc(doc["id"], {"e2": 0, "pallet_h1": 0})
    assert after["status"] == "rozliczony"
    with transaction() as conn:
        assert partner_balance_cx(conn, pid)["e2"] == -225, "nic nie oddali — saldo bez zmian"


def test_zwrot_u_DOSTAWCY_ma_znak_UJEMNY(db):
    """Lustro: dostawa przyjęciem (+600), więc zwrot musi odejmować."""
    pid = _partner()
    _delivery(pid, "rb1", e2=600, h1=13)
    doc = create_doc(partner_id=pid, doc_date="2026-07-30",
                     linked_source_type="raw_batch", linked_source_id="rb1",
                     pending_return=True, lines=_lines(e2_in=600, h1_in=13))
    settle_doc(doc["id"], {"e2": 600, "pallet_h1": 13})
    with transaction() as conn:
        assert partner_balance_cx(conn, pid) == {"e2": 0, "pallet_h1": 0, "pallet_other": 0}


def test_nie_da_sie_rozliczyc_dwa_razy(db):
    pid = _partner()
    _wz_out(pid)
    doc = create_doc(partner_id=pid, doc_date="2026-07-29",
                     linked_source_type="wz", linked_source_id="wz1",
                     pending_return=True, lines=_lines(e2_in=225, h1_in=7))
    settle_doc(doc["id"], {"e2": 225})
    with pytest.raises(HTTPException) as e:
        settle_doc(doc["id"], {"e2": 225})
    assert e.value.status_code == 409
