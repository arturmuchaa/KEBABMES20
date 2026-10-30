"""Ładuje dokładnie ten plik, który zostanie opublikowany (CDN podmieniony na lokalne UMD)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parent.parent
frag = (root / 'dist-artifact/protrima.html').read_text()
# skeleton publikacji: doctype + charset + viewport + reset
page_html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style></head><body>' + frag + '</body></html>'
(root / 'dist-artifact/_check.html').write_text(page_html)
umd = {
  'react.production.min.js': (root / 'node_modules/react/umd/react.production.min.js').read_text(),
  'react-dom.production.min.js': (root / 'node_modules/react-dom/umd/react-dom.production.min.js').read_text(),
}
errs = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for (w, h, name) in [(1600, 900, 'desk'), (900, 900, 'panel'), (390, 844, 'phone')]:
        ctx = b.new_context(viewport={'width': w, 'height': h})
        p = ctx.new_page()
        p.route('https://cdnjs.cloudflare.com/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=umd[r.request.url.split('/')[-1]]))
        p.on('pageerror', lambda e: errs.append(str(e)))
        p.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        p.goto('file://' + str(root / 'dist-artifact/_check.html'))
        p.wait_for_selector('.pline', timeout=15000)
        p.wait_for_timeout(400)
        p.screenshot(path=str(root / f'shots/_artifact-{name}.png'))
        print(name, 'ok', p.evaluate("[document.documentElement.scrollWidth, innerWidth]"))
        ctx.close()
    b.close()
print('errors:', errs)
