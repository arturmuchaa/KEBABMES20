// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'

/**
 * Kartony magazynowe — kartka idzie na karton w chłodni, a numer i kod służą do
 * pakowania i wydania; test na danych w kształcie API (syntetycznych).
 */
const api = vi.hoisted(() => ({ create: vi.fn(), removeEmpty: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig() as object),
  stockCartonsApi: api,
  clientsApi: { list: () => Promise.resolve([{ id: 'c1', name: 'POLAT GMBH', displayName: 'POLAT', city: 'GRAZ' }]) },
  productTypesApi: { list: () => Promise.resolve([{ id: 'pt', name: 'KEBAB UDO 100%', documentName: 'KEBAB UDO' }]) },
  recipesApi: { list: () => Promise.resolve([{ id: 'r1', name: 'BEYAZ AFIYET', productTypeId: 'pt' }, { id: 'r2', name: 'KIRMIZI', productTypeId: 'pt' }]) },
  packagingApi: { list: () => Promise.resolve([{ id: 'pk', name: 'METAL 65CM' }]) },
}))
const nazwy = vi.hoisted(() => ({
  klient: (n: string) => (n === 'POLAT GMBH' ? 'POLAT' : n),
  receptura: (_c: unknown, rid: string | undefined, fb: string) => (rid === 'r1' ? 'BEYAZ' : fb),
}))
vi.mock('@/lib/clientNames', () => ({ useClientNames: () => nazwy.klient, useClientRecipeNames: () => nazwy.receptura }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn((s: string) => Promise.resolve(`data:image/png;base64,${btoa(s)}`)) } }))
import { bledyKartonu, doUtworzenia, kartkaKartonu, pozycjaZMagazynu, skladKartonu, stanKartonu, pustaPozycja } from './model'
import { KartonyMagazynowe } from './KartonyMagazynowe'
import { NowyKartonDialog } from './NowyKartonDialog'
import { KartkaKartonuDialog } from './KartkaKartonuDialog'
import type { StockPos } from '../../../data/stock'
import type { StockCarton, StockCartonLine } from '@/lib/api'

const L = (o: Partial<StockCartonLine>): StockCartonLine => ({ id: 'l', recipeId: 'r1', recipeName: 'BEYAZ AFIYET', productTypeId: 'pt', productTypeName: 'KEBAB UDO 100%', packagingId: 'pk', packagingName: 'METAL 65CM', kgPerUnit: 10, targetQty: 40, packedQty: 0, ...o })
const K = (o: Partial<StockCarton>): StockCarton => {
  const lines = o.lines ?? [L({})]
  return { id: 'k', cartonNo: 1, clientId: '', clientName: '', lines, recipeName: lines[0].recipeName, productTypeName: lines[0].productTypeName, packagingName: lines[0].packagingName,
    kgPerUnit: lines[0].kgPerUnit, targetQty: lines.reduce((a, l) => a + l.targetQty, 0), packedQty: lines.reduce((a, l) => a + l.packedQty, 0), status: 'open', ...o }
}
const JEDNORODNY = K({ id: 'k1', cartonNo: 709, clientId: 'c1', clientName: 'POLAT GMBH', lines: [L({ id: 'l1', packedQty: 12 })], linkedOrderId: 'o9', linkedOrderNo: 'POLAT/Z/4/10/26', createdAt: '2026-10-29T08:00:00Z' })
const MIESZANY = K({ id: 'k2', cartonNo: 710, lines: [L({ id: 'l2', targetQty: 30 }), L({ id: 'l3', recipeId: 'r2', recipeName: 'KIRMIZI', kgPerUnit: 15, targetQty: 20 })] })
const SPAKOWANY = { ...JEDNORODNY, id: 'k3', cartonNo: 711, packedQty: 40, linkedOrderId: undefined, linkedOrderNo: undefined }

const app = { toast: vi.fn(), openOrder: vi.fn(), appRef: { current: null }, scale: 1 } as unknown as AppApi
afterEach(cleanup)
beforeEach(() => { Object.values(api).forEach(f => f.mockReset()); (app.toast as ReturnType<typeof vi.fn>).mockClear(); window.print = vi.fn(); localStorage.clear() })

describe('kartony magazynowe — model', () => {
  it('skład i stan: jednorodny z nazwą wyrobu, mieszany jako 30×10 kg + 20×15 kg; pusty / w pakowaniu / spakowany', () => {
    expect(skladKartonu(JEDNORODNY)).toBe('KEBAB UDO 100% BEYAZ AFIYET · 10 kg')
    expect(skladKartonu(MIESZANY)).toBe('30×10 kg + 20×15 kg')
    expect([MIESZANY, JEDNORODNY, SPAKOWANY].map(stanKartonu)).toEqual(['pusty', 'pakowany', 'spakowany'])
  })
  it('kartka: numer w rogu, kod SCARTON, w stopce MAGAZYN; receptura jak u odbiorcy; bez klienta — bez nazwy', () => {
    const k = kartkaKartonu(JEDNORODNY, nazwy.klient, nazwy.receptura)
    expect(k).toMatchObject({ cornerNo: '000709', qr: 'SCARTON|k1', clientName: 'POLAT', stopka: 'MAGAZYN', orderNo: '', totalKg: 400 })
    expect([k.recipeHeader, ...k.mainLines].join(' ')).toMatch(/BEYAZ/)
    expect([k.recipeHeader, ...k.mainLines].join(' ')).not.toMatch(/AFIYET/)
    const m = kartkaKartonu(MIESZANY, nazwy.klient, nazwy.receptura, { tryb: 'type_recipe', rodzajNa: () => 'KEBAB UDO' })
    expect(m.clientName).toBe('')
    expect(m.totalKg).toBe(600)
    expect(kartkaKartonu(JEDNORODNY, nazwy.klient, nazwy.receptura, { nazwa: ' POLAT GRAZ ' }).clientName).toBe('POLAT GRAZ')
  })
  it('nowy karton: puste pozycje nie blokują, błędy per pole; DTO z nazwami z kartotek, bez klienta = pusty klient', () => {
    expect(bledyKartonu({ clientId: '', pozycje: [pustaPozycja()] })).toEqual({ pozycje: 'Dodaj przynajmniej jedną pozycję kartonu.' })
    expect(Object.keys(bledyKartonu({ clientId: '', pozycje: [{ productTypeId: 'pt', recipeId: '', packagingId: '', kgPerUnit: '0', qty: '2,5' }] })).sort()).toEqual(['k0', 'q0', 'r0'])
    const S = { clients: [{ id: 'c1', name: 'POLAT GMBH' }], productTypes: [{ id: 'pt', name: 'KEBAB UDO 100%' }], recipes: [{ id: 'r1', name: 'BEYAZ AFIYET' }], packaging: [{ id: 'pk', name: 'METAL 65CM' }] }
    expect(doUtworzenia({ clientId: '', pozycje: [{ productTypeId: 'pt', recipeId: 'r1', packagingId: 'pk', kgPerUnit: '7,5', qty: '30' }, pustaPozycja()] }, S)).toEqual({
      clientId: '', clientName: '', lines: [{ recipeId: 'r1', recipeName: 'BEYAZ AFIYET', productTypeId: 'pt', productTypeName: 'KEBAB UDO 100%', packagingId: 'pk', packagingName: 'METAL 65CM', kgPerUnit: 7.5, qty: 30 }],
    })
  })
  it('pozycja z wolnego wyrobu: tuleja z kartoteki po nazwie (wiersz magazynu ma tylko nazwę)', () => {
    expect(pozycjaZMagazynu({ productTypeId: 'pt', recipeId: 'r1', packaging: 'metal 65cm ', kgPerUnit: 10, qty: 34 }, [{ id: 'pk', name: 'METAL 65CM' }]))
      .toEqual({ productTypeId: 'pt', recipeId: 'r1', packagingId: 'pk', kgPerUnit: '10', qty: '34' })
  })
})

describe('lista kartonów', () => {
  const mount = (p: Partial<React.ComponentProps<typeof KartonyMagazynowe>> = {}) => {
    const props = { widoki: null, active: true, setCmds: vi.fn(), setCtx: vi.fn(), kartony: [JEDNORODNY, MIESZANY, SPAKOWANY], ladowanie: false, blad: null, odswiez: vi.fn(),
      wybrany: null as string | null, setWybrany: vi.fn(), onNowy: vi.fn(), onKartka: vi.fn(), ...p }
    render(<AppCtx.Provider value={app}><KartonyMagazynowe {...props} /></AppCtx.Provider>)
    return props
  }
  it('stan, spakowanie i zamówienie przy kartonie; filtr stanu i wyszukiwanie', () => {
    mount()
    const w = screen.getByText('000709').closest('tr')!
    expect(within(w).getByText('POLAT')).toBeTruthy()
    expect(within(w).getByText('W pakowaniu')).toBeTruthy()
    expect(within(w).getByText('POLAT/Z/4/10/26')).toBeTruthy()
    expect(within(screen.getByText('000710').closest('tr')!).getByText('na magazyn')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Spakowane/ }))
    expect(screen.queryByText('000709')).toBeNull()
    expect(screen.getByText('000711')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Wszystkie/ }))
    fireEvent.change(screen.getByLabelText('Szukaj kartonu'), { target: { value: 'kirmizi' } })
    expect(screen.getAllByRole('row').filter(r => r.getAttribute('data-id'))).toHaveLength(1)
  })
  it('usuwanie tylko pustego kartonu i dopiero po potwierdzeniu', async () => {
    api.removeEmpty.mockResolvedValue({ ok: true, cartonNo: '000710' })
    const props = mount({ wybrany: 'k1' })
    const wywolania = (props.setCmds as ReturnType<typeof vi.fn>).mock.calls
    const cmds = wywolania[wywolania.length - 1][0] as Array<{ id: string; disabled?: boolean; run?: () => void }>
    expect(cmds.find(c => c.id === 'delete')!.disabled).toBe(true)
    cleanup()
    const p2 = mount({ wybrany: 'k2' })
    const w2 = (p2.setCmds as ReturnType<typeof vi.fn>).mock.calls
    const c2 = w2[w2.length - 1][0] as Array<{ id: string; disabled?: boolean; run?: () => void }>
    c2.find(c => c.id === 'delete')!.run!()
    const dlg = await screen.findByRole('dialog')
    expect(api.removeEmpty).not.toHaveBeenCalled()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Usuń karton' }))
    await waitFor(() => expect(api.removeEmpty).toHaveBeenCalledWith('k2'))
    expect(p2.odswiez).toHaveBeenCalled()
  })
})

describe('nowy karton i kartka', () => {
  it('na magazyn z dwiema pozycjami: wybór z wpisywaniem, zapis z nazwami z kartotek', async () => {
    api.create.mockResolvedValue(MIESZANY)
    const onUtworzony = vi.fn()
    render(<AppCtx.Provider value={app}><NowyKartonDialog start={{}} wolne={[]} onClose={vi.fn()} onUtworzony={onUtworzony} /></AppCtx.Provider>)
    const wybierz = async (label: string, tekst: string, opcja: RegExp) => {
      await new Promise(r => requestAnimationFrame(r))
      const el = screen.getByLabelText(label) as HTMLInputElement
      el.focus(); fireEvent.change(el, { target: { value: tekst } })
      await screen.findByRole('option', { name: opcja })
      fireEvent.keyDown(el, { key: 'Enter' })
    }
    await wybierz('Rodzaj, pozycja 1', 'udo', /KEBAB UDO/)
    await wybierz('Receptura, pozycja 1', 'bey', /BEYAZ/)
    fireEvent.change(screen.getByLabelText('Waga sztuki kg, pozycja 1'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Sztuk, pozycja 1'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: /Dodaj pozycję/ }))
    await wybierz('Rodzaj, pozycja 2', 'udo', /KEBAB UDO/)
    await wybierz('Receptura, pozycja 2', 'kir', /KIRMIZI/)
    fireEvent.change(screen.getByLabelText('Waga sztuki kg, pozycja 2'), { target: { value: '15' } })
    fireEvent.change(screen.getByLabelText('Sztuk, pozycja 2'), { target: { value: '20' } })
    expect(screen.getByText(/karton mieszany/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Utwórz karton/ }))
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1))
    expect(api.create.mock.calls[0][0]).toMatchObject({ clientId: '', clientName: '', lines: [
      { recipeName: 'BEYAZ AFIYET', productTypeName: 'KEBAB UDO 100%', kgPerUnit: 10, qty: 30 }, { recipeName: 'KIRMIZI', kgPerUnit: 15, qty: 20 }] })
    expect(onUtworzony).toHaveBeenCalledWith(MIESZANY)
  })

  it('„Karton z tej pozycji”: klient i pozycja z wolnego wyrobu; bez pozycji zapis zablokowany komunikatem', async () => {
    const z = { id: 's1', product: 'KEBAB UDO 100%', recipe: 'BEYAZ AFIYET', recipeId: 'r1', productTypeId: 'pt', kgPerUnit: 10, packaging: 'METAL 65CM', batch: 'P-12', location: '', qty: 34,
      clientName: 'POLAT GMBH', cartons: [], status: 'stock', movements: [], seasonedBatches: [], producedBy: [] } as unknown as StockPos
    render(<AppCtx.Provider value={app}><NowyKartonDialog start={{ clientName: 'POLAT GMBH', z }} wolne={[z]} onClose={vi.fn()} onUtworzony={vi.fn()} /></AppCtx.Provider>)
    await waitFor(() => expect((screen.getByLabelText('Klient kartonu') as HTMLInputElement).value).toBe('POLAT'))
    expect((screen.getByLabelText('Receptura, pozycja 1') as HTMLInputElement).value).toBe('BEYAZ AFIYET')
    expect((screen.getByLabelText('Tuleja, pozycja 1') as HTMLInputElement).value).toBe('METAL 65CM')
    expect((screen.getByLabelText('Sztuk, pozycja 1') as HTMLInputElement).value).toBe('34')
    fireEvent.click(screen.getByRole('button', { name: 'Usuń pozycję 1' }))
    fireEvent.click(screen.getByRole('button', { name: /Utwórz karton/ }))
    expect(await screen.findByText('Dodaj przynajmniej jedną pozycję kartonu.')).toBeTruthy()
    expect(api.create).not.toHaveBeenCalled()
  })

  it('kartka kartonu: podgląd z MAGAZYN i numerem, druk dwóch kopii po wygenerowaniu kodu', async () => {
    render(<AppCtx.Provider value={app}><KartkaKartonuDialog karton={JEDNORODNY} onClose={vi.fn()} proba={false} /></AppCtx.Provider>)
    const podglad = screen.getByTestId('kartka-kartonu-k1')
    expect(within(podglad).getByText('MAGAZYN')).toBeTruthy()
    expect(within(podglad).getAllByText(/000709/).length).toBeGreaterThan(0)
    const btn = screen.getByRole('button', { name: /Drukuj 2 kartki/ })
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(btn)
    await waitFor(() => expect(window.print).toHaveBeenCalled())
    expect(document.querySelectorAll('.kartki-print .kp-page')).toHaveLength(2)
  })
})
