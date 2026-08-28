// @vitest-environment jsdom
/**
 * Okno szczegółów pozycji magazynu — korekta rodzaju.
 *
 * Rodzaj jest częścią tożsamości wyrobu: UDO 100% i MIX 95/5 mają tę samą
 * recepturę, tuleję i wagę sztuki, a inny skład mięsa i inną cenę. Pomyłka
 * przy wpisie robi na magazynie towar, którego tam nie ma (Truva 80 × 20 kg,
 * 28.08.2026) — i do tej pory jedyną drogą naprawy był SQL na produkcji.
 *
 * Granica jest twarda: partia, z której cokolwiek wyjechało, poprawki NIE
 * dostaje. Rodzaj stoi już wtedy na WZ i HDI u klienta, więc cicha zmiana
 * rozjechałaby magazyn z dokumentami.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const wolania = vi.hoisted(() => ({ zmiany: [] as any[] }))

vi.mock('@/lib/apiClient', () => ({
  traceabilityApi: { backward: () => Promise.resolve(null), chain: () => Promise.resolve(null) },
}))
vi.mock('@/lib/api', () => ({
  finishedGoodsApi: {
    zmienRodzaj: (id: string, pt: string) => {
      wolania.zmiany.push({ id, pt })
      return Promise.resolve({ id, productTypeId: pt, productTypeName: 'KEBAB MIX 95/5', poprzedni: 'KEBAB UDO 100%' })
    },
  },
  productTypesApi: {
    list: () => Promise.resolve([
      { id: 'pt-udo', name: 'KEBAB UDO 100%' },
      { id: 'pt-mix', name: 'KEBAB MIX 95/5' },
    ]),
  },
}))
vi.mock('@/lib/clientNames', () => ({ useClientNames: () => (s: string) => s }))
vi.mock('@/features/finished-goods/components/BatchLocationSummary', () => ({
  BatchLocationSummary: () => null,
}))

import { DetailModal } from './DetailModal'

const partia = (over: any = {}) => ({
  id: 'f1', batchNo: '280826 509/516', planId: '', planNo: '', planLineId: '',
  productTypeId: 'pt-udo', productTypeName: 'KEBAB UDO 100%',
  recipeId: 'r1', recipeName: 'KIRMIZI', packagingId: 't1', packagingName: 'KARTON 60CM',
  clientName: 'Truva gastro s.r.o.', qty: 80, kgPerUnit: 20, totalKg: 1600,
  seasonedBatchNos: [], rawBatchNos: [], qtyAvailable: 80, qtyShipped: 0,
  producedDate: '2026-08-28', producedBy: [], createdAt: '',
  ...over,
})

const grupa = (batches: any[]) => ({
  key: 'k', productTypeName: 'KEBAB UDO 100%', recipeName: 'KIRMIZI',
  packagingName: 'KARTON 60CM', clientName: 'Truva gastro s.r.o.',
  kgPerUnit: 20, qty: batches.reduce((s, b) => s + b.qtyAvailable, 0),
  totalKg: 1600, batches,
}) as any

beforeEach(() => { wolania.zmiany = [] })
afterEach(cleanup)

describe('DetailModal — korekta rodzaju', () => {
  it('niewydana partia da się poprawić i wysyła wybrany rodzaj', async () => {
    const zmienione = vi.fn()
    render(<DetailModal group={grupa([partia()])} onClose={() => {}} onChanged={zmienione} />)

    fireEvent.click(await screen.findByTestId('rodzaj-popraw-f1'))
    const wybor = await screen.findByTestId('rodzaj-wybor-f1')
    fireEvent.change(wybor, { target: { value: 'pt-mix' } })

    await waitFor(() => expect(wolania.zmiany).toEqual([{ id: 'f1', pt: 'pt-mix' }]))
    expect(zmienione).toHaveBeenCalled()
  })

  it('partia, z której coś wyjechało, nie ma czym poprawić', async () => {
    render(<DetailModal group={grupa([partia({ qtyAvailable: 50, qtyShipped: 30 })])}
                        onClose={() => {}} />)

    await screen.findByText(/wyjechało 30 szt/)
    expect(screen.queryByTestId('rodzaj-popraw-f1')).toBeNull()
    expect(screen.getByText(/wyjechało 30 szt/)).toBeTruthy()
  })
})
