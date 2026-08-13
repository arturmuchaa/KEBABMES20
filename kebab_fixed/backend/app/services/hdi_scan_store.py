"""Skany HDI przypięte do przyjęć — dokument dostawy do okazania przy kontroli.

Skan wjeżdża najpierw jako TYMCZASOWY (operator dopiero patrzy, co się
odczytało, i może zrezygnować), a dopiero zapis przyjęcia czyni go trwałym
załącznikiem. Dzięki temu porzucone próby nie zaśmiecają archiwum, a to,
co zostało przyjęte, ma komplet dokumentów.

Nazwy plików budujemy SAMI z identyfikatorów — nigdy z nazwy przysłanej
przez przeglądarkę, bo ta bywa czymkolwiek (także „../..").
"""
from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Optional

from app.config import settings
from app.logging_config import get_logger
from app.utils.ids import cuid

logger = get_logger(__name__)

#: Porzucone skany (operator zamknął formularz) kasujemy po tygodniu.
TEMP_TTL_S = 7 * 24 * 3600
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{4,64}$")


def _temp_dir() -> Path:
    return settings.hdi_scans_dir / "tymczasowe"


def is_safe_id(scan_id: str) -> bool:
    """Identyfikator z zewnątrz trafia do ŚCIEŻKI — musi być bezpieczny.

    Bez tej kontroli „../../etc/passwd" wyszłoby poza katalog skanów.
    """
    return bool(scan_id) and bool(_SAFE_ID.match(scan_id))


def save_temp(data: bytes, suffix: str) -> str:
    """Zapisuje świeżo wczytany skan i zwraca jego identyfikator."""
    d = _temp_dir()
    d.mkdir(parents=True, exist_ok=True)
    _cleanup_temp(d)
    scan_id = cuid()
    (d / f"{scan_id}{_safe_suffix(suffix)}").write_bytes(data)
    return scan_id


#: Skan bywa zdjęciem, nie PDF-em (przeciągnięcie pliku, Ctrl+V, telefon).
#: Podawanie JPG-a jako „application/pdf" psuło podgląd w MES i zapisywało
#: plik z typem, którego nie ma w środku.
_MEDIA = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


def scan_media_type(suffix: str) -> str:
    """Typ MIME załącznika po jego rozszerzeniu."""
    return _MEDIA.get((suffix or "").lower(), "application/octet-stream")


def _safe_suffix(suffix: str) -> str:
    s = (suffix or "").lower()
    return s if s in {".pdf", ".png", ".jpg", ".jpeg"} else ".pdf"


def _cleanup_temp(d: Path) -> None:
    """Porzucone próby nie mogą rosnąć w nieskończoność."""
    granica = time.time() - TEMP_TTL_S
    for p in d.glob("*"):
        try:
            if p.is_file() and p.stat().st_mtime < granica:
                p.unlink()
        except OSError:
            pass


def find_temp(scan_id: str) -> Optional[Path]:
    if not is_safe_id(scan_id):
        return None
    return next(_temp_dir().glob(f"{scan_id}.*"), None)


def attach(scan_id: str, reception_id: str) -> Optional[str]:
    """Czyni skan trwałym załącznikiem przyjęcia. Zwraca nazwę pliku."""
    zrodlo = find_temp(scan_id)
    if not zrodlo or not is_safe_id(reception_id):
        return None
    cel_dir = settings.hdi_scans_dir
    cel_dir.mkdir(parents=True, exist_ok=True)
    cel = cel_dir / f"{reception_id}{zrodlo.suffix}"
    try:
        zrodlo.replace(cel)
    except OSError as exc:
        logger.warning("hdi_scan.attach_failed", extra={"error": str(exc)})
        return None
    logger.info("hdi_scan.attached", extra={"reception": reception_id})
    return cel.name


def attach_bytes(data: bytes, suffix: str, reception_id: str) -> Optional[str]:
    """Zapisuje GOTOWE bajty jako załącznik przyjęcia. Zwraca nazwę pliku.

    Osobno od `attach()`, bo skan przed archiwizacją przechodzi obróbkę
    (pion + opis, patrz `hdi_scan_render`) i do katalogu trafia już inna
    zawartość niż ta z poczekalni.
    """
    if not is_safe_id(reception_id) or not data:
        return None
    cel_dir = settings.hdi_scans_dir
    cel_dir.mkdir(parents=True, exist_ok=True)
    cel = cel_dir / f"{reception_id}{_safe_suffix(suffix)}"
    try:
        cel.write_bytes(data)
    except OSError as exc:
        logger.warning("hdi_scan.attach_failed", extra={"error": str(exc)})
        return None
    logger.info("hdi_scan.attached", extra={"reception": reception_id})
    return cel.name


def take_temp(scan_id: str) -> Optional[tuple[bytes, str]]:
    """Wyjmuje skan z poczekalni: (bajty, rozszerzenie). Plik kasuje."""
    zrodlo = find_temp(scan_id)
    if not zrodlo:
        return None
    try:
        dane = zrodlo.read_bytes()
        suffix = zrodlo.suffix
        zrodlo.unlink(missing_ok=True)
        return dane, suffix
    except OSError as exc:
        logger.warning("hdi_scan.take_temp_failed", extra={"error": str(exc)})
        return None


def find_attached(filename: str) -> Optional[Path]:
    """Plik załącznika po nazwie zapisanej w bazie."""
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        return None
    p = settings.hdi_scans_dir / filename
    return p if p.is_file() else None
