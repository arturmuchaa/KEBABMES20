"""Dokument WZ na POJEMNIKI: numeracja, księgowanie, saldo, anulowanie."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one, transaction
from app.services.container_docs_service import cancel_doc, create_doc, get_doc, list_docs
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
