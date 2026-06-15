"""Renderowanie URL → PDF przez headless Chrome/Chromium.

Wykorzystujemy gotową stronę wydruku (React SPA), więc PDF jest wierną kopią
tego, co widać na ekranie — bez duplikowania układu w bibliotece PDF.
"""
import os
import shutil
import subprocess
import tempfile

from app.auth.render_token import make_render_token
from app.logging_config import get_logger

logger = get_logger(__name__)

_CHROME_NAMES = ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser")
_CHROME_PATHS = ("/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/snap/bin/chromium")


def find_chrome() -> str | None:
    for name in _CHROME_NAMES:
        path = shutil.which(name)
        if path:
            return path
    for path in _CHROME_PATHS:
        if os.path.exists(path):
            return path
    return None


def _with_render_token(url: str) -> str:
    tok = make_render_token(ttl=120)   # NO secret arg — uses shared _DEFAULT_SECRET
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}render_token={tok}"


def render_url_to_pdf(url: str, timeout: int = 45) -> bytes:
    """Wyrenderuj URL do PDF (A4 z @page strony wydruku). Zwraca bajty PDF."""
    chrome = find_chrome()
    if not chrome:
        raise RuntimeError("Brak Chrome/Chromium na serwerze — nie można wygenerować PDF")

    workdir = tempfile.mkdtemp(prefix="hdi-pdf-")
    out_path = os.path.join(workdir, "out.pdf")
    try:
        cmd = [
            chrome,
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--hide-scrollbars",
            f"--user-data-dir={os.path.join(workdir, 'ud')}",
            "--no-pdf-header-footer",
            # Daj czas Reactowi na pobranie danych i render przed zrzutem.
            "--virtual-time-budget=8000",
            f"--print-to-pdf={out_path}",
            _with_render_token(url),
        ]
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
        if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
            tail = (proc.stderr or b"").decode("utf-8", "ignore")[-500:]
            raise RuntimeError(f"Generowanie PDF nie powiodło się (rc={proc.returncode}): {tail}")
        with open(out_path, "rb") as fh:
            return fh.read()
    except subprocess.TimeoutExpired:
        raise RuntimeError("Generowanie PDF przekroczyło limit czasu")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
