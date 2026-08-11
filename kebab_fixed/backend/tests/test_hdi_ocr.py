"""Wybór drogi odczytu skanu HDI.

Sam OCR jest I/O i zależy od tesseractu; testujemy DECYZJĘ, która przesądza
o czasie odpowiedzi: czy obraz osadzony w PDF nadaje się do czytania
w natywnej wielkości, czy trzeba go powiększyć rasteryzacją.
"""
from app.services.hdi_ocr_service import MIN_NATIVE_PX, MIN_USEFUL_PX, usable_images


def test_skan_a4_czytamy_w_natywnej_wielkosci():
    # HDI 33656: 1653x2338 px. Rasteryzacja w 300 dpi tylko by go powiększyła
    # (19,2 s zamiast 2,0 s) nie dodając ani jednej informacji.
    assert usable_images([(1653, 2338)]) is True


def test_pdf_bez_obrazow_idzie_w_rasteryzacje():
    """PDF wektorowy — nie ma czego wyjąć."""
    assert usable_images([]) is False


def test_samo_logo_nie_wystarcza():
    """Strona z samą pieczątką/logo: obraz jest, ale nie o to chodzi."""
    assert usable_images([(120, 60), (300, 300)]) is False


def test_zbyt_drobny_skan_lepiej_powiekszyc():
    """Skan w niskiej rozdzielczości (ok. 170 dpi na A4): tesseract czyta go
    lepiej po powiększeniu, więc świadomie płacimy za rasteryzację."""
    assert usable_images([(1000, 1400)]) is False


def test_logo_obok_skanu_nie_psuje_wyboru():
    """Typowy PDF: skan strony + drobne logo. Liczy się ten duży."""
    assert usable_images([(90, 40), (1653, 2338)]) is True


def test_progi_trzymaja_sie_kolejnosci():
    """MIN_USEFUL_PX odsiewa drobiazgi, MIN_NATIVE_PX decyduje o powiększaniu —
    odwrócenie tych progów cicho wyłączyłoby szybką ścieżkę."""
    assert MIN_USEFUL_PX <= MIN_NATIVE_PX
