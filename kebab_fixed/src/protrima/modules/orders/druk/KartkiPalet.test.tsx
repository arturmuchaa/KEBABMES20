// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'
import { mapClientOrder } from '@/lib/api'
import { mapujZamowienie } from '../../../data/mapuj'

/** Kartki na palety — treść idzie na karton w chłodni, więc test na danych w kształcie API (syntetycznych). */
const order = mapujZamowienie(mapClientOrder({
  id: 'o1', order_no: 'POLAT/Z/4/10/26', client_id: 'c-polat', client_name: 'POLAT GMBH', status: 'confirmed',
  lines: [
    { id: 'l1', recipe_id: 'r-beyaz', recipe_name: 'BEYAZ AFIYET', product_type_name: 'KEBAB UDO', kg_per_unit: 50, qty: 30, packaging_name: 'METAL 65CM' },
    { id: 'l2', recipe_id: 'r-kirmizi', recipe_name: 'KIRMIZI', product_type_name: 'KEBAB UDO', kg_per_unit: 20, qty: 20, packaging_name: 'TULEJA 80CM' },
  ],
}), {
  clients: [], wz: [], planByLine: {},
  pallets: { o1: [
    { id: 'p1', palletNo: 1, cartonNo: '000701', status: 'created', items: [{ orderLineId: 'l1', qty: 15 }] },
    { id: 'p2', palletNo: 2, cartonNo: '000702', status: 'created', items: [{ orderLineId: 'l1', qty: 15 }, { orderLineId: 'l2', qty: 20 }] },
  ] } as never,
})
vi.mock('../../../data/store', () => ({ useOrders: () => ({ orders: [order] }) }))
// Kartoteka odbiorcy: nazwa handlowa POLAT, własna nazwa receptury BEYAZ AFIYET → „BEYAZ”.
const nazwy = vi.hoisted(() => ({
  klient: (n: string) => (n === 'POLAT GMBH' ? 'POLAT' : n),
  receptura: (_c: unknown, rid: string | undefined, fb: string) => (rid === 'r-beyaz' ? 'BEYAZ' : fb),
}))
vi.mock('@/lib/clientNames', () => ({ useClientNames: () => nazwy.klient, useClientRecipeNames: () => nazwy.receptura }))
// Rodzaje: „Nazwa na dokumentach” skraca KEBAB UDO 100% → KEBAB UDO.
const typy = vi.hoisted(() => ({ list: vi.fn(() => Promise.resolve([{ id: 't1', name: 'KEBAB UDO 100%', documentName: 'KEBAB UDO' }])) }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), productTypesApi: typy }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn((s: string) => Promise.resolve(`data:image/png;base64,${btoa(s)}`)) } }))
import { KartkiPaletDialog, zbudujKartki } from './KartkiPalet'

const app = { toast: vi.fn() } as unknown as AppApi
afterEach(cleanup)
beforeEach(() => { window.print = vi.fn(); localStorage.clear() })

describe('Kartki palet — treść', () => {
  it('jedna receptura → nagłówek; kilka → receptura przy pozycji; tuleja spoza 45–65 cm przy swojej pozycji; QR PAL|id|nr', () => {
    const k = zbudujKartki(order, [2, 1], n => (n === 'POLAT GMBH' ? 'POLAT' : n), (_c, rid, fb) => (rid === 'r-beyaz' ? 'BEYAZ' : fb))
    expect(k.map(x => x.palletNo)).toEqual([2, 1]) // kolejność z wyboru
    expect(k[1]).toMatchObject({ clientName: 'POLAT', recipeHeader: 'BEYAZ', mainLines: ['15 X 50KG'], totalKg: 750, cornerNo: '000701', qr: 'PAL|o1|1\r' })
    expect(k[0].recipeHeader).toBeNull()
    expect(k[0].mainLines).toEqual(expect.arrayContaining(['15 X 50KG BEYAZ', '20 X 20KG 80CM KIRMIZI']))
    expect(k[0].totalKg).toBe(1150)
  })
})

describe('Kartki palet — nazwa i treść wybierane przy druku', () => {
  const k = (opcje: Parameters<typeof zbudujKartki>[4]) => zbudujKartki(order, [1, 2], nazwy.klient, nazwy.receptura, { rodzajNa: n => (n === 'KEBAB UDO 100%' ? 'KEBAB UDO' : n), ...opcje })
  it('domyślnie jak dotąd: nazwa z kartoteki i receptura', () => {
    expect(k({})[0]).toMatchObject({ clientName: 'POLAT', recipeHeader: 'BEYAZ', mainLines: ['15 X 50KG'] })
  })
  it('własna nazwa klienta na kartce; pusta = z kartoteki', () => {
    expect(k({ nazwa: '  POLAT WIEDEŃ ' })[0].clientName).toBe('POLAT WIEDEŃ')
    expect(k({ nazwa: '   ' })[0].clientName).toBe('POLAT')
  })
  it('„Rodzaj” — nazwa rodzaju z dokumentów; „Rodzaj i receptura” — oba, bez powtórzeń', () => {
    const rodzaj = k({ tryb: 'type' })
    expect(rodzaj[0]).toMatchObject({ recipeHeader: 'KEBAB UDO', mainLines: ['15 X 50KG'] })
    // Dwie receptury tego samego rodzaju → jeden nagłówek, pozycje same liczby.
    expect(rodzaj[1].recipeHeader).toBe('KEBAB UDO')
    const oba = k({ tryb: 'type_recipe' })
    expect(oba[0].recipeHeader).toBe('KEBAB UDO BEYAZ')
    expect(oba[1].mainLines).toEqual(expect.arrayContaining(['15 X 50KG KEBAB UDO BEYAZ', '20 X 20KG 80CM KEBAB UDO KIRMIZI']))
  })
})

describe('Kartki palet — okno', () => {
  const mount = (p: Partial<React.ComponentProps<typeof KartkiPaletDialog>> = {}) =>
    render(<AppCtx.Provider value={app}><KartkiPaletDialog orderId="o1" onClose={vi.fn()} {...p} /></AppCtx.Provider>)

  it('w PRÓBIE: podgląd bez QR, druk zablokowany', async () => {
    mount({ proba: true })
    expect(screen.getByText(/Druk etykiet Zebra jest w próbie wyłączony/)).toBeTruthy()
    expect(screen.getAllByText('QR wyłączony w próbie')).toHaveLength(2)
    expect((screen.getByRole('button', { name: /Druk wyłączony w próbie/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('nazwa i „Pokaż” zmieniają podgląd od razu i zapamiętują się dla klienta', async () => {
    const { unmount } = render(<AppCtx.Provider value={app}><KartkiPaletDialog orderId="o1" proba onClose={vi.fn()} /></AppCtx.Provider>)
    const nazwa = screen.getByLabelText('Nazwa klienta na kartce') as HTMLInputElement
    expect(nazwa.placeholder).toBe('POLAT')
    fireEvent.change(nazwa, { target: { value: 'POLAT WIEN' } })
    await waitFor(() => expect(within(screen.getByTestId('kartka-1')).getByText('POLAT WIEN')).toBeTruthy())
    fireEvent.click(within(screen.getByRole('group', { name: 'Co pokazać na kartce' })).getByRole('button', { name: 'Rodzaj i receptura' }))
    await waitFor(() => expect(within(screen.getByTestId('kartka-1')).getByText('KEBAB UDO BEYAZ')).toBeTruthy())
    unmount()
    // Ponowne otwarcie dla tego klienta — ostatni wybór zostaje.
    render(<AppCtx.Provider value={app}><KartkiPaletDialog orderId="o1" proba onClose={vi.fn()} /></AppCtx.Provider>)
    expect((screen.getByLabelText('Nazwa klienta na kartce') as HTMLInputElement).value).toBe('POLAT WIEN')
    fireEvent.click(screen.getByRole('button', { name: 'Przywróć domyślne' }))
    await waitFor(() => expect(within(screen.getByTestId('kartka-1')).getByText('BEYAZ')).toBeTruthy())
  })

  it('wybór palet: wskazane z zakładki Palety, przełączanie, liczba kartek = palety × 2', async () => {
    mount({ proba: true, palletNos: [2] })
    expect(screen.queryByTestId('kartka-1')).toBeNull()
    expect(within(screen.getByTestId('kartka-2')).getByText('20 X 20KG 80CM KIRMIZI')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Paleta 1'))
    expect(screen.getByTestId('kartka-1')).toBeTruthy()
    expect(screen.getByText(/2 palet × 2 kopie = 4 kartek/)).toBeTruthy()
  })

  it('poza próbą: po wygenerowaniu QR i dopasowaniu pisma — druk dwóch kopii każdej palety', async () => {
    mount({ proba: false })
    const btn = screen.getByRole('button', { name: /Drukuj 4 kartki/ }) as HTMLButtonElement
    // jsdom nie liczy układu — dopasowanie kończy się na dolnym stopniu, ale się kończy.
    await waitFor(() => expect(btn.disabled).toBe(false))
    fireEvent.click(btn)
    await waitFor(() => expect(window.print).toHaveBeenCalled())
    const arkusz = document.querySelector('.print-sheet.kartki-print') as HTMLElement
    expect(arkusz.querySelectorAll('.kp-page')).toHaveLength(4)
    expect(arkusz.querySelectorAll('img[alt="QR"]')).toHaveLength(4)
  })
})
