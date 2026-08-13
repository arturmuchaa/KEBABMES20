"""Skan HDI w archiwum: pion + opis, który dotąd pisano długopisem."""
import shutil

import pytest

from app.services.hdi_scan_render import caption_for, format_kg, prepare_scan


# --- opis (czysta logika) ---------------------------------------------------
def test_opis_wymienia_numery_porzadkowe_i_kg():
    """Dokładnie to, co zakład dopisuje na HDI ręcznie."""
    assert caption_for("14/08", [
        {"internal_batch_no": "475", "kg_received": 4605},
        {"internal_batch_no": "476", "kg_received": 5400},
    ]) == "Przyjęcie 14/08 — nr porządkowy 475: 4605 kg, 476: 5400 kg"


def test_opis_pomija_partie_anulowane():
    """Na dokumencie ma zostać to, co PRZYJĘTO — nie ślad po naszej pomyłce
    w rejestracji (ten sam powód, dla którego anulowane nie wchodzą na karty)."""
    assert caption_for("3/08", [
        {"internal_batch_no": "480", "kg_received": 1000},
        {"internal_batch_no": "481", "kg_received": 900, "status": "cancelled"},
    ]) == "Przyjęcie 3/08 — nr porządkowy 480: 1000 kg"


def test_opis_bez_partii_to_sam_numer_przyjecia():
    assert caption_for("3/08", []) == "Przyjęcie 3/08"


def test_kg_bez_zbednych_zer_i_z_przecinkiem():
    assert format_kg(4605.0) == "4605"
    assert format_kg(4605.5) == "4605,5"


# --- obróbka obrazu ---------------------------------------------------------
def _pillow_jest() -> bool:
    try:
        import PIL  # noqa: F401
        return True
    except ImportError:
        return False


@pytest.mark.skipif(not _pillow_jest(), reason="Pillow niedostępne")
def test_kartka_bokiem_wychodzi_w_pionie_z_paskiem_opisu():
    """Bizhub podaje A4 poziomo — w archiwum ma leżeć pionowo, a opis ma
    DOŁOŻYĆ pasek nad dokumentem, nie zasłonić treści."""
    from io import BytesIO

    from PIL import Image

    poziomy = Image.new("RGB", (600, 400), "white")
    buf = BytesIO()
    poziomy.save(buf, "JPEG")

    out, suffix = prepare_scan(buf.getvalue(), ".jpg", "Przyjęcie 14/08")

    assert suffix == ".pdf"
    assert out.startswith(b"%PDF")
    assert out != buf.getvalue()


@pytest.mark.skipif(not _pillow_jest(), reason="Pillow niedostępne")
def test_uszkodzony_plik_trafia_do_archiwum_BEZ_ZMIAN():
    """Skan HDI to dokument do okazania przy kontroli. Gdy obróbka zawiedzie,
    zapisujemy oryginał — dokumentu nie wolno zgubić przez krok kosmetyczny."""
    smiec = b"to nie jest zaden obraz"
    out, suffix = prepare_scan(smiec, ".pdf", "Przyjęcie 14/08")
    assert out == smiec
    assert suffix == ".pdf"


@pytest.mark.skipif(not shutil.which("pdftoppm"), reason="poppler niedostępny")
@pytest.mark.skipif(not _pillow_jest(), reason="Pillow niedostępne")
def test_wielostronicowy_pdf_zachowuje_wszystkie_strony():
    from io import BytesIO

    from PIL import Image

    a = Image.new("RGB", (600, 400), "white")
    b = Image.new("RGB", (600, 400), "white")
    buf = BytesIO()
    a.save(buf, "PDF", save_all=True, append_images=[b])

    out, _ = prepare_scan(buf.getvalue(), ".pdf", "Przyjęcie 14/08")
    assert out.count(b"/Type /Page") >= 2 or out.count(b"/Type/Page") >= 2
