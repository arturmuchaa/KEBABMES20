"""Generuje ikonę aplikacji Kebab MES dla Tauri (512x512 PNG)."""
from PIL import Image, ImageDraw
import os

os.makedirs("src-tauri/icons", exist_ok=True)

img = Image.new("RGBA", (512, 512), (255, 255, 255, 0))
d = ImageDraw.Draw(img)
d.ellipse([4, 4, 508, 508],     fill=(37, 99, 235, 255))   # niebieski
d.ellipse([64, 64, 448, 448],   fill=(255, 255, 255, 255))  # bialy pierscien
d.ellipse([96, 96, 416, 416],   fill=(37, 99, 235, 255))    # wewnetrzny
d.ellipse([196, 196, 316, 316], fill=(255, 255, 255, 255))  # srodek

img.save("src-tauri/icons/icon.png")
print("Ikona wygenerowana: src-tauri/icons/icon.png")
