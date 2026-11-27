"""Import .prn z ZebraDesigner (projektor etykiet, 27.11.2026).

Stary MES odrzucał prawdziwe pliki: ZebraDesigner wstawia ustawienia drukarki
przed `N` i rysuje kreski komendą `LO`. Pliki budujemy w teście (bez danych klienta).
"""
import base64
import io
import re

import pytest
from PIL import Image

from app.services.label_prn_import import PrnImportError, import_prn


def _epl(grafiki=b"", reszta=b"", szer=831, wys=1534):
    head = (b"I8,A,001\r\n\r\n\r\nQ%d,024\r\nq%d\r\nrN\r\nS3\r\nD12\r\nZT\r\nJF\r\nOD\r\nR32,0\r\nf100\r\nN\r\n" % (wys, szer))
    return head + grafiki + reszta + b"P1\r\n"


def _gw(x, y, wb, h, data):
    return b"GW%d,%d,%d,%d," % (x, y, wb, h) + data + b"\r\n"


def _obraz(out):
    png = base64.b64decode(out["backgroundPng"].split(",", 1)[1])
    return Image.open(io.BytesIO(png)).convert("1")


def test_epl_z_ustawieniami_przed_N():
    # 2 bajty szer., 2 wiersze; bajt 0x00 = 8 czarnych pikseli (EPL: bit 0 = czarny).
    out = import_prn(_epl(_gw(10, 20, 2, 2, b"\x00\xff\xff\xff")))
    assert out["language"] == "epl" and out["widthDots"] == 831 and out["heightDots"] == 1534
    assert abs(out["widthMm"] - 831 * 25.4 / 203) < 0.01
    img = _obraz(out)
    assert img.getpixel((10, 20)) == 0 and img.getpixel((17, 20)) == 0
    assert img.getpixel((18, 20)) == 255 and img.getpixel((10, 21)) == 255


def test_epl_gw_bajt_z_nowa_linia_w_danych():
    # 0x0a w danych binarnych nie może urwać grafiki.
    out = import_prn(_epl(_gw(0, 0, 1, 2, b"\x0a\x0d")))
    img = _obraz(out)
    assert img.getpixel((0, 0)) == 0 and img.getpixel((4, 0)) == 255   # 0x0a = 00001010


def test_epl_lo_rysuje_kreske():
    img = _obraz(import_prn(_epl(reszta=b"LO292,753,3,83\r\n")))
    assert img.getpixel((292, 753)) == 0 and img.getpixel((294, 835)) == 0
    assert img.getpixel((295, 753)) == 255 and img.getpixel((292, 836)) == 255


def test_zpl_gfa():
    zpl = b"^XA^PW16^LL4^FO0,1^GFA,4,4,2,FF00F0F0^FS^XZ"
    out = import_prn(zpl)
    img = _obraz(out)
    assert out["language"] == "zpl" and out["widthDots"] == 16 and out["heightDots"] == 4
    assert img.getpixel((0, 1)) == 0 and img.getpixel((8, 1)) == 255   # ZPL: bit 1 = czarny
    assert img.getpixel((0, 2)) == 0 and img.getpixel((4, 2)) == 255


def test_tekst_epl_odrzucony_z_podpowiedzia():
    with pytest.raises(PrnImportError) as e:
        import_prn(_epl(reszta=b'A10,10,0,3,1,1,N,"X"\r\n'))
    assert "jako grafika" in str(e.value)


def test_za_duzy_plik():
    with pytest.raises(PrnImportError):
        import_prn(b"N\r\n" + b"x" * (4 * 1024 * 1024 + 1))


def test_gfa_wyniku_odtwarza_obraz():
    out = import_prn(_epl(_gw(8, 2, 1, 1, b"\x0f"), szer=24, wys=6))
    m = re.match(r"\^GFA,(\d+),(\d+),(\d+),([0-9A-F]+)$", out["backgroundZpl"])
    assert m and int(m.group(3)) == 3                                    # 24 dots → 3 bajty na wiersz
    wiersze = [m.group(4)[i:i + 6] for i in range(0, len(m.group(4)), 6)]
    assert wiersze[2] == "00F000"                                        # 0x0f EPL → 4 czarne, ZPL bit 1 = czarny
    assert len(wiersze) == 6


def test_przyciecie_do_rolki_wokol_tresci():
    # Etykieta 831 × 1534 (104 × 192 mm), treść 100 × 100 punktów na środku → rolka 100 × 150 mm.
    gw = _gw(360, 700, 13, 100, b"\x00" * 13 * 100)
    out = import_prn(_epl(gw), roll_mm=(100, 150))
    assert out["widthDots"] == 799 and out["heightDots"] == 1199
    img = _obraz(out)
    czarne = [(x, y) for x in range(0, 799, 4) for y in range(0, 1199, 4) if img.getpixel((x, y)) == 0]
    xs, ys = [p[0] for p in czarne], [p[1] for p in czarne]
    assert abs((min(xs) + max(xs)) / 2 - 799 / 2) < 8 and abs((min(ys) + max(ys)) / 2 - 1199 / 2) < 8


def test_tresc_wieksza_niz_rolka_odrzucona():
    gw = _gw(0, 0, 104, 1300, b"\x00" * 104 * 1300)
    with pytest.raises(PrnImportError) as e:
        import_prn(_epl(gw), roll_mm=(100, 150))
    assert "nie mieści się" in str(e.value)


def test_przyciecie_przy_krawedzi_dopelnia_bialym():
    # Treść przy lewej krawędzi: wycinek wychodzi poza obraz — dopełnienie ma być białe, nie czarne.
    gw = _gw(0, 700, 2, 50, b"\x00" * 2 * 50)
    img = _obraz(import_prn(_epl(gw), roll_mm=(100, 150)))
    assert img.getpixel((0, 0)) == 255 and img.getpixel((0, 1198)) == 255
