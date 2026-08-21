"""Skan HDI przygotowany do archiwum: pion + opis nad dokumentem.

Dwie rzeczy, o które prosił zakład (2026-08-13), obie robione RAZ, przy
zapisie przyjęcia:

1. **Pion.** Bizhub podaje kartkę poziomo, więc HDI leżało w MES bokiem.
2. **Opis.** Na papierze dopisuje się długopisem, do jakich numerów
   porządkowych poszła dostawa („472" w rogu skanu z 12.08). To samo
   drukujemy teraz sami.

**Opis DOKŁADAMY nad dokumentem, na osobnym białym pasku — nigdy NA
treści.** Układ każdego dostawcy jest inny (KOKO, FARMEX, PERFECT MEAT,
BIERNACKI mają zupełnie inne tabele), więc cokolwiek nadrukowanego „w rogu"
u jednego zasłoniłoby dane u drugiego. Pasek jest bezpieczny zawsze, a przy
okazji widać, że to dopisek MES, a nie ingerencja w dokument dostawcy.

Cała ścieżka jest AWARYJNIE BEZPIECZNA: gdy czegokolwiek zabraknie
(tesseract, poppler, dziwny plik), do archiwum trafia ORYGINAŁ bez zmian.
Skan HDI to dokument do okazania przy kontroli — nie wolno go zgubić przez
krok kosmetyczny.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path
from typing import Iterable, List, Optional, Sequence

from app.logging_config import get_logger

logger = get_logger(__name__)

#: Czcionka z polskimi znakami (pasek z „porządkowy" bez niej wygląda źle).
_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
_FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

#: Rozdzielczość rasteryzacji PDF-a. Skan jest z 300 dpi, więc wyżej nie
#: idziemy — to samo ustalenie co przy OCR (powiększanie nie dodaje treści).
_MIN_DPI, _MAX_DPI = 150, 300

#: Ile stron skanu przetwarzamy. HDI to 1-2 kartki; limit chroni przed
#: przypadkowym wgraniem grubego pliku i zajechaniem serwera.
_MAX_PAGES = 20


def format_kg(kg: float) -> str:
    """4605.0 → „4605", 4605.5 → „4605,5" (jak w całym MES — przecinek)."""
    if kg == int(kg):
        return str(int(kg))
    return f"{kg:.1f}".replace(".", ",")


def zakres_pozycji(numery: Sequence[int]) -> str:
    """Numery pozycji HDI skrócone do zakresów: [1,2,3,5] → „1-3, 5".

    Dostawa bywa rozbita na trzy stosy, a HDI ma kilkanaście pozycji —
    wypisanie ich po przecinku nie zmieściłoby się nad dokumentem.
    """
    # `if n is not None`, nie `if n`: numer 0 to prawidłowa pozycja w dostawach
    # zapisanych do 21.08.2026 (numerowaliśmy wtedy od zera). Filtr po
    # prawdziwości gubił ją po cichu — z opisu dokumentu kontrolnego znikała
    # PIERWSZA pozycja przyjęcia i nic tego nie sygnalizowało.
    porz = sorted({int(n) for n in numery if n is not None})
    if not porz:
        return ""
    grupy: list[list[int]] = [[porz[0]]]
    for n in porz[1:]:
        if n == grupy[-1][-1] + 1:
            grupy[-1].append(n)
        else:
            grupy.append([n])
    return ", ".join(str(g[0]) if len(g) == 1 else f"{g[0]}-{g[-1]}" for g in grupy)


def _pozycje_partii(b: dict) -> str:
    linie = b.get("supplier_batches") or b.get("supplierBatches") or []
    return zakres_pozycji([l.get("seq") for l in linie if isinstance(l, dict)])


def caption_for(reception_no: str, batches: Sequence[dict]) -> str:
    """Opis drukowany nad HDI — to, co dotąd pisano długopisem.

    „Przyjęcie 14/08 — nr porządkowy 475: 4605 kg (poz. 1-3), 476: 5400 kg (poz. 4-5)"

    Numery pozycji są z kolumny Lp dokumentu dostawcy: dostawa rozbita na dwa
    stosy inaczej nie daje się ze skanu odczytać — nie widać, gdzie trafiła
    pozycja 4. Partie anulowane pomijamy: na dokumencie ma zostać to, co
    faktycznie przyjęto, a nie ślad po naszej pomyłce w rejestracji.
    """
    zywe = [b for b in batches if (b.get("status") or "") != "cancelled"]
    czesci = []
    for b in zywe:
        opis_partii = (
            f"{b.get('internal_batch_no') or b.get('internalBatchNo') or '?'}: "
            f"{format_kg(float(b.get('kg_received') or b.get('kgReceived') or 0))} kg")
        poz = _pozycje_partii(b)
        czesci.append(f"{opis_partii} (poz. {poz})" if poz else opis_partii)
    opis = f"Przyjęcie {reception_no}" if reception_no else "Przyjęcie"
    if czesci:
        opis += " — nr porządkowy " + ", ".join(czesci)
    return opis


def _osd_rotation(img_path: str) -> int:
    """Obrót wg tesseract OSD, w stopniach ZGODNIE z zegarem (0 gdy nie wie).

    Pewność poniżej progu odrzucamy: na miniaturze OSD potrafi zwrócić
    „Rotate: 180" z pewnością 0,01, czyli czyste zgadywanie, które
    postawiłoby poprawnie ułożony dokument na głowie.
    """
    try:
        out = subprocess.run(
            ["tesseract", img_path, "-", "--psm", "0"],
            capture_output=True, text=True, timeout=60,
            env={**os.environ, "OMP_THREAD_LIMIT": "1"},
        ).stdout
        stopnie, pewnosc = 0, 0.0
        for line in out.splitlines():
            if line.startswith("Rotate:"):
                stopnie = int(line.split(":")[1].strip())
            elif line.startswith("Orientation confidence:"):
                pewnosc = float(line.split(":")[1].strip())
        return stopnie if pewnosc >= 1.0 else 0
    except Exception as exc:
        logger.warning("hdi_render.osd_failed", extra={"error": str(exc)})
        return 0


def _pdf_dpi(path: Path) -> int:
    """Natywna rozdzielczość skanu — nie rasteryzujemy wyżej, niż zeskanowano."""
    try:
        out = subprocess.run(["pdfimages", "-list", str(path)],
                             capture_output=True, text=True, timeout=60).stdout
        for line in out.splitlines():
            pola = line.split()
            if len(pola) > 13 and pola[2] == "image":
                return max(_MIN_DPI, min(_MAX_DPI, int(float(pola[13]))))
    except Exception:
        pass
    return _MAX_DPI


def _pdf_pages(path: Path, work: Path) -> List[str]:
    """Strony PDF-a jako pliki JPEG (poppler)."""
    dpi = _pdf_dpi(path)
    subprocess.run(
        ["pdftoppm", "-r", str(dpi), "-jpeg", "-jpegopt", "quality=92",
         "-l", str(_MAX_PAGES), str(path), str(work / "str")],
        check=True, capture_output=True, timeout=300,
    )
    return sorted(str(p) for p in work.glob("str-*.jpg"))


def _with_caption(img, caption: str):
    """Dokłada nad obrazem biały pasek z opisem. Zwraca NOWY obraz."""
    from PIL import Image, ImageDraw, ImageFont

    szer = img.width
    # Rozmiar pisma proporcjonalny do szerokości kartki — pasek ma wyglądać
    # tak samo na skanie 200 i 300 dpi.
    rozmiar = max(14, szer // 52)
    font = ImageFont.truetype(_FONT_BOLD, rozmiar)
    margines = max(8, szer // 60)

    linie = _wrap(caption, font, szer - 2 * margines)
    wys_linii = int(rozmiar * 1.35)
    pasek = wys_linii * len(linie) + 2 * margines

    out = Image.new("RGB", (szer, img.height + pasek), "white")
    out.paste(img, (0, pasek))
    rys = ImageDraw.Draw(out)
    for i, linia in enumerate(linie):
        rys.text((margines, margines + i * wys_linii), linia, fill="black", font=font)
    # Kreska oddzielająca dopisek MES od dokumentu dostawcy.
    rys.line([(0, pasek - 1), (szer, pasek - 1)], fill="#999999", width=2)
    return out


def _wrap(text: str, font, max_szer: int) -> List[str]:
    """Łamie opis na linie mieszczące się w szerokości kartki."""
    slowa, linie, biezaca = text.split(), [], ""
    for slowo in slowa:
        proba = f"{biezaca} {slowo}".strip()
        if font.getbbox(proba)[2] <= max_szer or not biezaca:
            biezaca = proba
        else:
            linie.append(biezaca)
            biezaca = slowo
    if biezaca:
        linie.append(biezaca)
    return linie


def prepare_scan(data: bytes, suffix: str, caption: str) -> tuple[bytes, str]:
    """Skan → wersja pionowa z opisem. Zawsze zwraca (bajty, rozszerzenie).

    Przy JAKIMKOLWIEK niepowodzeniu oddaje wejście bez zmian — archiwum
    dokumentu jest ważniejsze niż to, czy udało się go wyprostować.
    """
    try:
        return _prepare(data, suffix, caption)
    except Exception as exc:
        logger.warning("hdi_render.failed", extra={"error": str(exc)})
        return data, suffix


def _prepare(data: bytes, suffix: str, caption: str) -> tuple[bytes, str]:
    from PIL import Image

    suffix = (suffix or ".pdf").lower()
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        zrodlo = work / f"wejscie{suffix}"
        zrodlo.write_bytes(data)

        strony = (_pdf_pages(zrodlo, work) if suffix == ".pdf"
                  else [str(zrodlo)])
        if not strony:
            raise RuntimeError("nie udało się odczytać stron skanu")

        # Orientację ustalamy RAZ, na pierwszej stronie: wielostronicowy skan
        # tego samego dokumentu idzie przez podajnik tak samo ułożony.
        obrot = _osd_rotation(strony[0])

        obrazy = []
        for i, plik in enumerate(strony[:_MAX_PAGES]):
            im = Image.open(plik).convert("RGB")
            if obrot:
                im = im.rotate(-obrot, expand=True)   # OSD liczy zgodnie z zegarem
            # Opis trafia tylko na PIERWSZĄ stronę — tak samo, jak pisze się
            # go długopisem: raz, na wierzchu dokumentu.
            obrazy.append(_with_caption(im, caption) if i == 0 and caption else im)

        wyjscie = work / "gotowe.pdf"
        obrazy[0].save(wyjscie, "PDF", save_all=True, append_images=obrazy[1:],
                       resolution=_MAX_DPI, quality=90)
        return wyjscie.read_bytes(), ".pdf"
