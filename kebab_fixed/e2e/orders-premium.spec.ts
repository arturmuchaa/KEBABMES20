import { test, expect, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'

const item = (id: string, name: string, qty: number, weight: number, done: number, packaging = 'METAL 65 cm') => ({
  id, recipe_id: id === 'b' ? 'r2' : 'r1', recipe_name: name, product_type_id: 'udo', product_type_name: 'KEBAB UDO 100%',
  packaging_id: packaging.includes('80') ? 'pkg80' : 'pkg', packaging_name: packaging, qty, kg_per_unit: weight, total_kg: qty * weight,
  qty_done: done, qty_stock: done, qty_delivered: 0,
  fulfillment: { ordered_kg: qty * weight, stock_kg: done * weight, delivered_kg: 0, covered_kg: done * weight, remaining_kg: (qty - done) * weight },
  production: { reported_qty: done, reported_kg: done * weight, remaining_qty: qty - done, remaining_kg: (qty - done) * weight, unposted_qty: 0, source: 'linked_plan_reports' },
  mixing: { remaining_qty: qty - done, remaining_kg: (qty - done) * weight, meat_kg: (qty - done) * weight / 1.25, additives_kg: (qty - done) * weight / 5, output_per_100kg: 125, growth_pct: 25, reason: null, source: 'recipe_ingredients_per_100kg' },
})
const order = { id: 'o1', order_no: 'YALCIN/Z/17/10/26', client_id: 'c', client_name: 'YALCIN', status: 'confirmed', order_date: '2026-10-15', delivery_date: '2026-10-20', total_kg: 1600, total_units: 60,
  lines: [item('a', 'AFIYET BEYAZ', 40, 20, 5), item('b', 'GUSTO KIRMIZI', 20, 40, 18, 'METAL 80 cm')], notes: 'WEWNĘTRZNA UWAGA magazynu' }
const carton = { carton_id: 'sc1', carton_no: 77, units: 4, target_qty: 4, packed_qty: 4, status: 'packed', in_cold_storage: true, client_name: 'YALCIN', batches: ['B/15/10'], can_detach: true,
  lines: [{ recipe_name: 'AFIYET BEYAZ', product_type_name: 'KEBAB UDO 100%', packaging_name: 'METAL 65 cm', packed_qty: 4, target_qty: 4, kg_per_unit: 20 }] }

async function setup(page: Page, count = 2) {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => localStorage.setItem('kebab.token', 'premium-ui-test'))
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname
    if (!pathname.startsWith('/api/')) return route.continue()
    const path = pathname.slice(4)
    let json: unknown = []
    if (path === '/auth/me') json = { id: 'ui', kind: 'office', role: 'admin', name: 'Planista testowy', departments: [] }
    if (path === '/client-orders') json = [order, { ...order, id: 'o2', order_no: 'TRUVA/Z/3/10/26', client_name: 'TRUVA', total_units: 10, total_kg: 300, lines: [item('c', 'AFIYET BEYAZ', 10, 30, 10)] }]
    if (path === '/client-orders/o1') json = { ...order, lines: count === 2 ? order.lines : Array.from({ length: count }, (_, i) => item(`line${i}`, `RECEPTURA ŁÓDŹ ${String(i + 1).padStart(3, '0')}`, 3, 20.125, 1)) }
    if (path === '/clients') json = [{ id: 'c', name: 'YALCIN Sp. z o.o.', display_name: 'YALCIN', active: true, address: 'Długa 12', city: 'Wrocław', postal_code: '50-001', nip: '1234567890' }]
    if (path === '/product-types') json = [{ id: 'udo', name: 'KEBAB UDO 100%', active: true }]
    if (path === '/recipes') json = [{ id: 'r1', name: 'AFIYET BEYAZ', product_type_id: 'udo', total_output_per_100kg: 125, ingredients: [], active: true }, { id: 'r2', name: 'GUSTO KIRMIZI', product_type_id: 'udo', total_output_per_100kg: 125, ingredients: [], active: true }]
    if (path === '/packaging') json = [{ id: 'pkg', name: 'METAL 65 cm', type: 'tuleja', active: true }, { id: 'pkg80', name: 'METAL 80 cm', type: 'tuleja', active: true }]
    if (path === '/settings/company') json = { name: 'FHUP Marek Księżyc', address: 'Zakładowa 1', postal_code: '00-001', city: 'Łódź', nip: '9999999999', email: 'biuro@example.test' }
    if (path.includes('material-requirements') || path.includes('preview-requirements')) json = { total: [], remaining: [], net_shortage: [], totals_by_raw: [], lines: [] }
    if (path.endsWith('/stock-carton-options')) json = { available: [{ ...carton, carton_id: 'sc2', carton_no: 78, client_name: '', generic: true }], assigned: [carton], unavailable: [], assigned_totals: { cartons: 1, units: 4 } }
    if (path === '/client-orders/o1/pallets') json = [{ id: 'p1', pallet_no: 8, carton_no: '000038', status: 'cold_storage', notes: 'Mroźnia 2', items: [{ order_line_id: 'a', qty: 20 }] }, { id: 'p2', pallet_no: 12, status: 'created', items: [{ order_line_id: 'b', qty: 20 }] }]
    if (path.includes('batch-breakdown')) json = [{ batchNo: 'B/15/10', qty: 20, weightKg: 400 }]
    if (path === '/pallets/orphans') json = [{ id: 'orphan', source_order_no: 'YALCIN/Z/1/09/26', client_name: 'YALCIN', pallet_no: 7, carton_no: 35, reason: 'Brak zgodnego otwartego zamówienia', items: [{ recipe_name: 'AFIYET BEYAZ', product_type_name: 'UDO', kg_per_unit: 15, qty: 60, packaging_name: 'METAL 65 cm' }] }]
    if (path.endsWith('/loading-status')) json = { pallets: [] }
    if (path.endsWith('/split')) return route.fulfill({ status: 404, json: { detail: 'Brak podziału' } })
    await route.fulfill({ json })
  })
  return errors
}

test('pełny dział: realizacja, mieszanie, palety i dialog', async ({ page }, info) => {
  const errors = await setup(page)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/office/zamowienia')
  const rows = page.getByRole('region', { name: 'Pozycje YALCIN/Z/17/10/26', exact: true })
  await expect(rows).toContainText('5 / 40 szt.')
  await expect(rows).toContainText('18 / 20 szt.')
  await expect(rows.getByText('700 kg', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /CSV/ })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('orders-desktop.png'), fullPage: true })
  await page.getByRole('checkbox', { name: 'Zaznacz YALCIN/Z/17/10/26', exact: true }).check()
  const summary = page.getByRole('region', { name: 'Podsumowanie zaznaczonych zamówień', exact: true })
  await expect(summary).toContainText('624 kg')
  await summary.getByRole('button', { name: 'AFIYET BEYAZ', exact: true }).click()
  await expect(summary).toContainText('METAL 65 cm')
  await page.screenshot({ path: info.outputPath('mixing-details.png'), fullPage: true })
  await summary.getByRole('region', { name: 'Zestawienie receptur' }).screenshot({ path: info.outputPath('mixing-table.png') })
  await page.getByRole('button', { name: 'Szczegóły YALCIN/Z/17/10/26', exact: true }).click()
  await expect(page.getByText('Karton 000038 · P8')).toBeVisible()
  await expect(page.getByText('Mroźnia składowa').first()).toBeVisible()
  await page.getByText('Karton 000038 · P8').scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('pallets.png') })
  await page.getByRole('button', { name: 'Edytuj paletę nr 8' }).click()
  await expect(page.getByText('Edycja palety nr 8')).toBeVisible()
  await page.screenshot({ path: info.outputPath('pallet-form.png') })
  await page.getByRole('button', { name: 'Dokumenty YALCIN/Z/17/10/26', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Podział wysyłki na fakturę i WZ' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Zapisz podział' }).focus()
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
  }
  await page.screenshot({ path: info.outputPath('split-dialog.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(errors).toEqual([])
})

for (const width of [1280, 768, 375]) {
  test(`responsywność całego modułu ${width}`, async ({ page }, info) => {
    const errors = await setup(page)
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/office/zamowienia')
    await page.getByRole('checkbox', { name: 'Zaznacz wszystkie widoczne' }).check()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: info.outputPath(`orders-${width}.png`), fullPage: true })
    await page.goto('/office/zamowienia/o1/edycja')
    await expect(page.getByRole('heading', { name: 'Edycja zamówienia', exact: true })).toBeVisible()
    await expect(page.getByTestId('oe-line')).toHaveCount(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: info.outputPath(`entry-${width}.png`), fullPage: true })
    const save = page.getByRole('button', { name: /Zapisz zmiany/ })
    await save.scrollIntoViewIfNeeded()
    await expect(save).toBeVisible()
    await page.screenshot({ path: info.outputPath(`entry-save-${width}.png`) })
    expect(errors).toEqual([])
  })
}

test('dodawanie: wybór klienta i pusty formularz', async ({ page }, info) => {
  await setup(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/office/zamowienia/nowe')
  await expect(page.getByRole('heading', { name: 'Wybierz klienta' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('client-choice.png') })
  await page.getByRole('textbox', { name: 'Wyszukaj klienta' }).fill('YALCIN')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /Zapisz zamówienie/ })).toBeVisible()
  await page.screenshot({ path: info.outputPath('new-order.png'), fullPage: true })
})

test('edycja przez API zachowuje ID pozycji i bieżącą poprawkę', async ({ page }) => {
  const errors = await setup(page)
  let saved: any
  await page.route('**/api/client-orders/o1', async route => {
    if (route.request().method() === 'PUT') {
      saved = route.request().postDataJSON()
      return route.fulfill({ json: { ...order, lines: saved.lines } })
    }
    return route.fallback()
  })
  await page.goto('/office/zamowienia/o1/edycja')
  await expect(page.getByTestId('oe-line')).toHaveCount(2)
  const line = page.getByTestId('oe-line').filter({ hasText: 'AFIYET BEYAZ' })
  await line.getByRole('button', { name: 'Popraw pozycję (dwuklik)' }).click()
  await page.getByRole('textbox', { name: 'Sztuk', exact: true }).fill('35')
  await page.keyboard.press('Control+Enter')
  await expect(page).toHaveURL(/\/office\/zamowienia$/)
  expect(saved.lines).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'a', qty: 35, kg_per_unit: 20, packaging_id: 'pkg' }),
    expect.objectContaining({ id: 'b', qty: 20 }),
  ]))
  expect(errors).toEqual([])
})

test('CMR: dostępny dialog transportu na telefonie', async ({ page }, info) => {
  const errors = await setup(page)
  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto('/office/zamowienia')
  await page.getByRole('button', { name: 'Dokumenty YALCIN/Z/17/10/26', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Wystaw CMR', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Wystaw CMR' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Dodaj pozycję' }).click()
  await dialog.getByLabel('Nazwa towaru 1').fill('Towar dodatkowy')
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: info.outputPath('cmr-mobile.png') })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(errors).toEqual([])
})

for (const count of [2, 80]) {
  test(`wydruk klienta ${count} pozycji — A4 i poufność`, async ({ page }, info) => {
    const errors = await setup(page, count)
    await page.goto('/office/zamowienia/o1/druk')
    const doc = page.getByRole('article', { name: 'Zamówienie dla klienta' })
    await expect(doc).toBeVisible()
    await expect(doc.locator('tbody tr')).toHaveCount(count)
    await page.evaluate(() => document.fonts.ready)
    await expect(doc).not.toContainText('WEWNĘTRZNA')
    await expect(doc).not.toContainText('Gotowe')
    await page.screenshot({ path: info.outputPath(`print-${count}.png`), fullPage: true })
    const pdf = await page.pdf({ path: info.outputPath(`order-${count}.pdf`), format: 'A4', preferCSSPageSize: true, printBackground: true })
    const document = await PDFDocument.load(pdf)
    // Protect against blank pages caused by named-page transitions in Chromium.
    expect(document.getPageCount()).toBe(count === 2 ? 1 : 5)
    expect(errors).toEqual([])
  })
}
