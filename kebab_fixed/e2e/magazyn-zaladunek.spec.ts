import { test, expect, type Page, type Route } from '@playwright/test'

// Zimny Vite + splash kiosku; nie jest to limit czasu potwierdzenia skanu.
test.setTimeout(60_000)

// Wyłącznie mockowane API: żadnych skanów ani zapisów na produkcji.
const ORDER = 'abcdef12345678901234'
const CODE = `PAL|${ORDER}|17`

async function start(page: Page, manyOrders = false) {
  const pallets = Array.from({ length: 17 }, (_, i) => ({
    id: `p${i + 1}`, pallet_no: i + 1, carton_no: 318 + i,
    status: i < 12 ? 'loaded' : 'cold_storage', on_this_vehicle: i < 12,
    location: i < 12 ? null : { slot: `A${i - 11}`, rotation: 0, revision: 'v1' },
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
  const others = Array.from({ length: manyOrders ? 4 : 0 }, (_, i) => ({
    id: `order-${i}`, order_no: `Z/${i + 2}/11/26`, client_name: i === 0 ? 'KLIENT TESTOWY' : ['ZAGROS', 'POLAT', 'NAZAR'][i - 1],
    color_index: i + 1, position: i + 1,
    pallets: [0, 1].map(j => ({ ...pallets[12], id: `other-${i}-${j}`, carton_no: 400 + i * 2 + j,
      scan_code: j ? `SCARTON|other-${i}-${j}` : `PAL|order-${i}|1` })),
    totals: { total_pallets: 2, loaded_pallets: 0, total_kg: 600, loaded_kg: 0 },
  }))
  const snapshot = () => {
    const totals = { total_pallets: 17, loaded_pallets: pallets.filter(p => p.on_this_vehicle).length,
      total_kg: pallets.reduce((s, p) => s + p.total_kg, 0),
      loaded_kg: pallets.filter(p => p.on_this_vehicle).reduce((s, p) => s + p.total_kg, 0) }
    return { vehicle: { id: 'v1', name: 'SOLÓWKA', plate: 'KR 8842L', kind: 'own' },
      totals: { ...totals, total_pallets: totals.total_pallets + others.length * 2, total_kg: totals.total_kg + others.length * 600 },
      orders: [{ id: ORDER, order_no: 'Z/12/10/26', client_name: 'KLIENT TESTOWY', color_index: 0, pallets, totals }, ...others] }
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
    if (path === '/magazyn/mroznia/plan') {
      const cartons = snapshot().orders.flatMap(o => o.pallets.filter(p => p.status === 'cold_storage').map(p => ({
        kind: p.scan_code.startsWith('SCARTON|') ? 'stock' : 'order', id: p.id, code: p.scan_code,
        cartonNo: String(p.carton_no).padStart(6, '0'), clientName: o.client_name, orderNo: o.order_no, orderId: o.id,
        lines: p.items.map(it => ({ qty: it.qty, kgPerUnit: it.kg_per_unit, recipeName: it.recipe_name,
          productTypeName: it.product_type_name, packagingName: it.packaging_name })),
      })))
      cartons.push({ ...cartons[0], id: 'foreign', cartonNo: '009999', orderId: 'another-truck' })
      return respond(route, { columns: [], rows: 7, room: { widthCm: 560, depthCm: 1080, stepCm: 10 },
        cartons: cartons.map((c, i) => ({ ...c, location: c.id === 'other-3-1' ? null : {
          slot: `X${i % 7 * 80}Y${Math.floor(i / 7) * 120}`, xCm: i % 7 * 80, yCm: Math.floor(i / 7) * 120, rotation: 90, revision: 'v1',
        } })), blocked: [] })
    }
    if (path === '/pallets/scan') {
      const body = req.postDataJSON()
      m.requests.push(body)
      if (m.hold) await m.hold
      const p = pallets[16]
      p.on_this_vehicle = body.action !== 'undo'
      p.status = p.on_this_vehicle ? 'loaded' : 'cold_storage'
      p.location = null // cofnięcie wymaga fizycznego wskazania miejsca na nowo
      return respond(route, { ...p, result: 'SUCCESS', order: { id: ORDER, client_name: 'KLIENT TESTOWY' }, vehicle_state: snapshot() })
    }
    m.unexpected.push(`${req.method()} ${path}`)
    return respond(route, [])
  })
  await page.goto('/magazyn.html')
  await expect(page.getByTestId('magazyn-hmi')).toBeVisible({ timeout: 40_000 })
  await page.getByRole('button', { name: /Wydanie.*Załaduj auto/ }).click()
  await page.getByTestId('kafel-auta').filter({ hasText: 'SOLÓWKA' }).click()
  await expect(page.getByTestId('kafel-zaladunku')).toHaveCount(manyOrders ? 25 : 17)
  return m
}

test.describe('kolory załadunku dotykiem', () => {
test.use({ hasTouch: true })
for (const width of [1024, 1366]) {
  test(`kolory pięciu zamówień na aucie i w mroźni ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 768 })
    const m = await start(page, true)
    const nav = page.getByRole('navigation', { name: 'Zamówienia na aucie' })
    await expect(nav.getByRole('button')).toHaveCount(5)
    const fills = await nav.locator('[data-loading-color]').evaluateAll(es => es.map(e => getComputedStyle(e).backgroundColor))
    expect(new Set(fills).size).toBe(5)
    await expect(page.getByTestId('kafel-zaladunku').first().locator('[data-loading-color]')).toHaveAttribute('data-loading-color', '0')
    await page.screenshot({ path: info.outputPath('zamowienia-kolory-lista.png') })
    await page.getByRole('button', { name: 'Rzut mroźni · znajdź karton do załadunku' }).tap()
    const floor = page.getByRole('group', { name: 'Podłoga mroźni' })
    const legend = page.getByRole('region', { name: 'Kolory zamówień do załadunku' })
    await expect(legend).toBeInViewport()
    // The complete floor, especially the door-side row, is visible on entry.
    await expect.poll(async () => {
      const box = await floor.boundingBox()
      const pane = await page.getByLabel('Mapa miejsc mroźni', { exact: true }).boundingBox()
      return !!box && !!pane && box.y >= pane.y && box.y + box.height < pane.y + pane.height
    }).toBe(true)
    for (let i = 0; i < 5; i++) {
      const tiles = floor.locator(`[data-loading-color="${i}"]`)
      await expect(tiles).toHaveCount(i === 0 ? 5 : i === 4 ? 1 : 2)
      await expect(tiles.first()).toHaveCSS('background-color', fills[i])
    }
    await expect(floor.getByRole('button', { name: /^Karton 009999/ })).not.toHaveAttribute('data-loading-color')
    await expect(legend.getByRole('button', { name: /K5/ })).toContainText('W mroźni: 2 · bez położenia: 1')
    await page.screenshot({ path: info.outputPath('mroznia-piec-kolorow.png') })
    await page.getByRole('button', { name: 'Powiększ mapę' }).tap()
    await expect(floor.locator('[data-loading-color="1"]').first()).toHaveCSS('background-color', fills[1])
    await page.getByRole('button', { name: 'Zmniejsz mapę' }).tap()
    await legend.getByRole('button', { name: /K2/ }).tap()
    await expect(page.getByTestId('karton-zawartosc')).toHaveCount(2)
    await legend.getByRole('button', { name: /Wszystkie zamówienia/ }).tap()
    await page.getByRole('button', { name: /Szukaj kartonu, klienta/ }).tap()
    const keyboard = page.getByRole('dialog', { name: /Klawiatura/ })
    for (const digit of ['4', '0', '0']) await keyboard.getByRole('button', { name: digit, exact: true }).tap()
    await keyboard.getByRole('button', { name: 'Gotowe' }).tap()
    const found = floor.getByRole('button', { name: /^Karton 000400/ })
    await expect(found).toHaveAttribute('data-highlighted', 'true')
    await expect(found).toHaveCSS('background-color', fills[1])
    await expect(found).toHaveCSS('animation-name', 'mroznia-found-order')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(found).toHaveCSS('animation-name', 'none')
    await expect(found).toHaveCSS('background-color', fills[1])
    await page.getByRole('button', { name: 'Zamknij mapę' }).tap()
    // Loading removes the carton from the map, but never recolours its order.
    await page.getByLabel('Pole skanowania').fill(CODE)
    await page.getByLabel('Pole skanowania').press('Enter')
    await expect(page.getByTestId('potwierdzenie-zaladunku')).toContainText('zapisano na aucie')
    await page.getByRole('button', { name: 'Rzut mroźni · znajdź karton do załadunku' }).tap()
    await expect(floor.locator('[data-loading-color="0"]')).toHaveCount(4)
    await expect(floor.locator('[data-loading-color="1"]').first()).toHaveCSS('background-color', fills[1])
    expect(m.unexpected).toEqual([])
  })
}
})

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
      await expect(rows.nth(12)).toContainText('Mroźnia · A1')
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
