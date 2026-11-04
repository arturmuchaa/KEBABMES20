import { test, expect, type Page } from '@playwright/test'

test.setTimeout(60_000)
test.use({ hasTouch: true })

async function start(page: Page, dense = false) {
  const carton = { kind: 'stock', id: '12345678901234567890', code: 'SCARTON|12345678901234567890', cartonNo: '000123',
    clientName: 'YALCIN', orderNo: 'Z/1', location: null as null | { slot: string; rotation: number; revision: string; xCm: number; yCm: number },
    lines: [{ qty: 12, kgPerUnit: 15, recipeName: 'KIRMIZI', productTypeName: 'UDO 100%', packagingName: 'METAL 80' },
      { qty: 6, kgPerUnit: 25, recipeName: 'YAPRAK', productTypeName: 'WOŁOWINA', packagingName: 'PAPIER 100' }] }
  const saved: unknown[] = []
  const swaps: unknown[] = []
  let blocked: { slot: string; description: string; revision: string; operator: string; updatedAt: string; xCm: number; yCm: number; rotation: number }[] = []
  const others = dense ? Array.from({ length: 63 }, (_, i) => ({ x: i % 7 * 80, y: Math.floor(i / 7) * 120 }))
    .filter(p => p.x !== 160 || p.y !== 360).map((p, i) => ({ ...carton, id: `other${i}`, cartonNo: `${i + 1000}`.padStart(6, '0'),
      clientName: i % 2 ? 'ZAGROS' : 'BARDZO DŁUGA NAZWA KLIENTA', location: { slot: `X${p.x}Y${p.y}`, xCm: p.x, yCm: p.y, rotation: 90, revision: 'v1' } })) : []
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
      room: { widthCm: 560, depthCm: 1080, stepCm: 10 }, cartons: [carton, ...others], blocked })
    if (path === '/magazyn/mroznia/zajete') {
      const b = req.postDataJSON()
      const mark = { slot: b.slot, description: b.description || 'Miejsce zajęte', revision: 'manual1', operator: 'Jan', updatedAt: '',
        xCm: b.x_cm, yCm: b.y_cm, rotation: b.rotation }
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
      carton.location = { slot: `X${body.x_cm}Y${body.y_cm}`, xCm: body.x_cm, yCm: body.y_cm, rotation: body.rotation, revision: 'v1' }
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
  test(`zawartość i zielone wyszukiwanie ${width}: dotyk, receptury, tuleje, zachowana skala`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 768 })
    const m = await start(page, true)
    await page.getByRole('button', { name: 'Rzut mroźni · znajdź karton' }).tap()
    const cards = page.getByTestId('karton-zawartosc')
    await expect(cards).toHaveCount(63)
    await expect(cards.first()).toContainText('12 szt × 15 kg · KIRMIZI')
    await expect(cards.first()).toContainText('6 szt × 25 kg · YAPRAK')
    await expect(cards.first()).toContainText('tuleja: PAPIER 100 · niestandard')
    await page.screenshot({ path: info.outputPath('zawartosc-na-wejsciu.png') })
    await page.getByRole('button', { name: 'Powiększ mapę' }).tap()
    const map = page.getByLabel('Podłoga mroźni')
    const before = await map.boundingBox()
    await page.getByRole('button', { name: /Szukaj kartonu/ }).tap()
    const keyboard = page.getByRole('dialog', { name: /Klawiatura/ })
    for (const key of ['1', '0', '0', '2']) await keyboard.getByRole('button', { name: key, exact: true }).tap()
    await keyboard.getByRole('button', { name: 'Gotowe' }).tap()
    await expect(cards).toHaveCount(1)
    const target = map.getByRole('button', { name: /^Karton 001002 ·/ })
    await expect(target).toHaveAttribute('data-highlighted', 'true')
    await expect(target).toBeInViewport()
    await expect(target).toHaveCSS('animation-name', 'mroznia-found-green')
    await expect(target.getByText('MIX · 2 receptury')).toBeVisible()
    await expect(map.locator('[data-highlighted="true"]')).toHaveCount(1)
    const after = await map.boundingBox()
    expect(after!.width).toBeCloseTo(before!.width)
    expect(after!.height).toBeCloseTo(before!.height)
    expect(await page.getByRole('dialog').evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: info.outputPath('znaleziony-karton-zielony.png') })
    // Reduced motion keeps the green marker; only movement is disabled.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(target).toHaveCSS('animation-name', 'none')
    await expect(target).toHaveCSS('background-color', 'rgb(187, 247, 208)')
    await page.getByRole('button', { name: 'Wyczyść filtr' }).tap()
    await expect(map.locator('[data-highlighted="true"]')).toHaveCount(0)
    await expect(cards).toHaveCount(63)
    expect(m.saved).toEqual([])
    expect(m.unexpected).toEqual([])
  })

  test(`mapa ${width}: zawartość, obrót, zapis i widoczna lokalizacja`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 768 })
    const m = await start(page, true)
    expect(await page.getByTestId('wiersz-mrozni').evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: info.outputPath('lista-mrozni.png') })
    await page.getByRole('button', { name: 'Bez miejsca · wskaż na mapie' }).click()
    await expect(page.getByRole('dialog')).toContainText('Rzut mroźni · 560 × 1080 cm')
    await expect(page.getByRole('button', { name: /^Karton \d+ ·/ })).toHaveCount(62)
    const floor = await page.getByLabel('Podłoga mroźni').boundingBox()
    expect(floor!.height / floor!.width).toBeCloseTo(1080 / 560, 1)
    await page.getByRole('button', { name: 'Pokaż pierwsze wolne położenie' }).tap()
    const narrow = await page.getByLabel('Podgląd palety').boundingBox()
    await page.getByRole('button', { name: 'Obróć o 90°' }).click()
    const wide = await page.getByLabel('Podgląd palety').boundingBox()
    expect(wide!.width / narrow!.width).toBeCloseTo(1.5, 1)
    expect(wide!.height / narrow!.height).toBeCloseTo(2 / 3, 1)
    await expect(page.getByRole('alert')).toContainText('nachodzi')
    await expect(page.getByRole('button', { name: 'Zapisz miejsce' })).toBeDisabled()
    await page.getByRole('button', { name: 'Obróć o 90°' }).tap()
    await expect(page.getByRole('button', { name: 'Zapisz miejsce' })).toBeInViewport()
    await page.screenshot({ path: info.outputPath('mapa-mrozni.png'), fullPage: true })
    const dialog = await page.getByRole('dialog').boundingBox()
    expect(dialog!.x).toBeGreaterThanOrEqual(0)
    expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(width)
    await page.getByRole('button', { name: 'Zapisz miejsce' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('wiersz-mrozni')).toContainText('X 160 · Y 360 cm · bok 80 cm od drzwi')
    expect(m.saved).toEqual([{ kind: 'stock', container_id: '12345678901234567890', x_cm: 160, y_cm: 360, rotation: 90, expected_revision: null }])
    expect(m.unexpected).toEqual([])
  })
}

test('zamiana kartonów zajmujących sąsiednie miejsca: jedna operacja dotykiem', async ({ page }, info) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  const m = await start(page, true)
  await page.getByRole('button', { name: 'Rzut mroźni · znajdź karton' }).tap()
  const map = page.getByLabel('Podłoga mroźni')
  await map.getByRole('button', { name: /^Karton 001000 ·/ }).tap()
  await page.getByRole('button', { name: 'Zamień miejscami' }).tap()
  await expect(page.getByRole('button', { name: 'Zapisz zamianę' })).toBeDisabled()
  await map.getByRole('button', { name: /^Karton 001001 ·/ }).tap()
  const preview = page.getByRole('region', { name: 'Podgląd zamiany' })
  await expect(preview).toContainText('001000 · BARDZO DŁUGA NAZWA KLIENTA → X 80 · Y 0 cm')
  await expect(preview).toContainText('001001 · ZAGROS → X 0 · Y 0 cm')
  await expect(preview).toBeInViewport()
  await page.screenshot({ path: info.outputPath('zamiana-podglad.png') })
  await page.getByRole('button', { name: 'Zapisz zamianę' }).tap()
  await expect(page.getByText('Zamieniono miejscami kartony 001000 i 001001.')).toBeVisible()
  await expect(map.getByRole('button', { name: /^Karton 001000 ·/ })).toHaveAttribute('aria-label', /X 80 · Y 0 cm/)
  await expect(map.getByRole('button', { name: /^Karton 001001 ·/ })).toHaveAttribute('aria-label', /X 0 · Y 0 cm/)
  expect(m.swaps).toEqual([{ first: { kind: 'stock', container_id: 'other0', expected_revision: 'v1' },
    second: { kind: 'stock', container_id: 'other1', expected_revision: 'v1' } }])
  expect(m.saved).toEqual([])
  expect(m.unexpected).toEqual([])
})

test('mapa na wąskim ekranie: dotykowy wybór i zapis bez fizycznej klawiatury', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: 'Bez miejsca · wskaż na mapie' }).click()
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: 'Pokaż pierwsze wolne położenie' }).tap()
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
  await page.getByRole('button', { name: 'Dodaj towar ręcznie' }).tap()
  await page.getByRole('button', { name: /Wpisz produkt/ }).tap()
  const keyboard = page.getByRole('dialog', { name: /Klawiatura/ })
  for (const key of ['Aa', 'Ł', 'Aa', 'ó', 'j', 'Spacja', 'w', 'o', 'ł', 'o', 'w', 'y'])
    await keyboard.getByRole('button', { name: key, exact: true }).tap()
  await expect(keyboard.getByRole('textbox')).toHaveValue('Łój wołowy')
  await page.screenshot({ path: info.outputPath('klawiatura-dotykowa.png') })
  await keyboard.getByRole('button', { name: 'Gotowe', exact: true }).tap()
  await page.getByRole('button', { name: 'Pokaż pierwsze wolne położenie' }).tap()
  await page.getByRole('button', { name: 'Zapisz towar i położenie' }).tap()
  await expect(page.getByRole('button', { name: 'Towar ręczny · Łój wołowy' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('zajete-recznie.png') })
  await page.getByRole('button', { name: 'Zamknij mapę' }).click()
  await page.getByRole('button', { name: 'Bez miejsca · wskaż na mapie' }).click()
  await page.getByRole('button', { name: 'Pokaż pierwsze wolne położenie' }).tap()
  await expect(page.getByText(/Od lewej ściany: 80 cm/)).toBeVisible()
  await page.getByRole('button', { name: 'Obróć o 90°' }).tap()
  await page.getByRole('button', { name: '← 10 cm', exact: true }).tap()
  await expect(page.getByRole('alert')).toContainText('nachodzi')
  await expect(page.getByRole('button', { name: 'Zapisz miejsce' })).toBeDisabled()
  await page.getByRole('button', { name: 'Zamknij mapę' }).click()
  await page.getByRole('button', { name: 'Rzut mroźni · znajdź karton' }).click()
  await page.getByRole('button', { name: 'Towar ręczny · Łój wołowy' }).tap()
  await page.getByRole('button', { name: 'Zwolnij miejsce', exact: true }).click()
  await page.getByRole('button', { name: 'Tak, zwolnij miejsce' }).click()
  await expect(page.getByRole('button', { name: 'Towar ręczny · Łój wołowy' })).toHaveCount(0)
  expect(m.saved).toEqual([])
  expect(m.unexpected).toEqual([])
})
