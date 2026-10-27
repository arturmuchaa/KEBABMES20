import { test, expect } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

// Input is exported by REAL service/ledger integration tests on the isolated
// PostgreSQL database (SHIPMENT_ARTIFACT_DIR). Only HTTP transport is mocked;
// the existing WM/WZ/HDI/CMR React renderers and Chromium PDF printing are real.
const root = process.env.SHIPMENT_ARTIFACT_DIR
for (const name of ['polat', 'polat-split', 'zagros', 'polat-second']) {
  test(`${name}: persisted shipment documents retain actual quantities in PDF`, async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    test.skip(!root, 'Run backend shipment tests with SHIPMENT_ARTIFACT_DIR first')
    const bundle = JSON.parse(await readFile(`${root}/${name}.json`, 'utf8'))
    await page.route(url => url.pathname.startsWith('/api/'), async route => {
      const path = new URL(route.request().url()).pathname
      if (path.startsWith('/api/rozrachunki/na-dokumencie/')) {
        // No opening balance in the isolated fixture: the real endpoint
        // rejects this optional block rather than returning an invalid {}.
        await route.fulfill({ status: 404, json: { detail: 'Brak rozrachunków' } })
        return
      }
      let json: unknown = {}
      for (const kind of ['wz', 'hdi', 'cmr']) {
        const doc = bundle[kind].find((d: any) => path === `/api/${kind}/${d.id}`)
        if (doc) json = doc
      }
      await route.fulfill({ json })
    })
    await mkdir(testInfo.outputDir, { recursive: true })
    for (const kind of ['wz', 'hdi', 'cmr']) {
      for (const [i, doc] of bundle[kind].entries()) {
        const expectedKg = kind === 'wz'
          ? doc.lines.reduce((s: number, l: any) => s + Number(l.total_kg ?? Number(l.qty) * Number(l.kg_per_unit)), 0)
          : kind === 'hdi' ? doc.totals.kg : doc.payload.gross_kg
        await page.goto(`/office/${kind}/${doc.id}/druk?pdf=1`)
        await expect(page.locator(kind === 'cmr' ? '.cmr-page' : `.${kind}`).first()).toBeVisible()
        await page.evaluate(async () => { await document.fonts.ready })
        const pdfPath = testInfo.outputPath(`${kind}-${i}.pdf`)
        await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true })
        const text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' }).replace(/[ \u00a0\u202f]/g, '')
        expect(text).toContain(String(expectedKg))
        expect(text).not.toContain(name === 'zagros' ? '8050' : '3200')
        await page.screenshot({ path: testInfo.outputPath(`${kind}-${i}.png`), fullPage: true })
      }
    }
  })
}
