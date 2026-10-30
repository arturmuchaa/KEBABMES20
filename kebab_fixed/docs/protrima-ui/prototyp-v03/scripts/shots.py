"""Zrzuty ekranu z działającego demo (vite preview na :4173). Każdy stan osiągany klikaniem lub klawiaturą."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = "http://localhost:4173/"
OUT = Path(__file__).resolve().parent.parent / "shots"
OUT.mkdir(exist_ok=True)
for f in OUT.glob("[0-9]*.png"):
    f.unlink()
errors = []
LIST = "[aria-label='Lista zamówień']"
SLIST = "[aria-label='Lista pozycji magazynowych']"


def page_for(b, w, h, dpr=1, dark=False):
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=dpr, color_scheme="dark" if dark else "light", locale="pl-PL")
    p = ctx.new_page()
    p.on("console", lambda m: errors.append(f"[{w}x{h}] {m.type}: {m.text}") if m.type == "error" else None)
    p.on("pageerror", lambda e: errors.append(f"[{w}x{h}] pageerror: {e}"))
    p.goto(URL)
    p.wait_for_selector(".pline")
    p.evaluate("document.fonts.ready")
    p.wait_for_timeout(300)
    return ctx, p


def rest(p):
    p.mouse.move(2, 600)
    p.wait_for_timeout(250)


def tab_window(p, name):
    p.click(f".wtab:has-text('{name}')")
    rest(p)


def select_order(p, no):
    p.click(f"{LIST} tr.row:has-text('{no}') td:nth-child(3)")
    p.wait_for_selector(".tabpane:not([hidden]) .dock-head")
    rest(p)


def dtab(p, name):
    p.click(f".tabpane:not([hidden]) .dock-tab:has-text('{name}')")
    rest(p)


def shot(p, name):
    p.screenshot(path=str(OUT / f"{name}.png"))
    print("saved", name)


with sync_playwright() as pw:
    b = pw.chromium.launch()

    ctx, p = page_for(b, 1920, 1080)
    shot(p, "01-pulpit-1920x1080")
    tab_window(p, "Zamówienia")
    shot(p, "02-zamowienia-1920x1080")
    select_order(p, "ZAM-2026-0412")
    shot(p, "03-zamowienie-przeglad-1920x1080")
    dtab(p, "Pokrycie")
    shot(p, "04-zamowienie-pokrycie-1920x1080")
    dtab(p, "Palety")
    shot(p, "05-zamowienie-palety-1920x1080")
    p.click(".mb-item:has-text('Zamówienia')")
    p.wait_for_selector(".menu")
    p.mouse.move(400, 420)
    p.wait_for_timeout(200)
    shot(p, "06-menu-zamowienia-1920x1080")
    p.keyboard.press("Escape")
    p.click(".mb-item:has-text('Plik')")
    p.wait_for_selector(".menu")
    p.wait_for_timeout(150)
    shot(p, "07-menu-plik-1920x1080")
    p.keyboard.press("Escape")
    p.click(".toolbar-main .tbtn:has-text('Drukuj')")
    p.wait_for_selector(".menu")
    p.wait_for_timeout(150)
    shot(p, "07b-pasek-drukuj-1920x1080")
    p.keyboard.press("Escape")
    tab_window(p, "Wyrób gotowy")
    shot(p, "08-wyrob-gotowy-1920x1080")
    p.click(f"{SLIST} tr.row:has-text('BEYAZ') >> nth=0")
    p.click(".seg button:has-text('Wolne')")
    p.click(f"{SLIST} tr.row:has-text('BEYAZ') td:nth-child(3)")
    p.wait_for_selector(".tabpane:not([hidden]) .dock-head")
    dtab(p, "Przydział")
    shot(p, "09-wyrob-gotowy-przydzial-1920x1080")
    p.click(".tabpane:not([hidden]) .dock-body button:has-text('Przydziel') >> nth=0")
    rest(p)
    dtab(p, "Ruchy magazynowe")
    shot(p, "10-wyrob-gotowy-ruchy-po-przydziale")
    ctx.close()

    ctx, p = page_for(b, 1366, 768)
    shot(p, "11-pulpit-1366x768")
    tab_window(p, "Zamówienia")
    shot(p, "12-zamowienia-1366x768")
    select_order(p, "ZAM-2026-0412")
    dtab(p, "Palety")
    shot(p, "13-zamowienie-palety-1366x768")
    tab_window(p, "Wyrób gotowy")
    p.click(f"{SLIST} tr.row >> nth=2")
    p.wait_for_selector(".tabpane:not([hidden]) .dock-head")
    rest(p)
    shot(p, "14-wyrob-gotowy-1366x768")
    ctx.close()

    ctx, p = page_for(b, 1536, 864, dpr=1.25)
    tab_window(p, "Zamówienia")
    select_order(p, "ZAM-2026-0398")
    shot(p, "15-zamowienie-125proc")
    ctx.close()

    ctx, p = page_for(b, 1920, 1080, dark=True)
    shot(p, "16-pulpit-grafit")
    tab_window(p, "Zamówienia")
    select_order(p, "ZAM-2026-0412")
    dtab(p, "Pokrycie")
    shot(p, "17-zamowienie-grafit")
    ctx.close()

    ctx, p = page_for(b, 1920, 1080)
    tab_window(p, "Zamówienia")
    p.click(f"{LIST} tr.row:has-text('ZAM-2026-0405') td:nth-child(4)")
    p.keyboard.press("ArrowDown")
    p.keyboard.press("Enter")
    p.wait_for_selector(".wtab:has-text('ZAM-2026-0407')")
    rest(p)
    shot(p, "18-zamowienie-w-oknie")
    ctx.close()
    b.close()

if errors:
    print("\nKONSOLA:")
    for e in errors:
        print(" ", e)
