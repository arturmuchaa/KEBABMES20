"""Numeracja HDI — numer raz nadany jest spalony, start da się ustawić.

HDI to papier, który jedzie z towarem. Numer liczony jako `MAX(seq)+1`
wracał po skasowaniu dokumentu, więc dwa różne transporty mogły dostać ten
sam numer. Osobno: część miesiąca bywa wystawiona poza systemem i biuro musi
móc powiedzieć „kolejny ma być 11".

Testy DB — bez TEST_DATABASE_URL skip."""
import pytest

from app.db import execute, query_one, transaction
from app.services.hdi_service import _next_hdi_seq, format_hdi_number


def _hdi(hid, seq, ym="2608"):
    execute(
        "INSERT INTO hdi_documents (id, number, seq, year_month, order_id, "
        " client_name, language, status, incomplete, header, items, totals, "
        " issue_date, created_at) "
        "VALUES (%s,%s,%s,%s,'o1','BULLI','pl','wstepny',false,'{}'::jsonb,"
        " '[]'::jsonb,'{}'::jsonb,'26.08.2026',now())",
        (hid, format_hdi_number(seq, ym), seq, ym),
    )


def _kolejny(ym="2608"):
    with transaction() as conn:
        return _next_hdi_seq(conn, ym)


def test_pierwszy_dokument_w_miesiacu_ma_numer_jeden(db):
    assert _kolejny() == 1


def test_kolejny_po_istniejacym(db):
    _hdi("h1", 5)

    assert _kolejny() == 6


def test_numer_nie_wraca_po_usunieciu_dokumentu(db):
    """Papier z tym numerem już pojechał — nie wolno go wydać drugi raz."""
    pierwszy = _kolejny()
    _hdi("h1", pierwszy)
    execute("DELETE FROM hdi_documents WHERE id='h1'")

    assert _kolejny() == pierwszy + 1


def test_biuro_moze_ustawic_numer_startowy(db):
    """Sierpień do dziesiątki wystawiony poza systemem — kolejny ma być 11."""
    execute("INSERT INTO sequences (key, value) VALUES ('hdi_seq:2608', 10) "
            "ON CONFLICT (key) DO UPDATE SET value=10")

    assert format_hdi_number(_kolejny(), "2608") == "11/08/26"


def test_licznik_jest_per_miesiac(db):
    _hdi("h1", 7, ym="2607")

    assert _kolejny("2608") == 1


def test_licznik_zapamietuje_wydany_numer(db):
    _kolejny()
    _kolejny()

    assert int(query_one("SELECT value FROM sequences WHERE key='hdi_seq:2608'")["value"]) == 2


# ── Zamówienie zrealizowane: dokument zamrożony ───────────────────────────

def _zamowienie(oid="o1", status="confirmed"):
    execute("INSERT INTO clients (id, code, name) VALUES ('c1','BULLI','Bulli') "
            "ON CONFLICT (id) DO NOTHING")
    execute(
        "INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, status) "
        "VALUES (%s,'BULLI/Z/1/08/26','c1','Bulli','2026-08-26',%s)", (oid, status))


def _hdi_zam(hid="h1", oid="o1", seq=11, qty=477, kg=12920):
    import json
    execute(
        "INSERT INTO hdi_documents (id, number, seq, year_month, order_id, client_name, "
        " language, status, incomplete, header, items, totals, issue_date, created_at) "
        "VALUES (%s,%s,%s,'2608',%s,'BULLI','pl','wstepny',false,'{}'::jsonb,'[]'::jsonb,"
        " %s::jsonb,'27.08.2026',now())",
        (hid, format_hdi_number(seq, "2608"), seq, oid, json.dumps({"qty": qty, "kg": kg})),
    )


def test_zrealizowane_zamowienie_nie_przelicza_hdi(db):
    """Dokument pojechał już z towarem — kolejne kliknięcie „Generuj" nie może
    go przepisać (biuro, 27.08.2026: HDI spadło z 12 920 na 5 220 kg)."""
    from app.services.hdi_service import generate_hdi
    _zamowienie(status="done")
    _hdi_zam()

    out = generate_hdi("o1")

    assert out["number"] == "11/08/26"
    assert out["totals"] == {"qty": 477, "kg": 12920}
    assert out.get("frozen") is True


def test_zrealizowane_zamowienie_bez_hdi_nie_wystawia_nowego(db):
    from fastapi import HTTPException

    from app.services.hdi_service import generate_hdi
    _zamowienie(status="done")

    with pytest.raises(HTTPException) as e:
        generate_hdi("o1")
    assert e.value.status_code == 400


def test_zamowienie_w_toku_dalej_odswieza_dokument(db):
    """Dopóki zamówienie żyje, HDI ma pokazywać stan faktyczny."""
    from fastapi import HTTPException

    from app.services.hdi_service import generate_hdi
    _zamowienie(status="confirmed")

    # Brak produkcji i zapasu → build_hdi protestuje, ale NIE zamrożeniem.
    with pytest.raises(HTTPException) as e:
        generate_hdi("o1")
    assert e.value.status_code == 400
    assert "zrealizowane" not in (e.value.detail or "").lower()
