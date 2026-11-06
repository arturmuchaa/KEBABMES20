import { test, expect } from '@playwright/test'

// Fully mocked API: this suite never reads or changes the production database.
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error('Label Studio browser error:', error.message))
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
  page.on('requestfailed', request => console.error(request.url(), request.failure()?.errorText))
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname
    let json: unknown = []
    if (path === '/api/clients') json = [{ id: 'c1', name: 'TEST' }]
    if (path === '/api/recipes') json = [{ id: 'r1', name: 'Kebab' }]
    if (path === '/api/label-templates') json = { exists: true, template: {
      id: 'tpl', clientId: 'TEST', recipeId: 'r1', kind: 'overlay',
      backgroundData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      backgroundPdf: '', fieldPositions: { qr: { x: 10, y: 10, size: 25 }, weight: { x: 10, y: 30, size: 12 } },
      labelsPerSheet: 2, slotOffsets: [{ dx: 0, dy: 0 }, { dx: 50, dy: 0 }],
      printCalib: { scale: 98, dxMm: 1, dyMm: 0, fit: true, fitStretch: true },
    } }
    await route.fulfill({ json })
  })
})

for (const width of [800, 1280, 1920]) {
  test(`A4 studio at ${width}px: properties and legacy options remain available`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/etykiety/szablon?clientId=TEST&recipeId=r1')
    await page.getByRole('button', { name: /^Kod QR/ }).click()
    await expect(page.getByLabel('X (mm)')).toHaveValue('21')
    await page.getByLabel('X (mm)').fill('25.4')
    await page.getByRole('button', { name: 'Cofnij', exact: true }).click()
    await expect(page.getByLabel('X (mm)')).toHaveValue('21')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (width === 1920) await page.screenshot({ path: testInfo.outputPath('studio.png'), fullPage: true })
    await page.getByText('Zaawansowane dopasowanie · offsety etykiet, kalibracja, skala i przycinanie', { exact: true }).click()
    await expect(page.getByLabel(/Rozciągnij na całą wysokość/)).toBeChecked()
    await page.getByRole('button', { name: 'Układ klasyczny' }).click()
    await expect(page.getByText('Konfiguracja szablonu etykiety', { exact: true })).toBeVisible()
  })
}

test('drag changes position without jumping and undoes in one step', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/etykiety/szablon?clientId=TEST&recipeId=r1')
  const marker = page.locator('[data-label-field="qr"]')
  await marker.scrollIntoViewIfNeeded()
  const box = await marker.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 10, box!.y + 10)
  await page.mouse.down()
  await page.mouse.move(box!.x + 36, box!.y + 10, { steps: 5 })
  await page.mouse.up()
  // Canvas = 520px wide. 26px movement = 10.5 mm, starting at 21mm.
  await expect(page.getByLabel('X (mm)')).toHaveValue('31.5')
  await page.getByRole('button', { name: 'Cofnij', exact: true }).click()
  await expect(page.getByLabel('X (mm)')).toHaveValue('21')
})
