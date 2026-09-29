import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * HMI Magazyn — pakowanie kartonu na MOCKOWANYM API.
 *
 * Bez bazy i bez logowania: każde żądanie `**\/api/**` obsługuje ten plik
 * (także gdy VITE_API_URL wskazuje nieistniejący serwer). Sesja to
 * `kebab.token=mock` + atrapa `/api/auth/me`. Splash kiosku trwa 5 s.
 *
 * Uruchomienie na gotowym Vite:
 *   E2E_BASE_URL=http://127.0.0.1:5187 npx playwright test e2e/magazyn-pakowanie.spec.ts
 *
 * Chroni to, czego jsdom nie widzi: prawdziwy fokus i prawdziwe klawisze
 * (kod skanera rozcięty na granicy fokusu — review 28.09.2026), układ na
 * ekranach 1024 i 1366 bez poziomego przewijania, dostępność pola skanu
 * i przycisków dialogu przy długim, wielopozycyjnym kartonie.
 */

const ID = 'ac82b8f61e2545a4867b'
const KARTKA = `SCARTON|${ID}`
const SZTUKA = 'U|bc82b8f61e2545a4867b'
const DLUGI_KLIENT = 'PRZEDSIĘBIORSTWO HANDLOWO-USŁUGOWE YALCIN KEBAB DÖNER SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ'

const linia = (i: number) => ({
  productTypeName: `UDO Z KURCZAKA 100% PARTIA ${i}`,
  recipeName: `KIRMIZI BARDZO DŁUGA NAZWA RECEPTURY NUMER ${i}`,
  packagingName: 'METAL 80 / FOLIA', kgPerUnit: 15, targetQty: 10, packedQty: i % 2 ? 3 : 10,
})

const KARTON = {
  kind: 'stock', id: ID, cartonNo: '000318', clientName: DLUGI_KLIENT, orderNo: '', palletNo: 0,
  deliveryDate: '', openedAt: '', targetQty: 80, packedQty: 52,
  lines: Array.from({ length: 8 }, (_, i) => linia(i + 1)),
}
const INNY = {
  kind: 'order', id: 'pal-2', cartonNo: '000319', clientName: `${DLUGI_KLIENT} ODDZIAŁ KRAKÓW`, orderNo: 'YALCIN/Z/7',
  palletNo: 2, deliveryDate: '2026-09-29', openedAt: '', targetQty: 40, packedQty: 0,
  lines: [linia(9)],
}

interface Mock {
  skany: Array<{ code: string; active_id: string | null }>
  nieznane: string[]
  /** Jednorazowe wstrzymanie najbliższego GET /magazyn/pakowanie. */
  wstrzymaj: Promise<void> | null
}

async function uruchom(page: Page): Promise<Mock> {
  const m: Mock = { skany: [], nieznane: [], wstrzymaj: null }
  await page.addInitScript(() => localStorage.setItem('kebab.token', 'mock'))

  const odpowiedz = (route: Route, body: unknown, status = 200) => {
    const origin = route.request().headers()['origin'] ?? '*'
    return route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'authorization, content-type, x-render-token',
        'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      },
    })
  }

  await page.route('**/api/**', async route => {
    const req = route.request()
    const url = new URL(req.url())
    const p = url.pathname.replace(/^.*\/api/, '')
    if (req.method() === 'OPTIONS') return odpowiedz(route, {}, 204)
    if (p === '/auth/me') return odpowiedz(route, { id: 'u1', name: 'Vlad Magazynier', role: 'worker', department: 'magazyn' })
    if (p === '/magazyn/podsumowanie') return odpowiedz(route, {
      kartony: { otwarte: 2, sztukDoSpakowania: 28, zalegle: 0, brakujeWKartonach: 68, doSpakowania: 1, doDokonczenia: 1,
        zaczete: [{ cartonNo: '000318', klient: DLUGI_KLIENT, packedQty: 52, targetQty: 80 }] },
      wydanie: { zamowien: 0, kg: 0, lista: [] },
      mroznia: { palet: 0, lista: [] },
    })
    if (p === '/magazyn/pakowanie' && req.method() === 'GET') {
      const w = m.wstrzymaj
      m.wstrzymaj = null
      if (w) await w
      return odpowiedz(route, { kontenery: [KARTON, INNY], spakowane: [], pula: [] })
    }
    if (p === '/magazyn/pakowanie/skan') {
      const body = req.postDataJSON() as { code: string; active_id: string | null }
      m.skany.push({ code: body.code, active_id: body.active_id })
      return odpowiedz(route, { result: 'ACTIVE', unit: `${DLUGI_KLIENT} · KIRMIZI 15 kg`, container: { ...KARTON, packedQty: 53 } })
    }
    m.nieznane.push(`${req.method()} ${p}`)
    return odpowiedz(route, [])
  })

  await page.goto('/magazyn.html')
  await expect(page.getByTestId('magazyn-hmi')).toBeVisible({ timeout: 20_000 })   // splash 5 s
  return m
}

async function bezPoziomegoPrzewijania(page: Page) {
  const w = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    hmi: (() => { const e = document.querySelector('[data-testid="magazyn-hmi"]')!; return e.scrollWidth - e.clientWidth })(),
  }))
  expect(w.doc).toBeLessThanOrEqual(0)
  expect(w.hmi).toBeLessThanOrEqual(0)
}

for (const rozmiar of [{ width: 1024, height: 768 }, { width: 1366, height: 768 }]) {
  test.describe(`pakowanie ${rozmiar.width}x${rozmiar.height}`, () => {
    test.use({ viewport: rozmiar })

    test('menu → QR kartki → karton → sztuka z id kartonu; wersja, przewijanie, dialog', async ({ page }) => {
      const m = await uruchom(page)
      await expect(page.getByTestId('wersja-hmi')).toHaveText(/^HMI Magazyn · \S+/)
      await bezPoziomegoPrzewijania(page)

      await page.keyboard.type(KARTKA, { delay: 5 })
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('numer-kartonu')).toHaveText('000318')
      await expect(page.getByTestId('wersja-hmi')).toBeVisible()
      await bezPoziomegoPrzewijania(page)

      const pole = page.getByLabel('Pole skanowania')
      await expect(pole).toBeFocused()
      await page.keyboard.type(SZTUKA, { delay: 5 })
      await page.keyboard.press('Enter')
      await expect.poll(() => m.skany).toEqual([{ code: SZTUKA, active_id: ID }])

      // Wielopozycyjny karton przewija się do ostatniej pozycji; pole skanu zostaje na ekranie.
      const glowny = page.getByTestId('pakowanie-glowny')
      await glowny.evaluate(e => e.scrollTo(0, e.scrollHeight))
      await expect(page.getByTestId('pozycja-kartonu').last()).toBeInViewport()
      await expect(pole).toBeInViewport()

      // Dialog korekty: oba przyciski widoczne i klikalne.
      await page.getByRole('button', { name: 'Wyjmij', exact: true }).first().click()
      await expect(page.getByRole('button', { name: 'Wyjmij sztukę' })).toBeInViewport()
      await expect(page.getByRole('button', { name: 'Wróć' })).toBeInViewport()
      await page.getByRole('button', { name: 'Wróć' }).click()
      await expect(page.getByRole('button', { name: 'Wyjmij sztukę' })).toHaveCount(0)
      expect(m.skany).toHaveLength(1)
    })

    test('fokus przechodzi do pola w połowie kodu sztuki — jeden skan z pełnym kodem', async ({ page }) => {
      const m = await uruchom(page)
      let zwolnij!: () => void
      m.wstrzymaj = new Promise<void>(r => { zwolnij = r })
      await page.keyboard.type(KARTKA, { delay: 5 })
      await page.keyboard.press('Enter')
      await expect(page.getByText('Szukam kartonu z tej kartki…')).toBeVisible()
      // Skaner pisze dalej (15 ms/znak); w połowie kodu odczyt się kończy
      // i pakowanie oddaje fokus polu — reszta znaków trafia już tam.
      const pisanie = page.keyboard.type(SZTUKA, { delay: 15 })
      await page.waitForTimeout(8 * 15)
      zwolnij()
      await pisanie
      await page.keyboard.press('Enter')
      await expect(page.getByLabel('Pole skanowania')).toBeFocused()
      await expect.poll(() => m.skany.length).toBe(1)
      await page.waitForTimeout(600)
      expect(m.skany).toEqual([{ code: SZTUKA, active_id: ID }])
      await expect(page.getByLabel('Pole skanowania')).toHaveValue('')
    })

    test('lista kartonów: długie nazwy i znaczniki mieszczą się bez poziomego przewijania', async ({ page }) => {
      await uruchom(page)
      await page.getByRole('button', { name: /Kartony/ }).first().click()
      const karty = page.getByTestId('karton-na-liscie')
      await expect(karty).toHaveCount(2)
      await expect(karty.first()).toContainText('zaczęty')
      await bezPoziomegoPrzewijania(page)
      for (const k of await karty.all()) {
        const r = await k.evaluate(e => ({ nad: e.scrollWidth - e.clientWidth, prawo: e.getBoundingClientRect().right }))
        expect(r.nad).toBeLessThanOrEqual(1)
        expect(r.prawo).toBeLessThanOrEqual(rozmiar.width)
      }
    })
  })
}
