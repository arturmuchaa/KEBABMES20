"""Skan HDI: oryginał zostaje, opis da się odtworzyć.

MES wypala nad skanem opis („Przyjęcie 28/08 — nr porządkowy 493: 4800 kg…"),
bo dotąd biuro dopisywało to długopisem. Problem: opis jest w PLIKU, a numer
dokumentu bywa poprawiany — 19 i 20.08.2026 dwa razy skan mówił co innego niż
system i trzeba było prosić biuro o ponowne skanowanie papieru.

Oryginał sprzed opisania był kasowany zaraz po dopięciu (`take_temp`), więc
nie było z czego odtworzyć. Teraz zostaje obok i opis przelicza się sam.

Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
from app.config import settings
from app.services.hdi_scan_store import find_attached, find_original
from app.services.receptions_service import attach_scan, get_reception, przelicz_opis_skanu
from app.db import execute, query_one
from app.utils.ids import cuid, now_iso

# Najmniejszy poprawny PDF — treść nieistotna, liczy się droga pliku.
PDF = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
       b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
       b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
       b"trailer<</Root 1 0 R>>\n%%EOF\n")


def _przyjecie(rec_id="rec-skan", no="28/08") -> str:
    execute(
        "INSERT INTO receptions (id, reception_no, reception_seq, reception_period, "
        " received_date, supplier_name, document_no, notes, is_service, created_at) "
        "VALUES (%s,%s,28,'2026-08','2026-08-20','KOKO','WZ 1','',false,%s)",
        (rec_id, no, now_iso()))
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, supplier_name, "
        " kg_received, kg_available, status, material_type_id, material_name, reception_id, created_at) "
        "VALUES (%s,'495',495,'KOKO',4830,4830,'active','mat-cwiartka','Ćwiartka z kurczaka',%s,%s)",
        (cuid(), rec_id, now_iso()))
    return rec_id


def test_dopiecie_skanu_zachowuje_oryginal(db):
    rec_id = _przyjecie()
    attach_scan(rec_id, PDF, "hdi.pdf")

    rec = query_one("SELECT hdi_scan FROM receptions WHERE id=%s", (rec_id,))
    assert rec["hdi_scan"], "skan musi być przypięty do dostawy"
    assert find_attached(rec["hdi_scan"]) is not None
    assert find_original(rec_id) is not None, "oryginał sprzed opisania ma zostać"


def test_zmiana_numeru_przelicza_opis_bez_ponownego_skanowania(db):
    rec_id = _przyjecie(no="29/08")
    attach_scan(rec_id, PDF, "hdi.pdf")
    przed = find_attached(query_one(
        "SELECT hdi_scan FROM receptions WHERE id=%s", (rec_id,))["hdi_scan"]).read_bytes()

    # Biuro poprawia numer dokumentu — opis na skanie ma pójść za nim.
    execute("UPDATE receptions SET reception_no='28/08' WHERE id=%s", (rec_id,))
    assert przelicz_opis_skanu(rec_id) is True

    po = find_attached(query_one(
        "SELECT hdi_scan FROM receptions WHERE id=%s", (rec_id,))["hdi_scan"]).read_bytes()
    assert po != przed, "plik skanu musi zostać odtworzony z nowym opisem"
    # Oryginał zostaje na kolejne odtworzenie — inaczej druga korekta znów
    # wymagałaby biegania z papierem do skanera.
    assert find_original(rec_id) is not None


def test_bez_oryginalu_nie_udajemy_ze_sie_udalo(db):
    """Dostawy sprzed tej zmiany nie mają oryginału — wtedy trzeba przeskanować
    papier jeszcze raz i funkcja musi to powiedzieć, a nie kłamać sukcesem."""
    rec_id = _przyjecie(no="27/08")
    attach_scan(rec_id, PDF, "hdi.pdf")
    orig = find_original(rec_id)
    orig.unlink()

    assert przelicz_opis_skanu(rec_id) is False
