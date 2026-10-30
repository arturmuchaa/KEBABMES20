// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HdiPrintPage } from './HdiPrintPage'

const api = vi.hoisted(() => ({ get: vi.fn(), pdfUrl: vi.fn() }))
vi.mock('@/lib/api', () => ({ hdiApi: api, downloadDocPdf: vi.fn() }))
vi.mock('@/lib/print', () => ({ drukuj: vi.fn() }))
afterEach(cleanup)

function show(header: Record<string, unknown>) {
  api.get.mockResolvedValue({ id: 'h1', number: '1/10/26', status: 'wstepny', language: 'de',
    issueDate: '30.10.2026', header, items: [], totals: { qty: 160, kg: 3200 } })
  return render(<MemoryRouter initialEntries={['/office/hdi/h1/druk?pdf=1']}><Routes>
    <Route path="/office/hdi/:id/druk" element={<HdiPrintPage />} />
  </Routes></MemoryRouter>)
}

it('PDF i druk oznaczają wersję wstępną, bez fikcyjnej daty wysyłki', async () => {
  const view = show({ preliminary: true })
  const label = await screen.findByTestId('hdi-preliminary')
  expect(label.textContent).toContain('HDI WSTĘPNE / PRELIMINARY HDI')
  expect(label.closest('.hdi')).toBeTruthy()
  expect(label.closest('.no-print')).toBeNull()
  expect(view.container.querySelector('.ship-row')?.textContent).toContain('—')
  expect(view.container.querySelector('.meta-table')?.textContent).toContain('30.10.2026')
})

it('po załadunku pokazuje datę wysyłki niezależnie od daty wystawienia', async () => {
  const view = show({ shipment_date: '31.10.2026' })
  await screen.findByText('1/10/26', { exact: false })
  expect(screen.queryByTestId('hdi-preliminary')).toBeNull()
  expect(view.container.querySelector('.ship-row')?.textContent).toContain('31.10.2026')
  expect(view.container.querySelector('.meta-table')?.textContent).toContain('30.10.2026')
})
