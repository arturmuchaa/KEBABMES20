import { test, expect, type Page } from '@playwright/test'

test.setTimeout(60_000)

async function start(page: Page, dense = false) {
  const carton = { kind: 'stock', id: '12345678901234567890', code: 'SCARTON|12345678901234567890', cartonNo: '000123',
    clientName: 'YALCIN', orderNo: 'Z/1', location: null as null | { slot: string; rotation: number; revision: string },
    lines: [{ qty: 12, kgPerUnit: 15, recipeName: 'KIRMIZI', productTypeName: 'UDO 100%', packagingName: 'METAL 80' },
      { qty: 6, kgPerUnit: 25, recipeName: 'YAPRAK', productTypeName: 'WOŁOWINA', packagingName: 'PAPIER 100' }] }
  const saved: unknown[] = []
  let blocked: { slot: string; description: string; revision: string; operator: string; updatedAt: string }[] = []
  const others = dense ? [...'ABCDEFGHI'].flatMap(col => Array.from({ length: 7 }, (_, i) => `${col}${i + 1}`))
    .filter(slot => slot !== 'C4').map((slot, i) => ({ ...carton, id: `other${i}`, cartonNo: `${i + 1000}`.padStart(6, '0'),
      clientName: i % 2 ? 'ZAGROS' : 'BARDZO DŁUGA NAZWA KLIENTA', location: { slot, rotation: i % 2 ? 90 : 0, revision: 'v1' } })) : []
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
    if (path === '/magazyn/mroznia/plan') return respond({ columns: [...'ABCDEFGHI'], rows: 7, cartons: [carton, ...others], blocked })
    if (path === '/magazyn/mroznia/zajete') {
      const b = req.postDataJSON()
      const mark = { slot: b.slot, description: b.description || 'Miejsce zajęte', revision: 'manual1', operator: 'Jan', updatedAt: '' }
      blocked = [mark]
      return respond(mark)
    }
    if (path === '/magazyn/mroznia/zajete/zwolnij') { blocked = []; return respond({ ok: true }) }
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
  return { saved, unexpected }
}

for (const width of [1024, 1366]) {
  test(`mapa ${width}: zawartość, obrót, zapis i widoczna lokalizacja`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 768 })
    const m = await start(page, true)
    expect(await page.getByTestId('wiersz-mrozni').evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: info.outputPath('lista-mrozni.png') })
    await page.getByRole('button', { name: 'Bez miejsca · wskaż na mapie' }).click()
    await expect(page.getByRole('dialog')).toContainText('Wybierz miejsce · karton 000123')
    await expect(page.getByRole('button', { name: /^[A-I][1-7] ·/ })).toHaveCount(63)
    await page.getByRole('button', { name: 'C4 · wolne' }).click()
    await page.getByRole('button', { name: 'Obróć o 90°' }).click()
    await expect(page.getByText('Krótszym bokiem od drzwi', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^A7 ·/ })).toBeInViewport()
    await expect(page.getByRole('button', { name: /^A1 ·/ })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Zapisz miejsce' })).toBeInViewport()
    await page.screenshot({ path: info.outputPath('mapa-mrozni.png'), fullPage: true })
    const dialog = await page.getByRole('dialog').boundingBox()
    expect(dialog!.x).toBeGreaterThanOrEqual(0)
    expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(width)
    await page.getByRole('button', { name: 'Zapisz miejsce' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('wiersz-mrozni')).toContainText('Miejsce C4 · krótszym bokiem')
    expect(m.saved).toEqual([{ kind: 'stock', container_id: '12345678901234567890', slot: 'C4', rotation: 90, expected_revision: null }])
    expect(m.unexpected).toEqual([])
  })
}

test('mapa na wąskim ekranie: przewija się wewnątrz, zapis dostępny klawiaturą', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: 'Bez miejsca · wskaż na mapie' }).click()
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: 'I7 · wolne' }).focus()
  await page.keyboard.press('Enter')
  const save = page.getByRole('button', { name: 'Zapisz miejsce' })
  await save.focus()
  await expect(save).toBeInViewport()
  const overflow = await page.getByRole('dialog').evaluate(e => e.scrollWidth - e.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('nietypowy towar: ręczne zajęcie, blokada dla palety i potwierdzone zwolnienie', async ({ page }, info) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  const m = await start(page)
  await page.getByRole('button', { name: 'Rzut mroźni · znajdź karton' }).click()
  await page.getByRole('button', { name: 'A1 · wolne' }).click()
  await page.getByLabel('Co zajmuje miejsce (opcjonalnie)').fill('Łój wołowy')
  await page.getByRole('button', { name: 'Oznacz jako zajęte' }).click()
  await expect(page.getByRole('button', { name: 'A1 · zajęte · Łój wołowy' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('zajete-recznie.png') })
  await page.getByRole('button', { name: 'Zamknij mapę' }).click()
  await page.getByRole('button', { name: 'Bez miejsca · wskaż na mapie' }).click()
  await expect(page.getByRole('button', { name: 'A1 · zajęte · Łój wołowy' })).toBeDisabled()
  await page.getByRole('button', { name: 'Zamknij bez zmiany miejsca' }).click()
  await page.getByRole('button', { name: 'Rzut mroźni · znajdź karton' }).click()
  await page.getByRole('button', { name: 'A1 · zajęte · Łój wołowy' }).click()
  await page.getByRole('button', { name: 'Zwolnij miejsce', exact: true }).click()
  await page.getByRole('button', { name: 'Tak, zwolnij miejsce' }).click()
  await expect(page.getByRole('button', { name: 'A1 · wolne' })).toBeVisible()
  expect(m.saved).toEqual([])
  expect(m.unexpected).toEqual([])
})
