// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { EkranKartonow } from './EkranKartonow'

vi.mock('./usePakowanie', () => ({ usePakowanie: () => {
  const k = { id: 'c1', kind: 'stock', cartonNo: '000001', clientName: 'Klient', orderNo: '', targetQty: 15, packedQty: 2,
    lines: [
      { targetQty: 10, packedQty: 2, kgPerUnit: 15, recipeName: 'KIRMIZI', productTypeName: 'UDO', packagingName: 'METAL 80' },
      { targetQty: 5, packedQty: 0, kgPerUnit: 25, recipeName: 'YAPRAK', productTypeName: 'WOŁOWINA', packagingName: 'PAPIER 100' },
    ] }
  return { kontenery: [k], spakowane: [{ ...k, id: 'c2', cartonNo: '000002', packedQty: 15,
    lines: k.lines.map(p => ({ ...p, packedQty: p.targetQty })) }], pula: [], blad: false, ladowanie: false }
} }))
afterEach(cleanup)

it('otwarty i spakowany karton pokazują wszystkie pozycje, ilości, rodzaje i tuleje', () => {
  render(<EkranKartonow onWybor={vi.fn()} />)
  for (const row of screen.getAllByTestId('karton-na-liscie')) {
    expect(within(row).getByText('10 szt × 15 kg · KIRMIZI')).toBeTruthy()
    expect(within(row).getByText('5 szt × 25 kg · YAPRAK')).toBeTruthy()
    expect(within(row).getByText(/UDO · tuleja: METAL 80/)).toBeTruthy()
    expect(within(row).getByText(/WOŁOWINA · tuleja: PAPIER 100/)).toBeTruthy()
  }
  expect(screen.getByText(/spakowano 2\/10 szt/)).toBeTruthy()
  expect(screen.getByText(/spakowano 10\/10 szt/)).toBeTruthy()
})
