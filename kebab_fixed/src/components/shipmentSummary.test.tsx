// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ShipmentWarning } from './ShipmentWarning'
import { ShipmentInvoiceSummary } from './ShipmentInvoiceSummary'

afterEach(cleanup)
describe('ilości z rzeczywistego załadunku', () => {
  it('POLAT: 120 szt. na dokumentach, brak 40 szt.; nie udaje faktury Subiekta', () => {
    render(<>
      <ShipmentWarning coverage={{ complete: false, extra_qty: 0, missing: [
        { order_line_id: 'l1', name: 'KIRMIZI', kg_per_unit: 20, ordered_qty: 160, missing_qty: 40, missing_kg: 800 },
      ] }} />
      <ShipmentInvoiceSummary data={{ source: 'confirmed_loading', loading_id: 'course', invoice_kg: 2400, wz_kg: 0, lines: [
        { order_line_id: 'l1', name: 'KIRMIZI', kg_per_unit: 20, shipped_qty: 120, invoice_qty: 120, invoice_kg: 2400, wz_qty: 0, wz_kg: 0 },
      ] }} />
    </>)
    expect(screen.getByRole('alert').textContent).toContain('40 szt. / 800 kg')
    expect(screen.getByRole('region', { name: 'Dane do faktury z załadunku' }).textContent).toContain('FV 120 szt. / 2400 kg')
    expect(screen.getByText(/MES nie wysyła ich automatycznie do Subiekta GT/)).toBeTruthy()
    expect(screen.queryByText(/3200/)).toBeNull()
  })
})
