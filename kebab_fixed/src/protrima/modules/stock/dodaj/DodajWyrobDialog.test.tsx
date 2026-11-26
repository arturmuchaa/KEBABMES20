// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'
import type { Line, Order } from '../../../data/model'

const api = vi.hoisted(() => ({
  fg: { createBulk: vi.fn() },
  sm: { list: vi.fn(), all: vi.fn() },
  rec: { list: vi.fn() },
  typy: { list: vi.fn() },
  pack: { list: vi.fn() },
  kli: { list: vi.fn() },
}))
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig() as object),
  finishedGoodsApi: api.fg, seasonedMeatApi: api.sm, recipesApi: api.rec,
  productTypesApi: api.typy, packagingApi: api.pack, clientsApi: api.kli,
}))

const linia = (p: Partial<Line>): Line => ({
  id: 'l', lp: 1, product: 'KEBAB UDO 100%', recipe: 'KIRMIZI', recipeId: 'r-kir', kgPerUnit: 10,
  packaging: 'METAL 65CM', qty: 80, planned: 0, produced: 0, stock: 0, delivered: 0, unposted: 0,
  mixingMeatKg: null, mixingRemainingKg: null, productTypeId: 't-udo', packagingId: 'pk-65', ...p,
})
const zam = (id: string, no: string, lines: Line[], klient: { id: string; name: string }, delivery?: string): Order => ({
  id, no, client: { ...klient, country: '', city: '', nip: '', address: '', contact: '', phone: '', terms: '' },
  orderDate: new Date('2026-11-20'), delivery: delivery ? new Date(delivery) : undefined, status: 'confirmed',
  source: '', createdBy: '', lines, pallets: [], retiredPalletNos: [], history: [], docs: [],
})
const YAL = { id: 'c-yal', name: 'YALCIN' }
const orders: Order[] = [
  zam('o1', '41/11', [linia({ id: 'l1' })], YAL, '2026-11-27'),
  zam('o2', '44/11', [linia({ id: 'l2', qty: 30, recipe: 'BEYAZ', recipeId: 'r-bey' })], YAL, '2026-11-30'),
  zam('o3', '12/11', [linia({ id: 'l3', qty: 5 })], { id: 'c-bul', name: 'BULLI' }),
]
const refresh = vi.fn(() => Promise.resolve())
vi.mock('../../../data/store', () => ({ useOrders: () => ({ orders, refresh }) }))
import { DodajWyrobDialog } from './DodajWyrobDialog'

const toast = vi.fn()
const app = { toast, appRef: { current: null }, scale: 1 } as unknown as AppApi
const mount = () => {
  const onClose = vi.fn()
  render(<AppCtx.Provider value={app}><DodajWyrobDialog onClose={onClose} /></AppCtx.Provider>)
  return onClose
}
const rozwin = (nazwa: RegExp) => fireEvent.click(screen.getByRole('button', { name: nazwa }))

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  api.fg.createBulk.mockResolvedValue([])
  const wsady = [{ id: 's1', batchNo: '111', recipeId: 'r-kir', recipeName: 'KIRMIZI', kgAvailable: 300 }, { id: 's2', batchNo: '112', recipeId: 'r-kir', recipeName: 'KIRMIZI', kgAvailable: 500 },
    { id: 's0', batchNo: '099', recipeId: 'r-kir', recipeName: 'KIRMIZI', kgAvailable: 0 }]
  api.sm.list.mockResolvedValue(wsady.filter(w => w.kgAvailable > 0))
  api.sm.all.mockResolvedValue(wsady)
  api.rec.list.mockResolvedValue([{ id: 'r-kir', name: 'KIRMIZI', productTypeId: 't-udo' }])
  api.typy.list.mockResolvedValue([{ id: 't-udo', name: 'KEBAB UDO 100%' }])
  api.pack.list.mockResolvedValue([{ id: 'pk-65', name: 'METAL 65CM' }])
  api.kli.list.mockResolvedValue([{ id: 'c-bul', name: 'BULLI SP', displayName: 'BULLI' }])
})

describe('Dodaj wyrób — drzewo zamówień', () => {
  it('klienci zwinięci, rozwinięcie YALCIN pokazuje dwa zamówienia osobno', () => {
    mount()
    expect(screen.queryByRole('button', { name: /41\/11/ })).toBeNull()
    rozwin(/YALCIN/)
    expect(screen.getByRole('button', { name: /41\/11/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /44\/11/ })).toBeTruthy()
  })
  it('zwinięcie zamówienia chowa jego pozycje', () => {
    mount()
    rozwin(/YALCIN/)
    expect(screen.getByRole('checkbox', { name: /BEYAZ/ })).toBeTruthy()
    rozwin(/44\/11/)
    expect(screen.queryByRole('checkbox', { name: /BEYAZ/ })).toBeNull()
    expect(screen.getByRole('checkbox', { name: /KIRMIZI/ })).toBeTruthy()
  })
})

describe('Dodaj wyrób — partie i zapis', () => {
  const zaznacz41 = () => { rozwin(/YALCIN/); fireEvent.click(screen.getByRole('checkbox', { name: /KIRMIZI/ })) }

  it('80 szt z partii 111 i 112 w jednym zapisie', async () => {
    const onClose = mount()
    await waitFor(() => expect(api.sm.all).toHaveBeenCalled())
    zaznacz41()
    fireEvent.change(screen.getByLabelText('Partia 1, 41/11 KIRMIZI'), { target: { value: '111' } })
    const szt1 = screen.getByLabelText('Sztuk 1, 41/11 KIRMIZI')
    fireEvent.change(szt1, { target: { value: '30' } })
    fireEvent.keyDown(szt1, { key: 'Enter' })
    expect((screen.getByLabelText('Sztuk 2, 41/11 KIRMIZI') as HTMLInputElement).value).toBe('50')
    fireEvent.change(screen.getByLabelText('Partia 2, 41/11 KIRMIZI'), { target: { value: '112' } })
    fireEvent.click(screen.getByRole('button', { name: /^Zapisz/ }))
    await waitFor(() => expect(api.fg.createBulk).toHaveBeenCalledTimes(1))
    const items = api.fg.createBulk.mock.calls[0][0]
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ qty: 30, kgPerUnit: 10, clientOrderNo: '41/11', recipeId: 'r-kir', seasonedBatchNos: ['111'], consumeSeasoned: true, batchNo: '' })
    expect(items[1]).toMatchObject({ qty: 50, seasonedBatchNos: ['112'] })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(refresh).toHaveBeenCalled()
    expect(toast).toHaveBeenCalled()
  })

  it('Enter w sztukach od razu przenosi fokus do nowej partii (szybkie pisanie nie trafia do starego pola)', () => {
    mount()
    zaznacz41()
    const szt1 = screen.getByLabelText('Sztuk 1, 41/11 KIRMIZI')
    fireEvent.change(szt1, { target: { value: '30' } })
    fireEvent.keyDown(szt1, { key: 'Enter' })
    expect(document.activeElement).toBe(screen.getByLabelText('Partia 2, 41/11 KIRMIZI'))
  })

  it('zaznaczenie pozycji od razu stawia fokus w numerze partii', () => {
    mount()
    zaznacz41()
    expect(document.activeElement).toBe(screen.getByLabelText('Partia 1, 41/11 KIRMIZI'))
  })

  it('podgląd numeru i znacznik masowni', async () => {
    mount()
    await waitFor(() => expect(api.sm.all).toHaveBeenCalled())
    zaznacz41()
    fireEvent.change(screen.getByLabelText('Partia 1, 41/11 KIRMIZI'), { target: { value: '111' } })
    await waitFor(() => expect(screen.getByText(/→ \d{6} 111/)).toBeTruthy())
    expect(screen.getByText(/masownia ✓/)).toBeTruthy()
  })

  it('wsad zarezerwowany w planie (brak w liście dostępnych) nadal rozpoznany jako masownia', async () => {
    api.sm.list.mockResolvedValue([])
    mount()
    await waitFor(() => expect(api.sm.all).toHaveBeenCalled())
    zaznacz41()
    fireEvent.change(screen.getByLabelText('Partia 1, 41/11 KIRMIZI'), { target: { value: '111' } })
    await waitFor(() => expect(screen.getByText(/masownia ✓/)).toBeTruthy())
  })

  it('wsad zużyty do zera nie jest rozpoznany jako masownia', async () => {
    mount()
    await waitFor(() => expect(api.sm.all).toHaveBeenCalled())
    zaznacz41()
    fireEvent.change(screen.getByLabelText('Partia 1, 41/11 KIRMIZI'), { target: { value: '099' } })
    await waitFor(() => expect(screen.getByText(/bez masowni/)).toBeTruthy())
  })

  it('Enter na pełnej pozycji nie dodaje pustej partii — fokus idzie do zapisu', () => {
    mount()
    zaznacz41()
    fireEvent.change(screen.getByLabelText('Partia 1, 41/11 KIRMIZI'), { target: { value: '111' } })
    fireEvent.keyDown(screen.getByLabelText('Sztuk 1, 41/11 KIRMIZI'), { key: 'Enter' })
    expect(screen.queryByLabelText('Partia 2, 41/11 KIRMIZI')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Zapisz/ }))
  })

  it('zerwane połączenie — nie obiecujemy, że nic nie zapisano', async () => {
    api.fg.createBulk.mockRejectedValue(new TypeError('Failed to fetch'))
    mount()
    zaznacz41()
    fireEvent.change(screen.getByLabelText('Partia 1, 41/11 KIRMIZI'), { target: { value: '111' } })
    fireEvent.click(screen.getByRole('button', { name: /^Zapisz/ }))
    expect(await screen.findByText(/nie wiadomo, czy zapisano/i)).toBeTruthy()
    expect(screen.queryByText(/Nic nie zostało dodane/)).toBeNull()
  })

  it('pusty numer partii blokuje zapis i pokazuje błąd przy polu', async () => {
    mount()
    zaznacz41()
    fireEvent.click(screen.getByRole('button', { name: /^Zapisz/ }))
    expect(await screen.findByText('Wpisz numer partii')).toBeTruthy()
    expect(api.fg.createBulk).not.toHaveBeenCalled()
  })

  it('błąd serwera zostawia okno i koszyk', async () => {
    api.fg.createBulk.mockRejectedValue(Object.assign(new Error('Brak tulei'), { status: 400 }))
    const onClose = mount()
    zaznacz41()
    fireEvent.change(screen.getByLabelText('Partia 1, 41/11 KIRMIZI'), { target: { value: '111' } })
    fireEvent.click(screen.getByRole('button', { name: /^Zapisz/ }))
    expect(await screen.findByText(/Brak tulei/)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Partia 1, 41/11 KIRMIZI')).toBeTruthy()
    expect((screen.getByRole('button', { name: /^Zapisz/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('wyrób ręczny trafia do zapisu bez numeru zamówienia', async () => {
    mount()
    await waitFor(() => expect(api.rec.list).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Ręcznie/ }))
    const form = screen.getByRole('group', { name: 'Wyrób bez zamówienia' })
    await waitFor(() => expect((within(form).getByLabelText('Rodzaj') as HTMLInputElement).disabled).toBe(false))
    const wybierz = async (label: string, tekst: string) => {
      const inp = within(form).getByLabelText(label)
      fireEvent.focus(inp); fireEvent.change(inp, { target: { value: tekst } })
      fireEvent.keyDown(inp, { key: 'Enter' })
    }
    await wybierz('Rodzaj', 'KEBAB')
    await wybierz('Receptura', 'KIR')
    fireEvent.change(within(form).getByLabelText('Waga sztuki kg'), { target: { value: '12,5' } })
    fireEvent.change(within(form).getByLabelText('Sztuk'), { target: { value: '12' } })
    fireEvent.click(within(form).getByRole('button', { name: /Dodaj do zapisu/ }))
    fireEvent.change(screen.getByLabelText(/^Partia 1, ręcznie/), { target: { value: 'PP13' } })
    fireEvent.click(screen.getByRole('button', { name: /^Zapisz/ }))
    await waitFor(() => expect(api.fg.createBulk).toHaveBeenCalledTimes(1))
    expect(api.fg.createBulk.mock.calls[0][0][0]).toMatchObject({ clientOrderNo: '', qty: 12, kgPerUnit: 12.5, recipeId: 'r-kir', productTypeId: 't-udo', consumeSeasoned: false })
    expect(api.fg.createBulk.mock.calls[0][0][0].batchNo).toMatch(/^\d{6} PP13$/)
  })
})
