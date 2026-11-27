"""Import tła etykiety z pliku .prn z ZebraDesigner (projektor etykiet, 27.11.2026).

Nic z pliku nie trafia do drukarki: plik jest tylko czytany i rysowany do
obrazu, z którego powstaje nowe tło `^GFA`.

EPL2 — tak eksportuje ZebraDesigner: przed `N` stoją ustawienia drukarki
(`I8,A,001`, `Q…`, `q…`, `rN`, `S3`, `D12`, `ZT`, `JF`, `OD`, `R…`, `f…`),
które stary MES odrzucał. Rysujemy `GW` (grafika binarna, bit 0 = czarny) i
`LO/LE/LW` (kreski), koniec na `P`. Szerokość z `q`, wysokość z `Q`.
ZPL — `^XA ^PW ^LL ^FO ^GFA ^GB ^FS ^XZ`, grafika ASCII hex bez kompresji.
Tekst i kody kreskowe (`A`, `B`, `b`, `^A`, `^B`) odrzucamy z podpowiedzią:
ZebraDesigner musi wyeksportować je jako grafikę.
"""
from __future__ import annotations

import base64
import io
import re
from typing import Any, Dict, List

from PIL import Image, ImageDraw

MAX_BYTES = 4 * 1024 * 1024
MAX_DOTS = 4096
_PODPOWIEDZ = ("ZebraDesigner: przy eksporcie do pliku zaznacz drukowanie tekstu i kodów jako grafika "
               "(albo wgraj etykietę jako PDF)")
_USTAWIENIA_EPL = ("I", "Q", "q", "r", "S", "D", "Z", "J", "O", "R", "f", "U", "N", "o")


class PrnImportError(ValueError):
    pass


def _rozmiar(w: int, h: int) -> None:
    if not (0 < w <= MAX_DOTS and 0 < h <= MAX_DOTS):
        raise PrnImportError(f"Nieprawidłowy rozmiar etykiety: {w} × {h} punktów")


def _wynik(img: Image.Image, language: str, dpi: int, warnings: List[str]) -> Dict[str, Any]:
    png = io.BytesIO()
    img.save(png, format="PNG")
    return {
        "language": language,
        "widthDots": img.width, "heightDots": img.height,
        "widthMm": img.width * 25.4 / dpi, "heightMm": img.height * 25.4 / dpi,
        "backgroundPng": "data:image/png;base64," + base64.b64encode(png.getvalue()).decode("ascii"),
        "backgroundZpl": obraz_do_gfa(img),
        "warnings": warnings,
    }


def obraz_do_gfa(img: Image.Image) -> str:
    """Obraz 1-bit (0 = czarny) → `^GFA,…` (ZPL: bit 1 = czarny), wiersz po wierszu."""
    img = img.convert("1")
    wb = (img.width + 7) // 8
    px = img.load()
    hexy = []
    for y in range(img.height):
        wiersz = bytearray(wb)
        for x in range(img.width):
            if px[x, y] == 0:
                wiersz[x // 8] |= 0x80 >> (x % 8)
        hexy.append(wiersz.hex().upper())
    total = wb * img.height
    return f"^GFA,{total},{total},{wb}," + "".join(hexy)


def _epl(src: bytes, dpi: int) -> Dict[str, Any]:
    szer = wys = 0
    grafiki: List[tuple] = []
    kreski: List[tuple] = []
    pos = 0
    koniec = False
    while pos < len(src) and not koniec:
        if src[pos:pos + 1] in (b"\r", b"\n", b" "):
            pos += 1
            continue
        if src.startswith(b"GW", pos):
            m = re.match(rb"GW(\d{1,4}),(\d{1,4}),(\d{1,4}),(\d{1,4}),", src[pos:pos + 40])
            if not m:
                raise PrnImportError("Nieprawidłowy nagłówek grafiki GW")
            x, y, wb, h = map(int, m.groups())
            _rozmiar(wb * 8, h)
            start = pos + m.end()
            dane = src[start:start + wb * h]
            if len(dane) < wb * h:
                raise PrnImportError("Grafika GW jest ucięta — plik niekompletny")
            grafiki.append((x, y, wb, h, dane))
            pos = start + wb * h
            continue
        konc = src.find(b"\n", pos)
        konc = len(src) if konc < 0 else konc
        linia = src[pos:konc].rstrip(b"\r").decode("latin-1")
        pos = konc + 1
        kom = linia[:2]
        if re.fullmatch(r"q\d{1,4}", linia):
            szer = int(linia[1:])
        elif re.fullmatch(r"Q\d{1,4},\d{1,4}(,.*)?", linia):
            wys = int(linia[1:].split(",")[0])
        elif kom in ("LO", "LE", "LW"):
            m = re.fullmatch(r"L[OEW](\d+),(\d+),(\d+),(\d+)", linia)
            if not m:
                raise PrnImportError(f"Nieprawidłowa kreska: {linia[:30]}")
            kreski.append((kom, *map(int, m.groups())))
        elif linia.startswith("P"):
            koniec = True
        elif linia[:1] in ("A", "B", "b") or kom in ("LS", "GG", "GM", "FK"):
            raise PrnImportError(f"Plik zawiera tekst albo kod („{linia[:24]}”), a nie samą grafikę. {_PODPOWIEDZ}")
        elif linia[:1] in _USTAWIENIA_EPL:
            continue
        else:
            raise PrnImportError(f"Nieznana instrukcja EPL: „{linia[:24]}”. {_PODPOWIEDZ}")
    if not koniec:
        raise PrnImportError("Niekompletny plik EPL: brak polecenia druku P")
    _rozmiar(szer, wys)
    img = Image.new("1", (szer, wys), 1)
    px = img.load()
    for x, y, wb, h, dane in grafiki:
        for r in range(h):
            for b in range(wb):
                bajt = dane[r * wb + b]
                if bajt == 0xFF:
                    continue
                for bit in range(8):
                    if not (bajt >> (7 - bit)) & 1:
                        X, Y = x + b * 8 + bit, y + r
                        if X < szer and Y < wys:
                            px[X, Y] = 0
    rys = ImageDraw.Draw(img)
    for kom, x, y, w, h in kreski:
        if w <= 0 or h <= 0:
            continue
        box = (x, y, min(szer, x + w) - 1, min(wys, y + h) - 1)
        if kom == "LW":
            rys.rectangle(box, fill=1)
        elif kom == "LE":
            for X in range(box[0], box[2] + 1):
                for Y in range(box[1], box[3] + 1):
                    px[X, Y] = 255 if px[X, Y] == 0 else 0
        else:
            rys.rectangle(box, fill=0)
    return _wynik(img, "epl", dpi, [])


def _zpl(src: bytes, dpi: int) -> Dict[str, Any]:
    tekst = src.decode("latin-1")
    szer = wys = 0
    fo = (0, 0)
    elementy: List[tuple] = []
    for kom in re.split(r"(?=[\^~])", tekst):
        kom = kom.strip()
        if not kom:
            continue
        k, arg = kom[:3], kom[3:]
        if k in ("^XA", "^XZ", "^FS", "^CI", "^LH", "^LS", "^LT", "^MN", "^MT", "^PR", "^MD", "^PO", "^PQ", "^PM", "^JM", "^LR", "^FX"):
            continue
        if k == "^PW":
            szer = int(arg.split(",")[0])
        elif k == "^LL":
            wys = int(arg.split(",")[0])
        elif k in ("^FO", "^FT"):
            a = arg.split(",")
            fo = (int(a[0] or 0), int(a[1] or 0) if len(a) > 1 else 0)
        elif k == "^GF":
            m = re.fullmatch(r"A,(\d+),(\d+),(\d+),([0-9A-Fa-f\s]+)", arg.strip())
            if not m:
                raise PrnImportError("Grafika ZPL musi być ^GFA w zapisie szesnastkowym bez kompresji. " + _PODPOWIEDZ)
            elementy.append(("gf", fo, int(m.group(3)), re.sub(r"\s", "", m.group(4))))
        elif k == "^GB":
            a = (arg.split(",") + ["", "", "", "B"])[:4]
            elementy.append(("gb", fo, int(a[0] or 1), int(a[1] or 1), int(a[2] or 1), (a[3] or "B").upper()))
        elif k[:2] in ("^A", "^B", "^F"):
            raise PrnImportError(f"Plik zawiera tekst albo kod („{kom[:24]}”), a nie samą grafikę. {_PODPOWIEDZ}")
        else:
            raise PrnImportError(f"Nieznana instrukcja ZPL: „{kom[:24]}”. {_PODPOWIEDZ}")
    _rozmiar(szer, wys)
    img = Image.new("1", (szer, wys), 1)
    px = img.load()
    rys = ImageDraw.Draw(img)
    for el in elementy:
        if el[0] == "gf":
            (x0, y0), wb, hexy = el[1], el[2], el[3]
            dane = bytes.fromhex(hexy)
            for i, bajt in enumerate(dane):
                if not bajt:
                    continue
                r, b = divmod(i, wb)
                for bit in range(8):
                    if (bajt >> (7 - bit)) & 1:
                        X, Y = x0 + b * 8 + bit, y0 + r
                        if X < szer and Y < wys:
                            px[X, Y] = 0
        else:
            (x0, y0), w, h, t, kolor = el[1], el[2], el[3], el[4], el[5]
            fill = 1 if kolor == "W" else 0
            if t >= min(w, h):
                rys.rectangle((x0, y0, x0 + w - 1, y0 + h - 1), fill=fill)
            else:
                rys.rectangle((x0, y0, x0 + w - 1, y0 + h - 1), outline=fill, width=t)
    return _wynik(img, "zpl", dpi, [])


def przytnij_do_rolki(img: Image.Image, roll_mm: tuple, dpi: int) -> Image.Image:
    """Tło większe niż rolka (ZebraDesigner potrafi zapisać 104 × 192 mm przy
    rolce 100 × 150) → wycinek rozmiaru rolki ze środkiem w środku treści."""
    w = round(roll_mm[0] * dpi / 25.4)
    h = round(roll_mm[1] * dpi / 25.4)
    bbox = Image.eval(img.convert("L"), lambda v: 255 - v).getbbox()
    if not bbox:
        return Image.new("1", (w, h), 1)
    x0, y0, x1, y1 = bbox
    if x1 - x0 > w or y1 - y0 > h:
        raise PrnImportError(
            f"Treść etykiety ({(x1 - x0) * 25.4 / dpi:.0f} × {(y1 - y0) * 25.4 / dpi:.0f} mm) "
            f"nie mieści się na rolce {roll_mm[0]:g} × {roll_mm[1]:g} mm")
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    lewo, gora = cx - w // 2, cy - h // 2
    out = Image.new("1", (w, h), 1)
    # Wycinek tylko z wnętrza obrazu (crop poza obrazem dawałby czarne pasy) — reszta biała.
    zx0, zy0 = max(0, lewo), max(0, gora)
    zx1, zy1 = min(img.width, lewo + w), min(img.height, gora + h)
    out.paste(img.crop((zx0, zy0, zx1, zy1)).convert("1"), (zx0 - lewo, zy0 - gora))
    return out


def import_prn(source: bytes, dpi: int = 203, roll_mm: tuple | None = None) -> Dict[str, Any]:
    """Plik .prn (EPL2 albo ZPL) → obraz tła, `^GFA` i rozmiar w mm; `roll_mm`
    (szer., wys.) przycina tło do rolki wokół treści."""
    if not source:
        raise PrnImportError("Plik jest pusty")
    if len(source) > MAX_BYTES:
        raise PrnImportError("Plik przekracza 4 MB")
    if dpi not in (203, 300):
        raise PrnImportError("Rozdzielczość drukarki: 203 albo 300 dpi")
    start = source.lstrip(b"\r\n \t")
    wynik = _zpl(start, dpi) if (start.startswith(b"^XA") or start.startswith(b"~")) else _epl(start, dpi)
    if roll_mm:
        png = base64.b64decode(wynik["backgroundPng"].split(",", 1)[1])
        img = przytnij_do_rolki(Image.open(io.BytesIO(png)), roll_mm, dpi)
        wynik = {**_wynik(img, wynik["language"], dpi, wynik["warnings"])}
    return wynik
