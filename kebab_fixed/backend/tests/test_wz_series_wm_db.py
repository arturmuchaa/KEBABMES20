# backend/tests/test_wz_series_wm_db.py
"""Seria WM — WZ wewnętrzny, którego klient nie dostaje.

Właściciel (2026-09-09) wybrał OSOBNĄ serię: seria WZ zostaje wyłącznie dla
dokumentów wychodzących do klientów.
"""
from app.db import query_all, query_one
from app.services.wz_service import format_wz_number


def test_numer_wm_ma_wlasny_prefiks():
    assert format_wz_number(7, "2609", series="WM") == "WM/7/09/26"


def test_numer_wz_bez_zmian():
    assert format_wz_number(7, "2609") == "WZ/7/09/26"


def _wstaw(conn, series="WZ"):
    from app.services.wz_service import _insert_wz, _seller_block
    return _insert_wz(conn, source_type="manual", source_id=None, seller=_seller_block(),
                      buyer={"name": "KLIENT"}, valued=False, lines=[], total=0.0,
                      place="Rudawa", issued="2026-09-09", released="2026-09-09", notes="",
                      series=series)


def test_serie_licza_sie_niezaleznie(db):
    """WM/1 i WZ/1 mogą istnieć obok siebie — to dwa różne rejestry."""
    from app.db import transaction
    with transaction() as conn:
        wz = _wstaw(conn, "WZ")
        wm = _wstaw(conn, "WM")
    numery = {r["id"]: (r["number"], r["doc_series"]) for r in query_all(
        "SELECT id, number, doc_series FROM wz_documents")}
    assert numery[wz][1] == "WZ" and numery[wz][0].startswith("WZ/")
    assert numery[wm][1] == "WM" and numery[wm][0].startswith("WM/")


# ── Fix round 1 (2026-09-09) — review Important: anulowanie WM musi trafić
# do puli WM, nie WZ; next_wz_number musi umieć podpowiedzieć numer WM. ──


def test_anulowany_wm_oddaje_numer_do_puli_wm(db):
    """Anulowany WM wraca do WŁASNEJ puli — kolejny WM go odzyskuje."""
    from app.db import transaction
    from app.services.wz_service import cancel_wz
    with transaction() as conn:
        _wstaw(conn, "WM")               # WM/1
        wm2 = _wstaw(conn, "WM")          # WM/2

    assert query_one("SELECT seq FROM wz_documents WHERE id=%s", (wm2,))["seq"] == 2

    cancel_wz(wm2)

    with transaction() as conn:
        wm3 = _wstaw(conn, "WM")
    po = query_one("SELECT seq, doc_series FROM wz_documents WHERE id=%s", (wm3,))
    assert po["seq"] == 2, "numer 2 wrócił do puli WM — kolejny WM go bierze"
    assert po["doc_series"] == "WM"


def test_anulowanie_wm_nie_rusza_puli_wz(db):
    """Anulowanie WM nie oddaje ani nie zajmuje numerów z serii WZ."""
    from app.db import transaction
    from app.services.wz_service import cancel_wz
    with transaction() as conn:
        _wstaw(conn, "WZ")                # WZ/1
        wm1 = _wstaw(conn, "WM")          # WM/1

    cancel_wz(wm1)

    with transaction() as conn:
        wz2 = _wstaw(conn, "WZ")
    po = query_one("SELECT seq, doc_series FROM wz_documents WHERE id=%s", (wz2,))
    assert po["seq"] == 2, "WZ dostaje swój kolejny numer, nie numer zwolniony przez WM"
    assert po["doc_series"] == "WZ"


def test_podpowiedz_numeru_widzi_serie(db):
    """`next_wz_number` z parametrem `series` podpowiada z WŁAŚCIWEGO rejestru."""
    from app.services.wz_service import next_wz_number
    assert next_wz_number(series="WM")["number"].startswith("WM/")
    assert next_wz_number()["number"].startswith("WZ/")


def test_migracja_indeksu_jest_no_opem_przy_powtorce(db):
    """DROP+CREATE indeksu unikatowego nie może się powtarzać na każdym
    starcie — okno bez ochrony unikalności między DROP a CREATE otwierałoby
    się w nieskończoność. Dowód: OID indeksu nie zmienia się po wywołaniu
    migracji drugi raz (DROP+CREATE nadałby NOWY oid)."""
    from app.migrations import _zapewnij_unikat_wz_seria

    przed = query_one("SELECT 'ux_wz_ym_seq'::regclass::oid AS oid")["oid"]

    _zapewnij_unikat_wz_seria()  # baza testowa ma już właściwą definicję

    po = query_one("SELECT 'ux_wz_ym_seq'::regclass::oid AS oid")["oid"]
    assert po == przed, "definicja się nie zmieniła — funkcja miała być no-opem"
