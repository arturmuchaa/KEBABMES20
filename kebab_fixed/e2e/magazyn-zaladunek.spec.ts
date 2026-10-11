import { test, expect, type Page, type Route } from '@playwright/test'

// Zimny Vite + splash kiosku; nie jest to limit czasu potwierdzenia skanu.
test.setTimeout(60_000)

// Wyłącznie mockowane API: żadnych skanów ani zapisów na produkcji.
const ORDER = 'abcdef12345678901234'
const CODE = `PAL|${ORDER}|17`

async function start(page: Page) {
  const pallets = Array.from({ length: 17 }, (_, i) => ({
    id: `p${i + 1}`, pallet_no: i + 1, carton_no: 318 + i,
    status: i < 12 ? 'loaded' : 'cold_storage', on_this_vehicle: i < 12,
    total_qty: i === 1 ? 24 : 10, total_kg: i === 1 ? 860 : 300,
    scan_code: `PAL|${ORDER}|${i + 1}`,
    items: i === 1 ? [
      { qty: 12, kg_per_unit: 30, recipe_name: 'KIRMIZI', product_type_name: 'UDO', packaging_name: '80 cm' },
      { qty: 10, kg_per_unit: 40, recipe_name: 'BEYAZ', product_type_name: 'UDO', packaging_name: '80 cm' },
      { qty: 2, kg_per_unit: 50, recipe_name: 'BEYAZ', product_type_name: 'UDO', packaging_name: '100 cm' },
    ] : [{ qty: 10, kg_per_unit: 30,
      recipe_name: i === 15 ? 'KIRMIZI DŁUGA NAZWA RECEPTURY DO KARTONU MIESZANEGO' : 'KIRMIZI',
      product_type_name: 'UDO', packaging_name: '80 cm' }],
    weighing: i === 1 || i > 11 ? null : {
      id: `w${i}`, gross_kg: i === 2 ? 358 : 335.5, diff_kg: i === 2 ? 23 : 0.5,
      ok: i !== 2, weighed_at: '2026-10-11T10:00:00Z',
    },
  }))
  const snapshot = () => {
    const totals = { total_pallets: 17, loaded_pallets: pallets.filter(p => p.on_this_vehicle).length,
      total_kg: pallets.reduce((s, p) => s + p.total_kg, 0),
      loaded_kg: pallets.filter(p => p.on_this_vehicle).reduce((s, p) => s + p.total_kg, 0) }
    return { vehicle: { id: 'v1', name: 'SOLÓWKA', plate: 'KR 8842L', kind: 'own' }, totals,
      orders: [{ id: ORDER, order_no: 'Z/12/10/26', client_name: 'KLIENT TESTOWY', pallets, totals }] }
  }
  const m = { requests: [] as Array<{ code: string; action: string; include_vehicle_state?: boolean }>,
    hold: null as Promise<void> | null, unexpected: [] as string[] }
  const respond = (route: Route, body: unknown, status = 200) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(body), headers: {
      'access-control-allow-origin': route.request().headers()['origin'] ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization, content-type, x-render-token',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    },
  })
  await page.addInitScript(() => localStorage.setItem('kebab.token', 'mock'))
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/^.*\/api/, '')
    if (req.method() === 'OPTIONS') return respond(route, {}, 204)
    if (path === '/auth/me') return respond(route, { id: 'u1', name: 'Jan Magazynier', role: 'worker', department: 'magazyn' })
    if (path === '/magazyn/podsumowanie') return respond(route, {
      kartony: { otwarte: 0, sztukDoSpakowania: 0, zalegle: 0, zaczete: [] },
      wydanie: { zamowien: 1, kg: 5660, lista: [] }, mroznia: { palet: 5, lista: [] },
    })
    if (path === '/vehicles') return respond(route, [{ id: 'v1', name: 'SOLÓWKA', plate: 'KR 8842L', kind: 'own', vehicle_type: 'solo', active: true }])
    if (path === '/pallets/active-loading') return respond(route, [])
    if (path === '/pallets/vehicle-state/v1') return respond(route, snapshot())
    if (path === '/pallets/scan') {
      const body = req.postDataJSON()
      m.requests.push(body)
      if (m.hold) await m.hold
      const p = pallets[16]
      p.on_this_vehicle = body.action !== 'undo'
      p.status = p.on_this_vehicle ? 'loaded' : 'cold_storage'
      return respond(route, { ...p, result: 'SUCCESS', order: { id: ORDER, client_name: 'KLIENT TESTOWY' }, vehicle_state: snapshot() })
    }
    m.unexpected.push(`${req.method()} ${path}`)
    return respond(route, [])
  })
  await page.goto('/magazyn.html')
  await expect(page.getByTestId('magazyn-hmi')).toBeVisible({ timeout: 40_000 })
  await page.getByRole('button', { name: /Wydanie.*Załaduj auto/ }).click()
  await page.getByTestId('kafel-auta').filter({ hasText: 'SOLÓWKA' }).click()
  await expect(page.getByTestId('kafel-zaladunku')).toHaveCount(17)
  return m
}

for (const size of [{ width: 1024, height: 768 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test.describe(`załadunek ${size.width}`, () => {
    test.use({ viewport: size, reducedMotion: 'reduce' })
    test('pełny rozpis 17 kartonów, niezależne ważenie i stały pasek po skanie', async ({ page }, info) => {
      const m = await start(page)
      const rows = page.getByTestId('kafel-zaladunku')
      await expect(rows.nth(1)).toContainText('12 × 30 kg KIRMIZI')
      await expect(rows.nth(1)).toContainText('2 × 50 kg BEYAZ')
      await expect(rows.nth(1)).toContainText('100 cm')
      await expect(rows.nth(1)).toContainText('Nie zważony')
      await expect(rows.nth(1)).toContainText('✓ Na aucie')
      await expect(rows.nth(2)).toContainText('Waga niezgodna · +23 kg')
      await expect(rows.first()).toContainText('335,5 kg brutto')
      await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '12')
      const widths = await rows.evaluateAll(es => es.map(e => e.scrollWidth - e.clientWidth))
      expect(Math.max(...widths)).toBeLessThanOrEqual(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
      const row = await rows.first().boundingBox()
      expect(row!.width).toBeGreaterThan(size.width - 60) // jeden szeroki wiersz, nie siatka kart
      await page.screenshot({ path: info.outputPath('zaladunek-lista.png') })

      const pole = page.getByLabel('Pole skanowania')
      await expect(pole).toBeFocused()
      await page.keyboard.type(CODE)
      await page.keyboard.press('Enter')
      const banner = page.getByTestId('potwierdzenie-zaladunku')
      await expect(banner).toContainText('Karton 000334 · KLIENT TESTOWY')
      await expect(banner).toBeInViewport()
      await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '13')
      expect(m.requests).toHaveLength(1)
      expect(m.requests[0].include_vehicle_state).toBe(true)
      await page.getByTestId('lista-zaladunku').evaluate(e => e.scrollTo(0, e.scrollHeight))
      await expect(rows.last()).toBeInViewport()
      await expect(rows.last()).toContainText('✓ Na aucie')
      await expect(rows.last()).toContainText('Nie zważony')
      await expect(pole).toBeInViewport()
      await expect(banner).toBeInViewport()
      await expect(page.getByTestId('postep-zaladunku')).toBeInViewport()
      await page.getByRole('button', { name: /Dołóż zamówienie/ }).click()
      await expect(page.getByRole('region', { name: 'Dostępne zamówienia' })).toBeInViewport()
      expect(m.unexpected).toEqual([])
    })
  })
}

test('wolny POST nie daje fałszywego potwierdzenia i nie blokuje następnego kodu', async ({ page }) => {
  const m = await start(page)
  let release!: () => void
  m.hold = new Promise(resolve => { release = resolve })
  const pole = page.getByLabel('Pole skanowania')
  await page.keyboard.type(CODE)
  await page.keyboard.press('Enter')
  await expect.poll(() => m.requests.length).toBe(1)
  await expect(page.getByTestId('potwierdzenie-zaladunku')).not.toContainText('zapisano na aucie')
  await expect(pole).toBeEnabled()
  await page.keyboard.type(CODE)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('skany-oczekujace')).toContainText('odebrano 2')
  release()
  await expect.poll(() => m.requests.length).toBe(2)
  await expect(page.getByTestId('potwierdzenie-zaladunku')).toContainText('zapisano na aucie')
  await expect(pole).toHaveValue('')
})
