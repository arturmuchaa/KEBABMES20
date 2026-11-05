import { test, expect, type Page } from '@playwright/test'

test.setTimeout(60_000)
test.use({ hasTouch: true })

async function start(page: Page, dense = false) {
  const carton = { kind: 'stock', id: '12345678901234567890', code: 'SCARTON|12345678901234567890', cartonNo: '000123',
    clientName: 'YALCIN', orderNo: 'Z/1', location: null as null | { slot: string; rotation: number; revision: string },
    lines: [{ qty: 12, kgPerUnit: 15, recipeName: 'KIRMIZI', productTypeName: 'UDO 100%', packagingName: 'METAL 80' },
      { qty: 6, kgPerUnit: 25, recipeName: 'YAPRAK', productTypeName: 'WOŁOWINA', packagingName: 'PAPIER 100' }] }
  const saved: unknown[] = []
  const swaps: unknown[] = []
  let blocked: { slot: string; description: string; revision: string; operator: string; updatedAt: string }[] = []
  const others = dense ? Array.from({ length: 63 }, (_, i) => `${'ABCDEFGHI'[i % 9]}${Math.floor(i / 9) + 1}`)
    .filter(slot => slot !== 'C4').map((slot, i) => ({ ...carton, id: `other${i}`, cartonNo: `${i + 1000}`.padStart(6, '0'),
      clientName: i % 2 ? 'ZAGROS' : 'BARDZO DŁUGA NAZWA KLIENTA', clientShortName: i % 2 ? '' : 'YALCIN',
      location: { slot, rotation: 90, revision: 'v1' } })) : []
  const unexpected: string[] = []
  await page.addInitScript(() => localStorage.setItem('kebab.token', 'mock'))
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/^.*\/api/, '')
    const respond = (data: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
    if (path === '/auth/me') return respond({ id: 'u1', name: 'Magazynier', role: 'worker', department: 'magazyn' })
    if (path === '/magazyn/podsumowanie') return respond({ kartony: { otwarte: 0 }, wydanie: { zamowien: 0, kg: 0 }, mroznia: { palet: 1 } })
    if (path === '/magazyn/mroznia/palety') return respond({ pallets: [] })
    if (path === '/pallets/in-cold-storage') return respond([])
    if (path === '/magazyn/mroznia/kartony') return respond([{ ...carton, packedQty: 18, targetQty: 18, kg: 330, full: true, coldStorageAt: '' }])
    if (path === '/magazyn/mroznia/wazenia') return respond({})
    if (path === '/magazyn/mroznia/plan') return respond({ columns: [...'ABCDEFGHI'], rows: 7,
      cartons: [carton, ...others], blocked })
    if (path === '/magazyn/mroznia/zajete') {
      const b = req.postDataJSON()
      const mark = { slot: b.slot, description: b.description || 'Miejsce zajęte', revision: 'manual1', operator: 'Jan', updatedAt: '' }
      blocked = [mark]
      return respond(mark)
    }
    if (path === '/magazyn/mroznia/zajete/zwolnij') { blocked = []; return respond({ ok: true }) }
    if (path === '/magazyn/mroznia/zamiana') {
      const body = req.postDataJSON()
      swaps.push(body)
      const all = [carton, ...others]
      const a = all.find(c => c.id === body.first.container_id)!, b = all.find(c => c.id === body.second.container_id)!
      const first = { ...b.location!, revision: 'swap-a' }, second = { ...a.location!, revision: 'swap-b' }
      a.location = first; b.location = second
      return respond({ first, second })
    }
    if (path === '/magazyn/mroznia/lokalizacja') {
      const body = req.postDataJSON()
      saved.push(body)
      carton.location = { slot: body.slot, rotation: body.rotation, revision: 'v1' }
      return respond(carton.location)
    }
    unexpected.push(`${req.method()} ${path}`)
    return respond([])
  })
  await page.goto('/magazyn.html')
  await expect(page.getByTestId('magazyn-hmi')).toBeVisible({ timeout: 40_000 })
  await page.getByRole('button', { name: /Mroźnia/ }).first().click()
  await expect(page.getByTestId('wiersz-mrozni')).toContainText('12 szt × 15 kg · KIRMIZI')
  await expect(page.getByTestId('wiersz-mrozni')).toContainText('tuleja: PAPIER 100')
  return { saved, unexpected, swaps }
}

for (const width of [1024, 1366]) {
  test(`okno ${width}: cały rzut, klient, receptury, pełne tuleje, szczegóły i zielone wyszukiwanie`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 768 })
    const m = await start(page, true)
    await page.getByRole('button', { name: 'Rzut mroźni · znajdź karton' }).tap()
    const map = page.getByLabel('Stałe miejsca mroźni')
    await expect(map.getByRole('button')).toHaveCount(63)
    // A window, not full screen.
    const dialog = (await page.getByRole('dialog').boundingBox())!
    expect(dialog.width).toBeLessThan(width - 20)
    expect(dialog.height).toBeLessThan(748)
    expect(dialog.x).toBeGreaterThan(10)
    expect(dialog.y).toBeGreaterThan(10)
    // All 63 places at once: back row, door row, no scrolling.
    await expect(map.getByRole('button', { name: /^A7 ·/ })).toBeInViewport({ ratio: 1 })
    await expect(map.getByRole('button', { name: /^I1 ·/ })).toBeInViewport({ ratio: 1 })
    expect(await page.getByLabel('Mapa miejsc mroźni', { exact: true }).evaluate(e => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(1)
    const tile = (await map.getByRole('button').first().boundingBox())!
    expect(tile.width).toBeGreaterThan(90)
    expect(tile.height).toBeGreaterThan(78)
    const first = map.getByRole('button').first()
    await expect(first.locator('.mroznia-tile-client')).toHaveText('ZAGROS')
    await expect(first.locator('.mroznia-tile-recipe')).toHaveText('KIRMIZI / YAPRAK')
    await expect(first.locator('.mroznia-tube').first()).toHaveText('METAL 80cm')
    await expect(map).not.toContainText(/niestandard|MIX/i)
    // No text is cut through a line or drawn over another one.
    expect(await map.locator('.mroznia-tile.is-carton').evaluateAll(tiles => tiles.every(t => {
      const box = t.getBoundingClientRect(), pad = parseFloat(getComputedStyle(t).paddingBottom)
      const parts = Array.from(t.children).map(c => c.getBoundingClientRect()).filter(r => r.height > 0)
      return parts.every((r, i) => r.bottom <= box.bottom - pad + 1 && (i === 0 || r.top >= parts[i - 1].bottom - 1))
    }))).toBe(true)
    await page.screenshot({ path: info.outputPath('okno-czytelne-kafelki.png') })
    // Details float beside the tile; the plan keeps its size and every row.
    await map.getByRole('button', { name: /^A1 ·/ }).tap()
    const card = page.getByRole('complementary', { name: 'Szczegóły kartonu 001000' })
    await expect(card).toContainText('YALCIN')
    await expect(card).toContainText('BARDZO DŁUGA NAZWA KLIENTA')
    await expect(card).toContainText('12 szt × 15 kg · KIRMIZI')
    await expect(card).toContainText('tuleja: PAPIER 100cm')
    await expect(card.getByRole('button', { name: 'Przenieś / obróć' })).toBeInViewport({ ratio: 1 })
    expect((await card.boundingBox())!.x).toBeGreaterThan(width / 2)
    await expect(map.getByRole('button', { name: /^A1 ·/ })).toBeInViewport({ ratio: 1 })
    expect((await map.getByRole('button').first().boundingBox())!.height).toBeCloseTo(tile.height)
    await page.screenshot({ path: info.outputPath('szczegoly-kartonu.png') })
    await page.getByRole('button', { name: 'Zamknij szczegóły' }).tap()
    const before = await map.boundingBox()
    await page.getByRole('button', { name: /Szukaj kartonu/ }).tap()
    const keyboard = page.getByRole('dialog', { name: /Klawiatura/ })
    for (const key of ['1', '0', '0', '2']) await keyboard.getByRole('button', { name: key, exact: true }).tap()
    await keyboard.getByRole('button', { name: 'Gotowe' }).tap()
    const target = map.getByRole('button', { name: /Karton 001002 ·/ })
    await expect(target).toHaveAttribute('data-highlighted', 'true')
    await expect(target).toBeInViewport({ ratio: 1 })
    await expect(target).toHaveCSS('animation-name', 'mroznia-found-green')
    await expect(target.locator('.mroznia-tile-client')).toHaveText('YALCIN')
    await expect(map.locator('[data-highlighted="true"]')).toHaveCount(1)
    await expect(page.getByRole('status').filter({ hasText: 'Znaleziono: 1' })).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Szczegóły kartonu 001002' })).toBeVisible()
    // Searching never resizes the plan; the door label stays below the door row.
    expect((await map.boundingBox())!.height).toBeCloseTo(before!.height, 0)
    const doorRow = await map.getByRole('button', { name: /^I1 ·/ }).boundingBox()
    const door = await page.getByText('Drzwi mroźnicze · wejście ↑').boundingBox()
    expect(door!.y).toBeGreaterThanOrEqual(doorRow!.y + doorRow!.height)
    expect(await page.getByRole('dialog').evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: info.outputPath('znaleziony-karton-zielony.png') })
    // Reduced motion keeps the green marker; only movement is disabled.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(target).toHaveCSS('animation-name', 'none')
    await expect(target).toHaveCSS('outline-color', 'rgb(31, 146, 84)')
    await page.getByRole('button', { name: 'Wyczyść filtr' }).tap()
    await expect(map.locator('[data-highlighted="true"]')).toHaveCount(0)
    expect(m.saved).toEqual([])
    expect(m.unexpected).toEqual([])
  })

  test(`mapa ${width}: zawartość, obrót, zapis i widoczna lokalizacja`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 768 })
    const m = await start(page, true)
    expect(await page.getByTestId('wiersz-mrozni').evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: info.outputPath('lista-mrozni.png') })
    await page.getByRole('button', { name: 'Bez miejsca · wskaż na mapie' }).click()
    await expect(page.getByRole('dialog')).toContainText('63 stałe miejsca')
    const floor = page.getByLabel('Stałe miejsca mroźni')
    await expect(floor.getByRole('button')).toHaveCount(63)
    await expect(floor.getByRole('button', { name: /Karton \d+ ·/ })).toHaveCount(62)
    await expect(floor.getByRole('button', { name: /^A1 ·/ })).toBeDisabled()
    await page.getByRole('button', { name: 'C4 · wolne' }).tap()
    const before = await floor.getByRole('button', { name: 'C4 · wolne' }).boundingBox()
    await page.getByRole('button', { name: 'Obróć o 90°' }).click()
    expect(await floor.getByRole('button', { name: 'C4 · wolne' }).boundingBox()).toEqual(before)
    await expect(page.getByText('Krótszym bokiem od drzwi', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zapisz miejsce' })).toBeInViewport()
    await page.screenshot({ path: info.outputPath('mapa-mrozni.png'), fullPage: true })
    const dialog = await page.getByRole('dialog').boundingBox()
    expect(dialog!.x).toBeGreaterThanOrEqual(0)
    expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(width)
    await page.getByRole('button', { name: 'Zapisz miejsce' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('wiersz-mrozni')).toContainText('Miejsce C4 · krótszym bokiem od drzwi')
    expect(m.saved).toEqual([{ kind: 'stock', container_id: '12345678901234567890', slot: 'C4', rotation: 90, expected_revision: null }])
    expect(m.unexpected).toEqual([])
  })
}

test('zamiana kartonów zajmujących sąsiednie miejsca: jedna operacja dotykiem', async ({ page }, info) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  const m = await start(page, true)
  await page.getByRole('button', { name: 'Rzut mroźni · znajdź karton' }).tap()
  const map = page.getByLabel('Stałe miejsca mroźni')
  await map.getByRole('button', { name: /Karton 001000 ·/ }).tap()
  await page.getByRole('button', { name: 'Zamień miejscami' }).tap()
  await expect(page.getByRole('button', { name: 'Zapisz zamianę' })).toBeDisabled()
  await map.getByRole('button', { name: /Karton 001001 ·/ }).tap()
  const preview = page.getByRole('region', { name: 'Podgląd zamiany' })
    await expect(preview).toContainText('001000 · YALCIN → Miejsce B1')
  await expect(preview).toContainText('001001 · ZAGROS → Miejsce A1')
  await expect(preview).toBeInViewport()
  await page.screenshot({ path: info.outputPath('zamiana-podglad.png') })
  await page.getByRole('button', { name: 'Zapisz zamianę' }).tap()
  await expect(page.getByText('Zamieniono miejscami kartony 001000 i 001001.')).toBeVisible()
  await expect(map.getByRole('button', { name: /Karton 001000 ·/ })).toHaveAttribute('data-slot', 'B1')
  await expect(map.getByRole('button', { name: /Karton 001001 ·/ })).toHaveAttribute('data-slot', 'A1')
  expect(m.swaps).toEqual([{ first: { kind: 'stock', container_id: 'other0', expected_revision: 'v1' },
    second: { kind: 'stock', container_id: 'other1', expected_revision: 'v1' } }])
  expect(m.saved).toEqual([])
  expect(m.unexpected).toEqual([])
})

test('mapa na wąskim ekranie: dotykowy wybór i zapis bez fizycznej klawiatury', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: 'Bez miejsca · wskaż na mapie' }).click()
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: 'A1 · wolne' }).tap()
  const save = page.getByRole('button', { name: 'Zapisz miejsce' })
  const overflow = await page.getByRole('dialog').evaluate(e => e.scrollWidth - e.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await save.tap()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('nietypowy towar: ręczne zajęcie, blokada dla palety i potwierdzone zwolnienie', async ({ page }, info) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  const m = await start(page)
  await page.getByRole('button', { name: 'Rzut mroźni · znajdź karton' }).click()
  await page.getByRole('button', { name: 'A1 · wolne' }).tap()
  await page.getByRole('button', { name: /Wpisz produkt/ }).tap()
  const keyboard = page.getByRole('dialog', { name: /Klawiatura/ })
  for (const key of ['Aa', 'Ł', 'Aa', 'ó', 'j', 'Spacja', 'w', 'o', 'ł', 'o', 'w', 'y'])
    await keyboard.getByRole('button', { name: key, exact: true }).tap()
  await expect(keyboard.getByRole('textbox')).toHaveValue('Łój wołowy')
  await page.screenshot({ path: info.outputPath('klawiatura-dotykowa.png') })
  await keyboard.getByRole('button', { name: 'Gotowe', exact: true }).tap()
  await page.getByRole('button', { name: 'Zapisz towar' }).tap()
  await expect(page.getByRole('button', { name: 'A1 · zajęte · Łój wołowy' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('zajete-recznie.png') })
  await page.getByRole('button', { name: 'Zamknij mapę' }).click()
  await page.getByRole('button', { name: 'Bez miejsca · wskaż na mapie' }).click()
  await expect(page.getByRole('button', { name: 'A1 · zajęte · Łój wołowy' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Zapisz miejsce' })).toBeDisabled()
  await page.getByRole('button', { name: 'B1 · wolne' }).tap()
  await expect(page.getByRole('button', { name: 'Zapisz miejsce' })).toBeEnabled()
  await page.getByRole('button', { name: 'Zamknij mapę' }).click()
  await page.getByRole('button', { name: 'Rzut mroźni · znajdź karton' }).click()
  await page.getByRole('button', { name: 'A1 · zajęte · Łój wołowy' }).tap()
  await page.getByRole('button', { name: 'Zwolnij miejsce', exact: true }).click()
  await page.getByRole('button', { name: 'Tak, zwolnij miejsce' }).click()
  await expect(page.getByRole('button', { name: 'A1 · zajęte · Łój wołowy' })).toHaveCount(0)
  expect(m.saved).toEqual([])
  expect(m.unexpected).toEqual([])
})
