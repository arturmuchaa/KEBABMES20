import { test, expect, type Page } from '@playwright/test'

// Isolated browser contract test: no production backend, credentials or writes.
const kg = (ordered: number, stock: number, delivered: number) => ({
  ordered_kg: ordered, stock_kg: stock, delivered_kg: delivered,
  covered_kg: stock + delivered, remaining_kg: ordered - stock - delivered,
})
const orders = Array.from({ length: 12 }, (_, i) => ({
  id: `o${i}`, order_no: `${i < 6 ? 'YALCIN' : 'TRUVA'}/Z/${i + 1}/10/26`,
  client_id: i < 6 ? 'c1' : 'c2', client_name: i < 6 ? 'YALCIN' : 'TRUVA — Centrum dystrybucji produktów spożywczych',
  status: 'confirmed', order_date: '2026-10-14', delivery_date: '2026-10-20', total_kg: 1000, total_units: 40,
  coverage_basis: 'stock_and_documents', fulfillment: kg(1000, i % 3 === 0 ? 400 : 0, i % 3 === 0 ? 100 : 0),
  lines: [{ id: `l${i}`, qty: 40, kg_per_unit: 25, total_kg: 1000,
    qty_stock: i % 3 === 0 ? 16 : 0, qty_delivered: i % 3 === 0 ? 4 : 0,
    recipe_id: i % 2 ? 'r1' : 'r2', recipe_name: i % 2 ? 'AFIYET BEYAZ' : 'GUSTO KIRMIZI — receptura specjalna',
    product_type_id: 'udo', product_type_name: 'KEBAB UDO 100%',
    packaging_id: i % 2 ? 'p65' : 'p80', packaging_name: i % 2 ? 'METAL 65 cm' : 'METAL 80 cm',
    fulfillment: kg(1000, i % 3 === 0 ? 400 : 0, i % 3 === 0 ? 100 : 0) }],
}))

async function open(page: Page) {
  page.on('pageerror', e => console.error('Order UI browser error:', e.message))
  await page.addInitScript(() => localStorage.setItem('kebab.token', 'order-ui-test'))
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname
    // @tauri-apps/api imports contain /api/ too; do not mock JS modules.
    if (!pathname.startsWith('/api/')) return route.continue()
    const path = pathname.replace(/^\/api/, '')
    let json: unknown = []
    if (path === '/auth/me') json = { id: 'test', kind: 'office', role: 'admin', name: 'Test planisty', departments: [] }
    if (path === '/client-orders') json = orders
    if (path === '/clients') json = [{ id: 'c1', name: 'YALCIN', display_name: 'YALCIN' }, { id: 'c2', name: 'TRUVA' }]
    if (path.includes('/material-requirements')) json = { total: [], remaining: [], netShortage: [], lines: [] }
    if (path.endsWith('/stock-carton-options')) json = { available: [], assigned: [], unavailable: [] }
    if (path.endsWith('/loading-status')) json = { pallets: [] }
    if (path === '/health') json = { status: 'ok' }
    await route.fulfill({ json })
  })
  await page.goto('/office/zamowienia')
  await expect(page.getByRole('checkbox', { name: 'Zaznacz wszystkie widoczne' })).toBeVisible()
}

test('planista: klawiatura, filtry, receptury i dokumenty bez gubienia zaznaczeń', async ({ page }, info) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await open(page)
  await expect(page.locator('.order-product-row')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  const heights = await page.locator('.order-master').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height))
  expect(Math.max(...heights)).toBeLessThanOrEqual(64)
  await page.screenshot({ path: info.outputPath('collapsed-full-list.png') })
  const first = page.getByRole('checkbox', { name: 'Zaznacz YALCIN/Z/1/10/26', exact: true })
  await first.focus(); await page.keyboard.press('Space')
  await expect(first).toBeChecked()
  const summary = page.getByRole('region', { name: 'Podsumowanie zaznaczonych zamówień', exact: true })
  await expect(summary).toContainText('400 kg')
  await page.getByRole('textbox', { name: 'Szukaj zamówień' }).fill('TRUVA')
  await expect(summary).toContainText('1 zaznaczonych poza widoczną listą')
  await page.getByRole('checkbox', { name: 'Zaznacz wszystkie widoczne' }).check()
  await page.getByRole('button', { name: 'Wyczyść filtry' }).click()
  await expect(first).toBeChecked()
  await summary.getByRole('button', { name: /Zapotrzebowanie na mięso/ }).click()
  await summary.getByRole('button', { name: /AFIYET BEYAZ/ }).click()
  await expect(summary.getByText('METAL 65 cm').first()).toBeVisible()
  await page.screenshot({ path: info.outputPath('recipe-details.png'), fullPage: true })
  await summary.getByRole('button', { name: /AFIYET BEYAZ/ }).click()
  await page.screenshot({ path: info.outputPath('orders-fullhd.png'), fullPage: true })
  await page.getByRole('button', { name: 'Dokumenty YALCIN/Z/1/10/26', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Wystaw WZ', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(first).toBeChecked()
  await page.getByRole('button', { name: 'Szczegóły YALCIN/Z/1/10/26', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Pozycje YALCIN/Z/1/10/26', exact: true })).toBeVisible()
  await expect(first).toBeChecked()
  await page.screenshot({ path: info.outputPath('order-details.png'), fullPage: true })
  expect(errors).toEqual([])
})

for (const width of [1280, 768, 375]) {
  test(`układ ${width}px: brak poziomego przewijania całej strony`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open(page)
    await page.getByRole('checkbox', { name: 'Zaznacz wszystkie widoczne' }).check()
    await expect(page.getByRole('region', { name: 'Podsumowanie zaznaczonych zamówień', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    await page.screenshot({ path: info.outputPath(`orders-${width}.png`), fullPage: true })
  })
}
