"""Opis wypalany nad skanem HDI.

Zastępuje to, co dotąd pisano długopisem w rogu dokumentu. Od 20.08.2026
mówi też, KTÓRE pozycje HDI weszły do którego numeru porządkowego — dostawa
bywa rozbita na dwa albo trzy stosy i bez tego ze skanu nie da się odczytać,
gdzie trafiła pozycja 4.

Czysta logika — bez bazy i bez plików.
"""
from app.services.hdi_scan_render import caption_for


def _partia(nr, kg, pozycje=(), status="active"):
    return {
        "internal_batch_no": nr, "kg_received": kg, "status": status,
        "supplier_batches": [{"seq": s} for s in pozycje],
    }


def test_bez_pozycji_hdi_opis_jak_dotad():
    opis = caption_for("14/08", [_partia("475", 4605), _partia("476", 5400)])
    assert opis == "Przyjęcie 14/08 — nr porządkowy 475: 4605 kg, 476: 5400 kg"


def test_pozycje_ciagle_skracaja_sie_do_zakresu():
    opis = caption_for("28/08", [
        _partia("493", 4800, pozycje=(1, 2, 3)),
        _partia("494", 4200, pozycje=(4, 5)),
    ])
    assert "493: 4800 kg (poz. 1-3)" in opis
    assert "494: 4200 kg (poz. 4-5)" in opis


def test_pozycje_rozrzucone_wypisane_po_przecinku():
    """Podział jest DOWOLNY — pozycja 1 może iść z 5 i 6, a 2-4 osobno."""
    opis = caption_for("29/08", [
        _partia("497", 3000, pozycje=(1, 5, 6)),
        _partia("498", 2000, pozycje=(2, 3, 4)),
    ])
    assert "497: 3000 kg (poz. 1, 5-6)" in opis
    assert "498: 2000 kg (poz. 2-4)" in opis


def test_pojedyncza_pozycja_bez_myslnika():
    opis = caption_for("30/08", [_partia("499", 1800, pozycje=(7,))])
    assert "499: 1800 kg (poz. 7)" in opis


def test_anulowana_partia_nie_wchodzi_do_opisu():
    opis = caption_for("31/08", [
        _partia("500", 4000, pozycje=(1,)),
        _partia("501", 1000, pozycje=(2,), status="cancelled"),
    ])
    assert "500" in opis and "501" not in opis
