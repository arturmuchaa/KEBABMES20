"""OCR skanu HDI — jedyne miejsce, gdzie uruchamiamy tesseract.

Rozbiór tekstu na pozycje siedzi w `hdi_parse` (czysty, testowalny); tutaj
zostaje samo I/O: PDF → obraz → tekst.

Wszystko lokalnie: skan dokumentu dostawcy NIE wychodzi z serwera zakładu.
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict

from fastapi import HTTPException

from app.logging_config import get_logger
from app.services.hdi_parse import parse_hdi_text, sum_matches_footer

logger = get_logger(__name__)

#: Skan A4 z telefonu bywa ciężki; powyżej tego to już nie jest dokument.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
#: Rozdzielczość rasteryzacji PDF. 300 dpi to minimum, przy którym tesseract
#: czyta sześciocyfrowe numery partii bez pomyłek — przy 200 zaczyna mylić
#: 8 z 0. Wyżej niż 400 rośnie tylko czas.
RENDER_DPI = 300
#: OCR całej strony nie powinien trwać dłużej; dłużej = coś jest nie tak
#: z plikiem, a operator czeka przy formularzu.
TIMEOUT_S = 90

_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}


def ocr_available() -> bool:
    return shutil.which("tesseract") is not None


def _run(cmd: list[str]) -> None:
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Odczyt dokumentu trwał zbyt długo — spróbuj ponownie")
    except subprocess.CalledProcessError as exc:
        logger.warning("hdi_ocr.command_failed",
                       extra={"cmd": cmd[0], "stderr": exc.stderr[:300].decode("utf-8", "replace")})
        raise HTTPException(422, "Nie udało się odczytać pliku — czy to na pewno skan HDI?")


def _pages_to_text(work: Path, source: Path) -> str:
    """Każda strona osobno: HDI bywa dwustronicowy przy długiej tabeli."""
    if source.suffix.lower() == ".pdf":
        _run(["pdftoppm", "-r", str(RENDER_DPI), "-png", str(source), str(work / "page")])
        images = sorted(work.glob("page*.png"))
    else:
        images = [source]
    if not images:
        raise HTTPException(422, "Plik nie zawiera żadnej strony do odczytania")

    out: list[str] = []
    for img in images:
        base = work / f"{img.stem}_txt"
        # --psm 6 = „jednolity blok tekstu": tabela HDI ma stałe kolumny,
        # a domyślny tryb rozbijał ją na kolumny i mieszał kolejność pól.
        _run(["tesseract", str(img), str(base), "-l", "pol", "--psm", "6"])
        txt = base.with_suffix(".txt")
        if txt.exists():
            out.append(txt.read_text(encoding="utf-8", errors="replace"))
    return "\n".join(out)


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
    logger.info("hdi_ocr.scanned", extra={
        "hdi_no": parsed.get("hdi_no") or "?",
        "rows": len(parsed["lines"]),
        "sum_ok": parsed["sum_ok"],
    })
    return parsed
