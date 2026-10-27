import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { PDFDocument, PDFArray, PDFName, PDFRawStream, decodePDFRawStream, rgb } from 'pdf-lib'
import type { A4PrintJob, LabelTemplate } from '../src/lib/api'

// Real browser/QR/pdf-lib, but all API and print dialog IO are simulated.
// No production backend, physical printer or native Tauri command is used.
const template: LabelTemplate = {
  id: 'template', clientId: 'CLIENT', recipeId: 'recipe', kind: 'overlay', pageSize: 'a4', labelsPerSheet: 2, zpl: '',
  backgroundData: '', fieldPositions: { qr: { x: 10, y: 60, size: 35 }, batch_no: { x: 5, y: 40, size: 18 }, org_code: { x: 5, y: 50, size: 18 } },
  slotFieldPositions: { '1': { qr: { x: 60.123456789, y: 70.987654321, size: 40 } } },
}
const units = [0, 1].map(index => ({ id: `u${index}`, qrCode: `U|original-${index}`, weightKg: 20, batchNo: '401', producedDate: '2026-10-15' }))

function job(id: string, tpl = template): A4PrintJob {
  return {
    id, ok: true, language: 'a4', transport: 'browser', state: 'prepared', printerName: 'Systemowe okno druku', printerUid: 'browser:dialog',
    revisionId: 17, sourceJobId: null, unitIds: units.map(u => u.id), count: 2, createdAt: '2026-10-20 09:00:00', createdBy: 'office:test', events: [],
    a4: { rendererVersion: 'legacy-a4-v1', template: tpl, units, placements: [{ sheet: 0, slot: 0 }, { sheet: 0, slot: 1 }],
      orgCode: 'HALAL-ORIGINAL', shelfLifeDays: 365, halal: true, labelsPerSheet: 2 },
  }
}

async function mockApi(page: Page, initial?: A4PrintJob) {
  const jobs = new Map<string, A4PrintJob>(initial ? [[initial.id, initial]] : [])
  const prepares: any[] = [], actions: string[] = [], liveReads: string[] = []
  await page.addInitScript(() => {
    const w = window as any
    w.printCalls = []
    w.print = () => w.printCalls.push({
      qr: Array.from(document.querySelectorAll('.label-sheet img[alt^="QR"]')).map(img => img.getAttribute('alt')),
      text: Array.from(document.querySelectorAll('.label-sheet')).map(sheet => sheet.textContent),
    })
  })
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    let json: unknown = []
    if (path === '/api/label-print-jobs' && request.method() === 'POST') {
      const dto = request.postDataJSON(); prepares.push(dto)
      const saved = dto.source_job_id ? structuredClone(jobs.get(dto.source_job_id)!) : job('new')
      saved.id = `a4-${prepares.length}`; saved.state = 'prepared'; saved.sourceJobId = dto.source_job_id ?? null
      saved.transport = dto.transport; saved.printerUid = dto.printer_uid
      if (dto.unit_ids) {
        const indexes = saved.unitIds.map((id, i) => dto.unit_ids.includes(id) ? i : -1).filter(i => i >= 0)
        saved.a4.units = indexes.map(i => saved.a4.units[i]); saved.a4.placements = indexes.map(i => saved.a4.placements[i])
        saved.unitIds = saved.a4.units.map(u => u.id); saved.count = saved.unitIds.length
      }
      saved.events = [{ state: 'prepared', actor: 'office:test', createdAt: saved.createdAt }]
      jobs.set(saved.id, saved); json = saved
    } else if (path.endsWith('/actions')) {
      const saved = jobs.get(path.split('/').at(-2)!)!, { action } = request.postDataJSON()
      actions.push(action)
      if (action === 'begin' && saved.state !== 'prepared') {
        await route.fulfill({ status: 409, json: { detail: 'Already claimed' } }); return
      }
      saved.state = action === 'begin' ? 'submitting' : action
      saved.events.push({ state: saved.state, actor: 'office:test', createdAt: saved.createdAt })
      json = { id: saved.id, state: saved.state, attemptToken: 'a4-attempt' }
    } else if (path === '/api/label-print-jobs/by-key') json = null
    else if (path.startsWith('/api/label-print-jobs/')) {
      const saved = structuredClone(jobs.get(path.split('/').at(-1)!)!)
      const ids = url.searchParams.get('unit_ids')?.split(',')
      if (ids) {
        const indexes = saved.unitIds.map((id, i) => ids.includes(id) ? i : -1).filter(i => i >= 0)
        saved.a4.units = indexes.map(i => saved.a4.units[i]); saved.a4.placements = indexes.map(i => saved.a4.placements[i])
        saved.unitIds = saved.a4.units.map(u => u.id); saved.count = saved.unitIds.length
      }
      json = saved
    } else if (['/api/finished-units', '/api/label-templates', '/api/recipes/recipe', '/api/clients'].includes(path)) {
      liveReads.push(path)
      if (path === '/api/finished-units') json = units.map(u => ({ ...u, qrCode: u.qrCode.replace('original', 'live-preview'), batchNo: 'CHANGED' }))
      else if (path === '/api/label-templates') json = { exists: true, template }
      else if (path === '/api/recipes/recipe') json = { id: 'recipe', shelf_life_days: 5 }
      else json = [{ id: 'CLIENT', name: 'CLIENT', halal_supervision: false }]
    }
    await route.fulfill({ json })
  })
  return { jobs, prepares, actions, liveReads }
}

for (const width of [375, 1280]) {
  test(`A4 one click, reload, then selected historical slot at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const mock = await mockApi(page)
    await page.goto('/etykiety/druk?planLineId=line&clientId=CLIENT&recipeId=recipe')
    await page.getByRole('button', { name: 'Drukuj', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Wywołano okno druku — wynik fizyczny niepotwierdzony' })).toBeVisible()
    await expect(page).toHaveURL(/jobId=a4-1/)
    expect(mock.prepares).toHaveLength(1)
    expect(mock.actions).toEqual(['begin', 'dialog_opened'])
    const calls = await page.evaluate(() => (window as any).printCalls)
    expect(calls).toHaveLength(1)
    expect(calls[0].qr).toEqual(['QR U|original-0', 'QR U|original-1'])
    expect(calls[0].text[0]).toContain('151026 401')
    expect(calls[0].text[0]).not.toContain('CHANGED')
    const reads = mock.liveReads.length
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Drukuj', exact: true })).toBeDisabled()
    expect(await page.evaluate(() => (window as any).printCalls)).toEqual([])
    await page.goto('/etykiety/druk?sourceJobId=a4-1&unitIds=u1')
    const qr = page.getByAltText('QR U|original-1')
    await expect(qr).toHaveCount(1)
    await expect(page.getByAltText('QR U|original-0')).toHaveCount(0)
    expect(await qr.evaluate(img => parseFloat((img as HTMLImageElement).style.left))).toBeCloseTo(60.123456789, 4)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Drukuj', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Wywołano okno druku — wynik fizyczny niepotwierdzony' })).toBeVisible()
    expect(mock.prepares[1]).toMatchObject({ source_job_id: 'a4-1', unit_ids: ['u1'], language: 'a4' })
    expect(mock.liveReads).toHaveLength(reads)
    expect(await page.evaluate(() => (window as any).printCalls[0].qr)).toEqual(['QR U|original-1'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (width < 800) await page.getByRole('region', { name: /Arkusze A4/ }).evaluate(el => { el.scrollLeft = el.scrollWidth - el.clientWidth })
    await page.screenshot({ path: testInfo.outputPath(`a4-history-${width}.png`), fullPage: true })
  })
}

test('historical PDF export uses real renderer, one QR and original second-slot geometry', async ({ page }, testInfo) => {
  const background = await PDFDocument.create()
  background.addPage([734.52, 1039.56]).drawRectangle({ x: 20, y: 20, width: 690, height: 995, borderWidth: 1, borderColor: rgb(0, 0, 0) })
  const original = job('source-pdf', { ...template, backgroundPdf: await background.saveAsBase64({ dataUri: true }) })
  original.state = 'exported'; original.transport = 'file'; original.printerUid = 'file:pdf'
  const mock = await mockApi(page, original)
  await page.goto('/etykiety/druk?sourceJobId=source-pdf&unitIds=u1')
  await page.getByRole('checkbox').check()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Pobierz PDF', exact: true }).click()
  const download = await downloaded
  const path = testInfo.outputPath('historical-label.pdf')
  await download.saveAs(path)
  await expect(page.getByRole('heading', { name: 'Przekazano plik do pobrania — nie potwierdza druku' })).toBeVisible()
  expect(mock.actions).toEqual(['begin', 'exported'])
  expect(mock.liveReads).toHaveLength(0)
  expect(await page.evaluate(() => (window as any).printCalls)).toEqual([])
  const pdf = await PDFDocument.load(await readFile(path))
  expect(pdf.getPageCount()).toBe(1)
  const sheet = pdf.getPage(0), mm = 72 / 25.4
  expect(sheet.getWidth() / mm).toBeCloseTo(210, 5); expect(sheet.getHeight() / mm).toBeCloseTo(297, 5)
  const contents = sheet.node.lookup(PDFName.of('Contents')) as PDFArray
  const ops = contents.asArray().map(ref => new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(ref) as PDFRawStream).decode())).join('\n')
  const imageOps = [...ops.matchAll(/q\s+([\s\S]*?)\s+Q/g)].map(m => m[1]).filter(block => /\/Image-[^\s]+ Do/.test(block))
  expect(imageOps).toHaveLength(1)
  const transform = [...imageOps[0].matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) cm/g)].map(m => m.slice(1).map(Number))
  expect(transform[0][4] / mm).toBeCloseTo(210 * 0.60123456789, 5)
  expect(transform.reduce((scale, matrix) => scale * matrix[0], 1) / mm).toBeCloseTo(40, 5)
})
