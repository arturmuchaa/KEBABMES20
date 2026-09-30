"""Odtwarza logo etykiety HMI magazynu z tego samego źródła co dokumenty.

Wymaga Pillow. Uruchom: python3 deploy/generate-weighing-logo.py
public/logo-ksiezyc-print.png to przycięty oryginał
/root/ksiezyc-logo-poziome-slogan-full-color-cmyk-1.png (444,444)-(3223,823).
Raster 1-bit, 720×98 punktów (90×12,3 mm / 203 dpi), bez ditheringu.
Logo jedzie w ZPL: bez sieci i bez plików w pamięci drukarki.
"""
import base64
import binascii
from pathlib import Path
import zlib

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
image = Image.open(ROOT / "public/logo-ksiezyc-print.png").convert("RGB")
image = image.resize((720, 98), Image.Resampling.LANCZOS)
# W GFA czarny piksel to bit 1, odwrotnie niż w obrazie Pillow.
image = image.convert("L").point(lambda p: 255 if p < 180 else 0, "1")
data = image.tobytes()
encoded = base64.b64encode(zlib.compress(data, 9)).decode("ascii")
crc = binascii.crc_hqx(encoded.encode("ascii"), 0)
target = ROOT / "src/features/magazyn/assets/ksiezyc-logo-203dpi.grf"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(f"^GFA,{len(data)},{len(data)},90,:Z64:{encoded}:{crc:04X}", encoding="ascii")
print(f"Logo: {target} ({len(data)} bajtów rastra)")
