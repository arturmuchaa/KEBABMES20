"""Księga nośników: znak, księgowanie różnicowe, saldo, wyciąg za okres."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one, transaction
from app.services.container_ledger_service import (
    movements,
    balances,
    book_assets,
    book_target,
    correct_group,
    create_manual_movement,
    partner_balance_cx,
    pending_groups,
    statement,
)
from app.utils.ids import cuid, now_iso


def _partner(name="KOKO", nip="5130064478") -> str:
    pid = cuid()
    execute("INSERT INTO container_partners (id, nip, name, created_at) VALUES (%s,%s,%s,%s)",
            (pid, nip or None, name, now_iso()))
    return pid


# ── book_target: różnicowo i idempotentnie ───────────────────────────
def test_pierwsze_ksiegowanie_dopisuje_pelna_wartosc(db):
    pid = _partner()
    with transaction() as conn:
        delta = book_target(conn, partner_id=pid, asset_type="e2", source_type="raw_batch",
                            source_id="rb1", target_qty=400, movement_date="2026-07-29")
    assert delta == 400
    assert query_one("SELECT COUNT(*) AS n FROM container_movements")["n"] == 1


def test_powtorne_ksiegowanie_tej_samej_wartosci_nic_nie_dopisuje(db):
    pid = _partner()
    with transaction() as conn:
        book_target(conn, partner_id=pid, asset_type="e2", source_type="raw_batch",
                    source_id="rb1", target_qty=400, movement_date="2026-07-29")
        delta = book_target(conn, partner_id=pid, asset_type="e2", source_type="raw_batch",
                            source_id="rb1", target_qty=400, movement_date="2026-07-29")
    assert delta == 0
    assert query_one("SELECT COUNT(*) AS n FROM container_movements")["n"] == 1


def test_korekta_dopisuje_roznice_i_NIE_rusza_starego_wiersza(db):
    pid = _partner()
    with transaction() as conn:
        book_target(conn, partner_id=pid, asset_type="e2", source_type="raw_batch",
                    source_id="rb1", target_qty=400, movement_date="2026-07-29")
        delta = book_target(conn, partner_id=pid, asset_type="e2", source_type="raw_batch",
                            source_id="rb1", target_qty=380, movement_date="2026-07-30")
    assert delta == -20
    rows = query_all("SELECT qty FROM container_movements ORDER BY created_at, qty DESC")
    assert [int(r["qty"]) for r in rows] == [400, -20], "historia musi zostać w całości"
    assert query_one("SELECT COALESCE(SUM(qty),0) AS s FROM container_movements")["s"] == 380


def test_wyzerowanie_zrodla_domyka_saldo_do_zera(db):
    pid = _partner()
    with transaction() as conn:
        book_target(conn, partner_id=pid, asset_type="e2", source_type="wz",
                    source_id="wz1", target_qty=-100, movement_date="2026-07-29")
        book_target(conn, partner_id=pid, asset_type="e2", source_type="wz",
                    source_id="wz1", target_qty=0, movement_date="2026-07-29")
        assert partner_balance_cx(conn, pid)["e2"] == 0


def test_nieznany_nosnik_odrzucony(db):
    pid = _partner()
    with pytest.raises(HTTPException) as e:
        with transaction() as conn:
            book_target(conn, partner_id=pid, asset_type="skrzynka", source_type="manual",
                        source_id=None, target_qty=1, movement_date="2026-07-29")
    assert e.value.status_code == 400


def test_zrodla_nie_mieszaja_sie_ze_soba(db):
    pid = _partner()
    with transaction() as conn:
        book_target(conn, partner_id=pid, asset_type="e2", source_type="raw_batch",
                    source_id="rb1", target_qty=400, movement_date="2026-07-29")
        delta = book_target(conn, partner_id=pid, asset_type="e2", source_type="raw_batch",
                            source_id="rb2", target_qty=100, movement_date="2026-07-29")
    assert delta == 100, "drugie przyjęcie liczy się od zera, nie od salda rb1"
    with transaction() as conn:
        assert partner_balance_cx(conn, pid)["e2"] == 500


# ── Znak i saldo ─────────────────────────────────────────────────────
def test_dostawa_plus_zwrot_daje_zero(db):
    pid = _partner()
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb1",
                    targets={"e2": 400, "pallet_h1": 10}, movement_date="2026-07-29")
        book_assets(conn, partner_id=pid, source_type="container_doc", source_id="doc1",
                    targets={"e2": -400, "pallet_h1": -10}, movement_date="2026-07-30",
                    confirmed=True)
        bal = partner_balance_cx(conn, pid)
    assert bal == {"e2": 0, "pallet_h1": 0, "pallet_other": 0}


def test_book_assets_traktuje_brakujacy_klucz_jak_zero(db):
    pid = _partner()
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb1",
                    targets={"e2": 400}, movement_date="2026-07-29")
        assert partner_balance_cx(conn, pid) == {"e2": 400, "pallet_h1": 0, "pallet_other": 0}


def test_balances_nie_zwielokrotnia_sum_przy_wielu_rolach(db):
    pid = _partner()
    execute("INSERT INTO container_partner_links (partner_id, ref_type, ref_id) "
            "VALUES (%s,'supplier','s1'), (%s,'client','c1')", (pid, pid))
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb1",
                    targets={"e2": 400}, movement_date="2026-07-29")
    rows = balances()
    assert len(rows) == 1
    assert rows[0]["e2"] == 400, "JOIN po rolach nie może podwoić sumy"
    assert sorted(rows[0]["roles"]) == ["client", "supplier"]


def test_balances_nonzero_pomija_rozliczonych(db):
    pid = _partner()
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb1",
                    targets={"e2": 400}, movement_date="2026-07-29")
        book_assets(conn, partner_id=pid, source_type="container_doc", source_id="d1",
                    targets={"e2": -400}, movement_date="2026-07-30")
    assert balances(nonzero=True) == []
    assert len(balances()) == 1


# ── Do rozliczenia: grupy i korekta z biura ──────────────────────────
def test_pending_groups_pokazuje_tylko_niepotwierdzone(db):
    pid = _partner()
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="wz", source_id="wz1",
                    targets={"e2": -60}, movement_date="2026-07-29")
        book_assets(conn, partner_id=pid, source_type="container_doc", source_id="d1",
                    targets={"e2": 60}, movement_date="2026-07-30", confirmed=True)
    groups = pending_groups(pid)
    assert len(groups) == 1
    assert groups[0]["sourceType"] == "wz"
    assert groups[0]["assets"]["e2"] == -60


def test_correct_group_koryguje_i_potwierdza(db):
    pid = _partner()
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="wz", source_id="wz1",
                    targets={"e2": -60}, movement_date="2026-07-29")
    correct_group(pid, "wz", "wz1", {"e2": -58, "pallet_h1": -2}, confirm=True)
    with transaction() as conn:
        assert partner_balance_cx(conn, pid) == {"e2": -58, "pallet_h1": -2, "pallet_other": 0}
    assert pending_groups(pid) == []
    assert query_one("SELECT COUNT(*) AS n FROM container_movements WHERE asset_type='e2'")["n"] == 2


def test_reczny_ruch_ze_znakiem(db):
    pid = _partner()
    create_manual_movement(pid, "e2", -25, "2026-07-29", "zwrot kierowcy bez dokumentu")
    with transaction() as conn:
        assert partner_balance_cx(conn, pid)["e2"] == -25


# ── Wyciąg za okres ──────────────────────────────────────────────────
def test_statement_saldo_otwarcia_plus_ruchy_rowna_sie_zamknieciu(db):
    pid = _partner()
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb0",
                    targets={"e2": 100}, movement_date="2026-06-30")   # przed oknem
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb1",
                    targets={"e2": 400}, movement_date="2026-07-10")
        book_assets(conn, partner_id=pid, source_type="container_doc", source_id="d1",
                    targets={"e2": -350}, movement_date="2026-07-20")
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb2",
                    targets={"e2": 70}, movement_date="2026-08-05")    # po oknie
    st = statement(pid, "2026-07-01", "2026-07-31")
    assert st["opening"]["e2"] == 100
    assert st["closing"]["e2"] == 150
    assert len(st["movements"]) == 2
    assert [m["balanceAfter"]["e2"] for m in st["movements"]] == [500, 150]


def test_odwrocone_zrodlo_znika_z_historii_ale_zostaje_w_bazie(db):
    """Anulowany WZ zostawia parę −225/+225. Do salda nie wnosi nic, więc
    kartoteka jej nie pokazuje — ale wiersze ZOSTAJĄ (ślad audytowy)."""
    pid = _partner()
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="wz", source_id="wz1",
                    targets={"e2": -225}, movement_date="2026-07-29")
        book_assets(conn, partner_id=pid, source_type="wz", source_id="wz1",
                    targets={}, movement_date="2026-07-29")          # anulowanie
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb1",
                    targets={"e2": 100}, movement_date="2026-07-30")  # żywy ruch
    widoczne = movements(pid)
    assert [m["qty"] for m in widoczne] == [100], "para z anulowanego WZ ukryta"
    wszystkie = movements(pid, include_reversed=True)
    assert sorted(m["qty"] for m in wszystkie) == [-225, 100, 225]
    assert query_one("SELECT COUNT(*) AS n FROM container_movements")["n"] == 3
