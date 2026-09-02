"""Hash podpisanej treści — serce wiarygodności podpisu elektronicznego.

Zmiana danych po podpisaniu MUSI zmienić hash, inaczej „podpis" jest
obrazkiem, który da się przykleić do dowolnej treści.
Test czysty — bez bazy, uruchamia się zawsze."""
from decimal import Decimal

from app.services.signature_hash import canonical_payload, content_hash

REC = {"reception_no": "7/08", "supplier_name": "KOKO",
       "received_date": "2026-08-14", "kg_total": 10000}
CHK = {"visual": "bz", "temp_chamber": 2.5, "temp_meat": 3.1,
       "kg_match": "bz", "notes": "", "verdict": "K",
       "nc_description": "", "nc_action": "", "nc_at": None}


def test_ten_sam_wpis_daje_ten_sam_hash():
    assert content_hash(REC, CHK) == content_hash(dict(REC), dict(CHK))


def test_kolejnosc_kluczy_nie_zmienia_hasha():
    odwrocony = dict(reversed(list(CHK.items())))
    assert content_hash(REC, odwrocony) == content_hash(REC, CHK)


def test_zmiana_temperatury_o_dziesiata_zmienia_hash():
    inny = {**CHK, "temp_meat": 3.2}
    assert content_hash(REC, inny) != content_hash(REC, CHK)


def test_rowne_liczby_w_roznych_zapisach_daja_ten_sam_hash():
    """2.5, '2.50' i Decimal('2.5') to ten sam pomiar. Bez normalizacji
    hash zmieniałby się sam z siebie przy każdym przejściu danych przez
    JSON i unieważniał poprawne podpisy."""
    a = content_hash(REC, {**CHK, "temp_chamber": 2.5})
    b = content_hash(REC, {**CHK, "temp_chamber": "2.50"})
    c = content_hash(REC, {**CHK, "temp_chamber": Decimal("2.5")})
    assert a == b == c


def test_brak_pomiaru_rozni_sie_od_zera():
    """„Nie zmierzono" i „zmierzono 0 °C" to dwa różne zdarzenia."""
    assert content_hash(REC, {**CHK, "temp_meat": None}) \
        != content_hash(REC, {**CHK, "temp_meat": 0})


def test_zmiana_dostawy_tez_zmienia_hash():
    """Podpis wisi pod CAŁYM wierszem karty, nie samą kontrolą — korekta
    kilogramów też musi go unieważnić."""
    assert content_hash({**REC, "kg_total": 9000}, CHK) != content_hash(REC, CHK)


def test_zmiana_oceny_zmienia_hash():
    assert content_hash(REC, {**CHK, "verdict": "N"}) != content_hash(REC, CHK)


def test_kanoniczna_tresc_jest_czytelna():
    """Ma dać się obejrzeć okiem przy sporze — to nie jest pickle."""
    tekst = canonical_payload(REC, CHK)
    assert "reception_no=7/08" in tekst
    assert "temp_meat=3.1" in tekst
