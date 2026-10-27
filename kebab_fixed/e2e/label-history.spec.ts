import { test, expect } from '@playwright/test'
import type { LabelPrintJob } from '../src/lib/api'

// API + BrowserPrint are both simulated. No backend, real device or production IO.
for (const width of [375, 1280]) {
  test(`frozen print, reload and deliberate historical replay at ${width}px`, async ({ page }, testInfo) => {
    const jobs = new Map<string, LabelPrintJob>()
    const preparedDtos: any[] = []
    let previewReads = 0
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(() => {
      const w = window as any
      Object.defineProperty(w.crypto, 'randomUUID', { value: undefined })
      w.testSends = []
      const device = {
        uid: 'usb-test', name: 'Test printer',
        send: (data: string, ok: () => void) => { w.testSends.push(data); ok() },
        sendThenRead: (_data: string, ok: (data: string) => void) => ok(
          '\x02030,0,0,1199,000,0,0,0,000,0,0,0\x03\r\n' +
          '\x02001,0,0,0,0,2,4,0,00000000,1,000\x03\r\n\x021234,0\x03\r\n'),
      }
      w.BrowserPrint = {
        getDefaultDevice: (_type: string, ok: (device: unknown) => void) => ok(device),
        getLocalDevices: (ok: (devices: unknown[]) => void) => ok([device]),
      }
    })
    await page.route(url => url.pathname.startsWith('/api/'), async route => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname
      let json: unknown = []
      if (path === '/api/zebra-designs/render') {
        previewReads++
        json = { ok: true, zpl: '^XA^FDpreview only^FS^XZ', count: 1 }
      } else if (path === '/api/labels/zebra/jobs' && request.method() === 'POST') {
        const dto = request.postDataJSON()
        preparedDtos.push(dto)
        const id = `job-${preparedDtos.length}`
        const source = dto.source_job_id ? jobs.get(dto.source_job_id)! : null
        const job: LabelPrintJob = {
          id, ok: true, state: 'prepared', language: 'zpl', transport: 'browserprint',
          printerName: 'Test printer', printerUid: 'usb-test', revisionId: source?.revisionId ?? 7,
          sourceJobId: dto.source_job_id ?? null, createdAt: '2026-10-19 09:10:00', createdBy: 'office:test',
          unitIds: ['u1'], count: 1, zpl: source?.zpl ?? '^XA^PW799^LL1199^FO10,10^BQN,2,4^FDLA,U|original^FS^PQ1,0,0,Y^XZ',
          events: [{ state: 'prepared', actor: 'office:test', createdAt: '2026-10-19 09:10:00' }],
        }
        jobs.set(id, job); json = job
      } else if (path.endsWith('/actions')) {
        const id = path.split('/').at(-2)!
        const job = jobs.get(id)!
        const { action } = request.postDataJSON()
        if (action === 'begin' && job.state !== 'prepared') {
          await route.fulfill({ status: 409, json: { detail: 'Already claimed' } }); return
        }
        job.state = action === 'begin' ? 'submitting' : action
        job.events.push({ state: job.state, actor: 'office:test', createdAt: '2026-10-19 09:10:01' })
        json = { id, state: job.state, attemptToken: 'test-attempt' }
      } else if (path.startsWith('/api/labels/zebra/jobs/')) {
        json = jobs.get(path.split('/').at(-1)!)
      } else if (path === '/api/labels/zebra/job-by-key') json = null
      await route.fulfill({ json })
    })
    await page.goto('/etykiety/zebra?planLineId=line&clientId=TEST&recipeId=r1')
    await page.getByRole('button', { name: 'Drukuj (1)', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Przekazano do BrowserPrint — sprawdź wydruk' })).toBeVisible()
    expect(await page.evaluate(() => (window as any).testSends)).toEqual([jobs.get('job-1')!.zpl])
    await expect(page).toHaveURL(/jobId=job-1/)
    // Vite dev enables StrictMode: read-only preview effects can run twice.
    // What matters is NO current-data lookup during historical replay.
    const readsBeforeHistory = previewReads
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`history-${width}.png`), fullPage: true })
    await page.reload()
    await expect(page.getByRole('button', { name: 'Drukuj (1)', exact: true })).toBeDisabled()
    expect(await page.evaluate(() => (window as any).testSends)).toEqual([])
    await page.getByRole('link', { name: 'Zleć świadomy dodruk całego zadania (1)' }).click()
    await expect(page.getByRole('button', { name: 'Drukuj (1)', exact: true })).toBeDisabled()
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Drukuj (1)', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Przekazano do BrowserPrint — sprawdź wydruk' })).toBeVisible()
    expect(preparedDtos[1]).toMatchObject({ source_job_id: 'job-1', unit_ids: ['u1'] })
    expect(preparedDtos[1]).not.toHaveProperty('plan_line_id')
    expect(previewReads).toBe(readsBeforeHistory)
    expect(jobs.get('job-2')!.zpl).toBe(jobs.get('job-1')!.zpl)
    expect(await page.evaluate(() => (window as any).testSends)).toEqual([jobs.get('job-1')!.zpl])
  })
}
