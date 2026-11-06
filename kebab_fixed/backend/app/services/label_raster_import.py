"""Strict, offline raster adapters. Uploaded printer programs are NEVER executed.

Supported subset: one EPL label (N/q/Q/GW/P1) or one ZPL label
(XA/PW/LL/FO/GFA/FS/XZ), uncompressed graphics only. Unknown commands fail
closed. Source DPI must be supplied by the operator, not guessed from PRN.
EPL GW polarity: https://cpws.zebra.com/cpws/docs/eltron/gw_command.htm
"""
from __future__ import annotations

import base64
import hashlib
import io
import re
from dataclasses import dataclass

from PIL import Image

MAX_SOURCE_BYTES = 4 * 1024 * 1024
MAX_DOTS = 4096
MAX_PIXELS = 8_000_000
MAX_GRAPHICS = 256


class LabelImportError(ValueError):
    pass


def _dimensions(width: int, height: int) -> None:
    if not (0 < width <= MAX_DOTS and 0 < height <= MAX_DOTS
            and width * height <= MAX_PIXELS):
        raise LabelImportError("Nieprawidłowy lub zbyt duży rozmiar etykiety/grafiki")


@dataclass(frozen=True)
class RasterLabel:
    language: str
    dpi: int
    image: Image.Image  # mode 1: 0 black, 1 white, same polarity as EPL
    source_sha256: str
    gap_dots: int = 0

    def as_import(self) -> dict:
        png = io.BytesIO()
        self.image.save(png, format="PNG")
        return {
            "schemaVersion": 1,
            "language": self.language,
            "dpi": self.dpi,
            "widthMm": self.image.width * 25.4 / self.dpi,
            "heightMm": self.image.height * 25.4 / self.dpi,
            "widthDots": self.image.width,
            "heightDots": self.image.height,
            "gapDots": self.gap_dots,
            "sourceSha256": self.source_sha256,
            "backgroundData": "data:image/png;base64," + base64.b64encode(png.getvalue()).decode("ascii"),
            "backgroundZpl": raster_to_zpl(self.image),
            "warnings": [
                "Import obejmuje statyczną grafikę. Stare daty i QR pozostają w obrazie.",
                "DPI pochodzi z wyboru operatora. Sprawdź rozmiar materiału przed zapisem.",
                "Zaimportowane polecenia nie są wysyłane do drukarki.",
            ],
        }


def _packed(image: Image.Image) -> bytes:
    if image.mode != "1":
        raise LabelImportError("Adapter wymaga gotowego obrazu monochromatycznego, bez skalowania")
    _dimensions(*image.size)
    # Explicit white padding: Pillow pads partial bytes with black bits.
    padded = Image.new("1", (((image.width + 7) // 8) * 8, image.height), 1)
    padded.paste(image, (0, 0))
    return padded.tobytes()


def raster_to_epl(image: Image.Image, gap_dots: int) -> bytes:
    """One complete label, one copy. Binary output, never encode as UTF-8."""
    if type(gap_dots) is not int or not 0 <= gap_dots <= MAX_DOTS:
        raise LabelImportError("Nieprawidłowy odstęp materiału")
    packed = _packed(image)
    row_bytes = (image.width + 7) // 8
    return (f"N\nq{image.width}\nQ{image.height},{gap_dots}\n"
            f"GW0,0,{row_bytes},{image.height},".encode("ascii")
            + packed + b"\nP1\n")


def raster_to_zpl(image: Image.Image) -> str:
    packed = bytes(b ^ 255 for b in _packed(image))
    return (f"^XA^PW{image.width}^LL{image.height}^LH0,0^LS0^LT0"
            f"^FO0,0^GFA,{len(packed)},{len(packed)},{(image.width + 7) // 8},"
            + packed.hex().upper() + "^FS^PQ1^XZ")


class _Canvas:
    def __init__(self):
        self.width = self.height = 0
        self.graphics: list[tuple[int, int, Image.Image]] = []
        self.total_pixels = 0

    def add(self, x: int, y: int, row_bytes: int, height: int, data: bytes, *, zpl=False):
        _dimensions(row_bytes * 8, height)
        self.total_pixels += row_bytes * 8 * height
        if len(self.graphics) >= MAX_GRAPHICS or self.total_pixels > MAX_PIXELS:
            raise LabelImportError("Przekroczono limit grafiki")
        if len(data) != row_bytes * height:
            raise LabelImportError("Uszkodzona grafika: długość danych nie zgadza się z wymiarami")
        if zpl:
            data = bytes(b ^ 255 for b in data)
        self.graphics.append((x, y, Image.frombytes("1", (row_bytes * 8, height), data)))

    def finish(self) -> Image.Image:
        _dimensions(self.width, self.height)
        if not self.graphics:
            raise LabelImportError("Plik nie zawiera obsługiwanej grafiki GW/GFA")
        out = Image.new("1", (self.width, self.height), 1)
        rectangles = []
        for x, y, image in self.graphics:
            # Allow only byte-alignment white padding outside the right edge.
            right = x + image.width
            if x >= self.width or y + image.height > self.height or right > self.width + 7:
                raise LabelImportError("Grafika wychodzi poza zadeklarowany rozmiar etykiety")
            if right > self.width:
                pad = image.crop((self.width - x, 0, image.width, image.height))
                if pad.getextrema() != (255, 255):
                    raise LabelImportError("Obcięcie czarnych pikseli poza rozmiarem etykiety")
            rect = (x, y, min(right, self.width), y + image.height)
            for other in rectangles:
                if max(x, other[0]) < min(rect[2], other[2]) and max(y, other[1]) < min(rect[3], other[3]):
                    raise LabelImportError("Nakładające się grafiki wymagają innego adaptera")
            rectangles.append(rect)
            out.paste(image, (x, y))
        return out


def _epl(source: bytes) -> tuple[Image.Image, int]:
    canvas = _Canvas()
    pos, gap = 0, 0
    started = ended = False
    while pos < len(source):
        if source[pos:pos + 1] in (b"\r", b"\n"):
            pos += 1
            continue
        if ended:
            raise LabelImportError("Obsługiwany jest jeden projekt etykiety, nie seria PRN")
        if source.startswith(b"GW", pos):
            m = re.match(rb"GW(\d{1,4}),(\d{1,4}),(\d{1,4}),(\d{1,4})(?:,|\r\n|\n)", source[pos:pos + 64])
            if not started or not m or not canvas.width or not canvas.height:
                raise LabelImportError("Nieprawidłowy nagłówek GW; wymagane N, q i Q przed grafiką")
            x, y, row_bytes, height = map(int, m.groups())
            _dimensions(row_bytes * 8, height)
            pos += m.end()
            length = row_bytes * height
            canvas.add(x, y, row_bytes, height, source[pos:pos + length])
            pos += length
            continue
        end = source.find(b"\n", pos)
        if end < 0:
            end = len(source)
        line = source[pos:end].rstrip(b"\r")
        pos = end + 1
        if line == b"N" and not started:
            started = True
        elif not started:
            raise LabelImportError("EPL musi zaczynać się od N (czysty bufor)")
        elif re.fullmatch(rb"q\d{1,4}", line) and not canvas.width and not canvas.graphics:
            canvas.width = int(line[1:])
        elif re.fullmatch(rb"Q\d{1,4},\d{1,4}", line) and not canvas.height and not canvas.graphics:
            canvas.height, gap = map(int, line[1:].split(b","))
            if gap > MAX_DOTS:
                raise LabelImportError("Nieprawidłowy odstęp materiału")
        elif line in (b"P1", b"P1,1"):
            ended = True
        else:
            command = line[:24].decode("ascii", errors="backslashreplace")
            raise LabelImportError(f"Nieobsługiwana instrukcja EPL: {command}. Eksportuj grafikę lub PDF.")
    if not ended:
        raise LabelImportError("Niekompletny EPL: brak P1")
    return canvas.finish(), gap


def _zpl(source: bytes) -> Image.Image:
    try:
        text = source.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise LabelImportError("Ten adapter ZPL obsługuje tylko ASCII GFA, nie dane binarne") from exc
    if not text.startswith("^XA") or not text.endswith("^XZ") or "~" in text:
        raise LabelImportError("Niekompletny ZPL lub niedozwolone polecenia urządzenia")
    canvas = _Canvas()
    x = y = 0
    opened = closed = field = graphic = False
    seen = set()
    cursor = 0
    for match in re.finditer(r"\^([A-Z0-9]{2})([^\^]*)", text):
        if text[cursor:match.start()].strip():
            raise LabelImportError("Nieprawidłowa składnia ZPL")
        cursor = match.end()
        cmd, value = match.group(1), match.group(2).strip()
        if closed:
            raise LabelImportError("ZPL zawiera więcej niż jedną etykietę")
        if cmd == "XA" and not opened and not value:
            opened = True
        elif cmd == "XZ" and opened and not field and not value:
            closed = True
        elif cmd in ("PW", "LL") and cmd not in seen and not canvas.graphics and re.fullmatch(r"\d{1,4}", value):
            seen.add(cmd)
            if cmd == "PW":
                canvas.width = int(value)
            else:
                canvas.height = int(value)
        elif (cmd, value) in (("LH", "0,0"), ("LS", "0"), ("LT", "0"), ("CI", "28"), ("PQ", "1")):
            if field:
                raise LabelImportError("Konfiguracja wewnątrz pola ZPL")
        elif cmd == "FO" and not field and re.fullmatch(r"\d{1,4},\d{1,4}", value):
            x, y = map(int, value.split(","))
            field, graphic = True, False
        elif cmd == "GF" and field and not graphic:
            m = re.fullmatch(r"A,(\d{1,7}),(\d{1,7}),(\d{1,4}),([0-9a-fA-F\r\n]+)", value)
            if not m:
                raise LabelImportError("Obsługiwane jest tylko nieskompresowane ^GFA (HEX)")
            total, used, row_bytes = map(int, m.groups()[:3])
            if not row_bytes or total != used or total % row_bytes:
                raise LabelImportError("Nieprawidłowe wymiary GFA")
            _dimensions(row_bytes * 8, total // row_bytes)
            hex_data = re.sub(r"[\r\n]", "", m.group(4))
            if len(hex_data) != total * 2:
                raise LabelImportError("Uszkodzona grafika GFA: niezgodna liczba bajtów")
            canvas.add(x, y, row_bytes, total // row_bytes, bytes.fromhex(hex_data), zpl=True)
            graphic = True
        elif cmd == "FS" and field and graphic and not value:
            field = False
        else:
            raise LabelImportError(f"Nieobsługiwana instrukcja ZPL: ^{cmd}. Eksportuj grafikę lub PDF.")
    if cursor != len(text) or not opened or not closed:
        raise LabelImportError("Niekompletny ZPL")
    return canvas.finish()


def import_raster(source: bytes, dpi: int) -> RasterLabel:
    if type(dpi) is not int or dpi not in (203, 300):
        raise LabelImportError("Wybierz rzeczywiste DPI eksportu: 203 lub 300")
    if not source or len(source) > MAX_SOURCE_BYTES:
        raise LabelImportError("Plik jest pusty lub przekracza limit 4 MiB")
    # Never inspect arbitrary binary bitmap bytes for language signatures.
    start = source.lstrip(b"\r\n \t")
    digest = hashlib.sha256(source).hexdigest()
    if start.startswith(b"^XA"):
        return RasterLabel("zpl", dpi, _zpl(start), digest)
    if start.startswith((b"N\n", b"N\r\n")):
        image, gap = _epl(start)
        return RasterLabel("epl", dpi, image, digest, gap)
    raise LabelImportError("Nie rozpoznano obsługiwanego EPL/ZPL. Projekty LBL/NLBL eksportuj do PRN lub PDF.")
