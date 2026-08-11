"""OCR skanu HDI — jedyne miejsce, gdzie uruchamiamy tesseract.

Rozbiór tekstu na pozycje siedzi w `hdi_parse` (czysty, testowalny); tutaj
zostaje samo I/O: PDF → obraz → tekst.

Wszystko lokalnie: skan dokumentu dostawcy NIE wychodzi z serwera zakładu.

TRZY DROGI, od najtańszej (kolejność ma znaczenie dla czasu odpowiedzi):

  1. PDF z warstwą tekstową (gdyby dostawca kiedyś wysłał plik ze swojego
     systemu zamiast skanu) → `pdftotext`, bez OCR. Natychmiast i bezbłędnie.
  2. Skan z osadzonym obrazem → wyciągamy obraz `pdfimages` i czytamy JEGO.
  3. Reszta (obraz za mały albo nietypowy PDF) → rasteryzacja `pdftoppm`.

Zmierzone na skanie HDI 33656 (2026-08-11, serwer 2-rdzeniowy):

    rasteryzacja 300 dpi + OCR domyślny   19,2 s
    obraz wprost z PDF + strojenie         2,0 s

przy IDENTYCZNYM wyniku (8 pozycji, wszystkie numery partii, zgodne sumy).
Rasteryzacja w 300 dpi POWIĘKSZAŁA skan (natywnie 1653×2338 px), czyli
kosztowała czas, nie dodając informacji.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import query_all
from app.logging_config import get_logger
from app.services.hdi_parse import match_supplier, parse_hdi_text, sum_matches_footer

logger = get_logger(__name__)

#: Skan A4 z telefonu bywa ciężki; powyżej tego to już nie jest dokument.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
#: Rozdzielczość rasteryzacji — tylko dla drogi awaryjnej.
RENDER_DPI = 300
#: Poniżej tego skan jest zbyt drobny, żeby czytać go w natywnej wielkości —
#: wtedy świadomie płacimy za rasteryzację, bo powiększenie pomaga tesseractowi.
#: 1500 px na dłuższym boku A4 to ok. 180 dpi. UWAGA: to osąd, nie pomiar —
#: zmierzony jest jeden punkt (skan 1653x2338, czyli 200 dpi, czyta się
#: bezbłędnie). Gdy trafi się gorszy skan, próg warto zweryfikować na nim.
MIN_NATIVE_PX = 1500
#: Logo albo pieczątka osadzona w PDF — nie ma po co jej OCR-ować.
MIN_USEFUL_PX = 800
#: OCR całej strony nie powinien trwać dłużej; dłużej = coś jest nie tak
#: z plikiem, a operator czeka przy formularzu.
TIMEOUT_S = 90

#: --oem 1        = sam LSTM (starszy silnik i tak nic tu nie wnosi)
#: do_invert=0    = bez próby czytania negatywu; oszczędza ~30% czasu
TESSERACT_FLAGS = ["--psm", "6", "--oem", "1", "-c", "tessedit_do_invert=0"]
#: OpenMP na 2 rdzeniach kosztuje więcej, niż daje: 1 wątek 1,2 s, 4 wątki 4,3 s.
TESSERACT_ENV = {"OMP_THREAD_LIMIT": "1"}

_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}


def ocr_available() -> bool:
    return shutil.which("tesseract") is not None


def _run(cmd: list[str], env_extra: Dict[str, str] | None = None) -> None:
    env = {**os.environ, **(env_extra or {})}
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=TIMEOUT_S, env=env)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Odczyt dokumentu trwał zbyt długo — spróbuj ponownie")
    except subprocess.CalledProcessError as exc:
        logger.warning("hdi_ocr.command_failed",
                       extra={"cmd": cmd[0], "stderr": exc.stderr[:300].decode("utf-8", "replace")})
        raise HTTPException(422, "Nie udało się odczytać pliku — czy to na pewno skan HDI?")


def _png_size(path: Path) -> tuple[int, int]:
    """Wymiary PNG z nagłówka IHDR — bez wciągania biblioteki graficznej."""
    try:
        head = path.read_bytes()[:33]
        if head[:8] != b"\x89PNG\r\n\x1a\n":
            return (0, 0)
        return (int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big"))
    except OSError:
        return (0, 0)


def usable_images(sizes: List[tuple[int, int]]) -> bool:
    """Czy osadzone obrazy nadają się do czytania w natywnej wielkości.

    Odrzuca dwa przypadki: brak obrazów (PDF wektorowy) i same drobiazgi
    (logo, pieczątka) albo skan tak drobny, że powiększenie mu pomoże.
    """
    duze = [s for s in sizes if min(s) >= MIN_USEFUL_PX]
    return bool(duze) and max(max(s) for s in duze) >= MIN_NATIVE_PX


def _tesseract(img: Path, work: Path) -> str:
    base = work / f"{img.stem}_txt"
    _run(["tesseract", str(img), str(base), "-l", "pol", *TESSERACT_FLAGS], TESSERACT_ENV)
    txt = base.with_suffix(".txt")
    return txt.read_text(encoding="utf-8", errors="replace") if txt.exists() else ""


def _pdf_text_layer(source: Path) -> str:
    """Tekst z PDF-a, jeśli w ogóle go ma. Skan zwróci pustkę."""
    if not shutil.which("pdftotext"):
        return ""
    out = source.with_suffix(".layer.txt")
    try:
        subprocess.run(["pdftotext", "-layout", str(source), str(out)],
                       check=True, capture_output=True, timeout=TIMEOUT_S)
    except (subprocess.SubprocessError, OSError):
        return ""
    return out.read_text(encoding="utf-8", errors="replace") if out.exists() else ""


def _pages_to_text(work: Path, source: Path) -> str:
    if source.suffix.lower() != ".pdf":
        return _tesseract(source, work)

    # 1. Warstwa tekstowa — jeśli PDF ją ma, OCR jest zbędny.
    layer = _pdf_text_layer(source)
    if parse_hdi_text(layer)["lines"]:
        logger.info("hdi_ocr.text_layer_used")
        return layer

    # 2. Obraz osadzony w PDF — czytany w natywnej wielkości.
    _run(["pdfimages", "-png", str(source), str(work / "img")])
    images = sorted(work.glob("img*.png"))
    sizes = [_png_size(p) for p in images]
    if images and usable_images(sizes):
        czytane = [p for p, s in zip(images, sizes) if min(s) >= MIN_USEFUL_PX]
        return "\n".join(_tesseract(p, work) for p in czytane)

    # 3. Awaryjnie: rasteryzacja. Wolniejsza, ale ratuje PDF-y, z których nie
    #    da się wyjąć sensownego obrazu (wektor, kafelki, bardzo drobny skan).
    logger.info("hdi_ocr.fallback_render", extra={"images": len(images)})
    _run(["pdftoppm", "-r", str(RENDER_DPI), "-gray", "-png", str(source), str(work / "page")])
    pages = sorted(work.glob("page*.png"))
    if not pages:
        raise HTTPException(422, "Plik nie zawiera żadnej strony do odczytania")
    return "\n".join(_tesseract(p, work) for p in pages)


def scan_hdi(data: bytes, filename: str) -> Dict[str, Any]:
    """Skan HDI → pozycje gotowe do wrzucenia w formularz przyjęcia.

    Zwraca też `sum_ok`: czy suma odczytanych pozycji zgadza się z masą netto
    ze stopki dokumentu. To jedyna automatyczna kontrola poprawności odczytu —
    formularz ma ją pokazać, a operator i tak przegląda numery partii wzrokiem
    (pomyłka w numerze nie rozjeżdża żadnej sumy).
    """
    if not ocr_available():
        raise HTTPException(
            503, "Odczyt skanów nie jest zainstalowany na tym serwerze (tesseract)")
    if not data:
        raise HTTPException(400, "Pusty plik")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Plik jest za duży — maksymalnie 25 MB")

    suffix = Path(filename or "").suffix.lower()
    if suffix != ".pdf" and suffix not in _IMAGE_SUFFIXES:
        raise HTTPException(415, "Obsługiwane są PDF, PNG i JPG")

    with tempfile.TemporaryDirectory(prefix="hdi-ocr-") as tmp:
        work = Path(tmp)
        source = work / f"source{suffix}"
        source.write_bytes(data)
        text = _pages_to_text(work, source)

    parsed = parse_hdi_text(text)
    parsed["sum_ok"] = sum_matches_footer(parsed)

    # Rozpoznanie dostawcy: po NIP (ze sprawdzoną sumą kontrolną), numerze
    # weterynaryjnym albo nazwie. Zwracamy TAKŻE po czym rozpoznano, żeby
    # operator mógł to zważyć — podstawienie kontrahenta bez wyjaśnienia
    # byłoby magią, której nie da się sprawdzić.
    dostawcy = query_all(
        "SELECT id, name, display_name, nip, vet_number FROM suppliers WHERE active")
    m = match_supplier(text, parsed, dostawcy)
    parsed["supplier"] = {
        "id": m["id"],
        "name": m.get("display_name") or m.get("name") or "",
        "matched_by": m["matched_by"],
    } if m else None

    logger.info("hdi_ocr.scanned", extra={
        "hdi_no": parsed.get("hdi_no") or "?",
        "rows": len(parsed["lines"]),
        "sum_ok": parsed["sum_ok"],
        "supplier_matched_by": (parsed["supplier"] or {}).get("matched_by", "brak"),
    })
    return parsed
