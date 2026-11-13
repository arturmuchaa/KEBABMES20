// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'
import type { Ingredient, Recipe } from '@/features/ingredients/types'

const rec = vi.hoisted(() => ({
  list: vi.fn(), archived: vi.fn(), usage: vi.fn(), usageOf: vi.fn(), create: vi.fn(), update: vi.fn(), deactivate: vi.fn(), activate: vi.fn(),
}))
const ing = vi.hoisted(() => ({ list: vi.fn(), stock: vi.fn() }))
const pt = vi.hoisted(() => ({ list: vi.fn() }))
const rb = vi.hoisted(() => ({ materialTypes: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), recipesApi: rec, ingredientsApi: ing, productTypesApi: pt, rawBatchesApi: rb }))
import { RecepturyModule } from './RecepturyModule'
import {
  bledy, doDto, kalkulator, kiedy, liczba, miesoNaPolprodukt, odcisk, pierwszyBrak, podsumowanieFormularza, przesun, pustyFormularz,
  typowyTermin, wodaNaKoniec, wodaNieNaKoncu, zOgonem, zReceptury, type Formularz,
} from './model'

const SKL: Ingredient[] = [
  { id: 'i-van', code: 'SKL-001', name: 'VAN HESS SM BINDUNG', category: 'functional', unit: 'kg', isUnlimited: false, active: true, createdAt: '' },
  { id: 'i-berg', code: 'SKL-002', name: 'BERG CHIKEN BKS', category: 'spice_mix', unit: 'kg', isUnlimited: false, active: true, createdAt: '' },
  { id: 'i-woda', code: 'SKL-009', name: 'WODA', category: 'water', unit: 'l', isUnlimited: true, active: true, createdAt: '' },
]
const mapa = new Map(SKL.map(i => [i.id, i]))
const KIRMIZI: Recipe = {
  id: 'r1', name: 'KIRMIZI', code: 'R-001', productTypeId: 'pt1', productTypeName: 'KEBAB UDO 100%', totalOutputPer100kg: 125.85, shelfLifeDays: 364, mixingMinutes: null,
  active: true, createdAt: '', components: [],
  ingredients: [
    { id: 'a', ingredientId: 'i-van', ingredientName: 'VAN HESS SM BINDUNG', unit: 'kg', qtyPer100kg: 2.5, isUnlimited: false },
    { id: 'b', ingredientId: 'i-berg', ingredientName: 'BERG CHIKEN BKS', unit: 'kg', qtyPer100kg: 3.35, isUnlimited: false },
    { id: 'c', ingredientId: 'i-woda', ingredientName: 'WODA', unit: 'l', qtyPer100kg: 20, isUnlimited: true },
  ],
}
const BEYAZ: Recipe = { ...KIRMIZI, id: 'r2', name: 'BEYAZ HALAL', code: undefined, totalOutputPer100kg: 123.6, ingredients: KIRMIZI.ingredients.slice(0, 2) }
const ctx = { nazwyZajete: new Set(['kirmizi']), skladniki: mapa }
const wiersz = (ingredientId: string, dawka: string) => ({ klucz: `k-${ingredientId}-${dawka}`, ingredientId, dawka })
const f = (p: Partial<Formularz>): Formularz => ({ ...pustyFormularz(364), nazwa: 'NOWA', ...p })

describe('Receptury — logika', () => {
  it('przecinek dziesiętny jak w Excelu, śmieci to NaN', () => {
    expect(liczba('4,5')).toBe(4.5); expect(liczba(' 1 200,25 ')).toBe(1200.25); expect(liczba('')).toBeNaN(); expect(liczba('4,5kg')).toBeNaN()
  })
  it('błędy przy polu: zajęta nazwa, brak terminu, ten sam składnik dwa razy, dawka zero, za duża dawka', () => {
    const b = bledy(f({ nazwa: 'Kirmizi ', termin: '', wiersze: [wiersz('i-van', '2,5'), wiersz('i-van', '1'), wiersz('i-berg', '0'), wiersz('i-woda', '150')] }), ctx)
    expect(b.nazwa).toMatch(/już jest/)
    expect(b.termin).toMatch(/termin/)
    expect(b.wiersze['k-i-van-1'].skladnik).toBe('Ten składnik jest już w wierszu 1')
    expect(b.wiersze['k-i-berg-0'].dawka).toMatch(/większa od zera/)
    expect(b.wiersze['k-i-woda-150'].dawka).toMatch(/jednostkę/)
  })
  it('pusty skład i pierwszy brak prowadzi kursor do pola', () => {
    const x = f({ nazwa: '' })
    const b = bledy(x, ctx)
    expect(b.sklad).toMatch(/co najmniej jeden/)
    expect(pierwszyBrak(b, x)).toEqual({ pole: 'rc-nazwa', tekst: 'Podaj nazwę receptury' })
    expect(pierwszyBrak(bledy(f({}), ctx), f({}))?.tekst).toMatch(/co najmniej jeden/)
  })
  it('komponenty muszą dać 100%', () => {
    const k = (pct: string) => ({ klucz: pct, materialTypeId: 'mat-filet', materialName: 'Filet', pct })
    expect(bledy(f({ wiersze: [wiersz('i-van', '1')], komponenty: [k('70'), k('20')] }), ctx).komponenty).toMatch(/jest 90%/)
    expect(bledy(f({ wiersze: [wiersz('i-van', '1')], komponenty: [k('70'), k('30')] }), ctx).komponenty).toBeUndefined()
  })
  it('bilans jak serwer: półprodukt = 100 + suma dawek, udział od półproduktu', () => {
    const p = podsumowanieFormularza(f({ wiersze: [wiersz('i-van', '2,5'), wiersz('i-berg', '3,35'), wiersz('i-woda', '20')] }))
    expect(p.polprodukt).toBe(125.85)
    expect(p.udzialy['k-i-woda-20']).toBeCloseTo(15.89, 2)
  })
  it('woda nie na końcu → wykryta i jednym ruchem przeniesiona, kolejność reszty bez zmian', () => {
    const x = f({ wiersze: [wiersz('i-woda', '20'), wiersz('i-van', '2'), wiersz('i-berg', '3')] })
    expect(wodaNieNaKoncu(x, mapa)).toBe(true)
    const y = wodaNaKoniec(x, mapa)
    expect(y.wiersze.filter(w => w.ingredientId).map(w => w.ingredientId)).toEqual(['i-van', 'i-berg', 'i-woda'])
    expect(wodaNieNaKoncu(y, mapa)).toBe(false)
    expect(y.wiersze[y.wiersze.length - 1].ingredientId).toBe('')
  })
  it('przesuwanie wierszy i zawsze jeden pusty wiersz na końcu', () => {
    const x = f({ wiersze: [wiersz('i-van', '2'), wiersz('i-berg', '3')] })
    expect(przesun(x, 'k-i-berg-3', -1).wiersze.map(w => w.ingredientId)).toEqual(['i-berg', 'i-van', ''])
    expect(zOgonem([wiersz('i-van', '2'), wiersz('', ''), wiersz('', '')]).length).toBe(2)
  })
  it('DTO: nazwa rodzaju idzie z id (stary zapis ją kasował), puste minuty = null, termin bez podmiany na 5', () => {
    const d = doDto(f({ rodzajId: 'pt1', termin: '364', wiersze: [wiersz('i-van', '2,5'), wiersz('', '')] }), 'KEBAB UDO 100%')
    expect(d).toMatchObject({ name: 'NOWA', productTypeId: 'pt1', productTypeName: 'KEBAB UDO 100%', shelfLifeDays: 364, mixingMinutes: null,
      ingredients: [{ ingredientId: 'i-van', qtyPer100kg: 2.5 }] })
  })
  it('kopia ma skład i pustą nazwę; odcisk nie widzi kluczy wierszy', () => {
    const k = zReceptury(KIRMIZI, true)
    expect(k.nazwa).toBe('')
    expect(k.wiersze.map(w => w.dawka)).toEqual(['2,5', '3,35', '20', ''])
    expect(odcisk(zReceptury(KIRMIZI))).toBe(odcisk(zReceptury(KIRMIZI)))
  })
  it('kalkulator: dawki na 600 kg, stan przypraw, półprodukt → mięso', () => {
    const k = kalkulator(KIRMIZI, 600, [
      { ingredientId: 'i-van', ingredientName: '', unit: 'kg', isUnlimited: false, qtyAvailable: 100, qtyReserved: 0 },
      { ingredientId: 'i-berg', ingredientName: '', unit: 'kg', isUnlimited: false, qtyAvailable: 10, qtyReserved: 0 },
    ])
    expect(k.pozycje.map(p => [p.ilosc, p.stan])).toEqual([[15, 'ok'], [20.1, 'brak'], [120, 'bez-stanu']])
    expect(k.polprodukt).toBe(755.1)
    expect(k.braki).toBe(1)
    expect(miesoNaPolprodukt(1258.5, 125.85)).toBeCloseTo(1000, 6)
  })
  it('typowy termin dla nowej receptury i „ostatnio masowana” po ludzku', () => {
    expect(typowyTermin([KIRMIZI, BEYAZ, { ...KIRMIZI, shelfLifeDays: 90 }])).toBe(364)
    const teraz = new Date('2026-11-13T12:00:00')
    expect(kiedy('2026-11-13T06:00:00', teraz)).toBe('dziś')
    expect(kiedy('2026-11-12T06:00:00', teraz)).toBe('wczoraj')
    expect(kiedy('2026-11-08T06:00:00', teraz)).toBe('5 dni temu')
    expect(kiedy(null, teraz)).toBe('—')
  })
})

describe('Receptury — ekran', () => {
  const app = { toast: vi.fn(), openOrder: vi.fn(), setPanel: vi.fn(), panel: 'dol', appRef: { current: null }, scale: 1 } as unknown as AppApi
  const mount = () => render(<AppCtx.Provider value={app}><div className="app"><RecepturyModule active setCtx={vi.fn()} setCmds={vi.fn()} /></div></AppCtx.Provider>)
  afterEach(cleanup)
  beforeEach(() => {
    ;[...Object.values(rec), ...Object.values(ing), pt.list, rb.materialTypes].forEach(fn => fn.mockReset())
    ;(app.toast as ReturnType<typeof vi.fn>).mockClear()
    rec.list.mockResolvedValue([KIRMIZI, BEYAZ])
    rec.archived.mockResolvedValue([{ ...BEYAZ, id: 'r9', name: 'STARA', active: false }])
    rec.usage.mockResolvedValue([{ recipeId: 'r1', openOrders: 2, openOrdersKg: 420, plannedMixing: 1, seasonedKg: 410.5, finishedKg: 0, catalogItems: 1, lastMixedAt: '2026-11-13T07:00:00Z' }])
    rec.usageOf.mockResolvedValue({ recipeId: 'r1', orders: [{ id: 'o1', orderNo: 'VATAN/Z/1/11/26', clientName: 'VATAN', deliveryDate: '2026-11-15', status: 'confirmed', qty: 10, kg: 300 }],
      mixing: [{ id: 'm1', orderNo: 'M/1', meatKg: 500, outputKg: 629, status: 'planned', createdAt: '2026-11-13T05:00:00Z' }], seasoned: [], catalog: [],
      blockers: ['otwarte zamówienia (1): VATAN/Z/1/11/26'] })
    ing.list.mockResolvedValue(SKL)
    ing.stock.mockResolvedValue([{ ingredientId: 'i-van', ingredientName: 'VAN', unit: 'kg', isUnlimited: false, qtyAvailable: 0, qtyReserved: 0 }])
    pt.list.mockResolvedValue([{ id: 'pt1', name: 'KEBAB UDO 100%', description: '', components: [], active: true, createdAt: '' }])
    rb.materialTypes.mockResolvedValue([])
  })

  it('lista: wydajność, użycie, wyszukiwanie po składniku', async () => {
    mount()
    const row = await screen.findByText('KIRMIZI')
    const tr = row.closest('tr')!
    expect(within(tr).getByText('125,85')).toBeTruthy()
    expect(within(tr).getByText('2 zamówienia')).toBeTruthy()
    expect(within(tr).getByText('1 masowanie')).toBeTruthy()
    expect(within(tr).getByText('dziś')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Szukaj receptury'), { target: { value: 'woda' } })
    expect(screen.queryByText('BEYAZ HALAL')).toBeNull()
    expect(screen.getByText('KIRMIZI')).toBeTruthy()
  })

  it('panel: skład z udziałem i zerowym stanem, gdzie użyta otwiera zamówienie', async () => {
    mount()
    fireEvent.click(await screen.findByText('KIRMIZI'))
    const dock = screen.getByLabelText('Szczegóły receptury')
    expect(within(dock).getByText('Półprodukt łącznie')).toBeTruthy()
    await waitFor(() => expect(within(dock).getByText('0').closest('td')!.className).toMatch(/crit-ink/))
    fireEvent.click(within(dock).getByRole('tab', { name: /Gdzie użyta/ }))
    fireEvent.click(await within(dock).findByText(/VATAN\/Z\/1\/11\/26/))
    expect(app.openOrder).toHaveBeenCalledWith('o1')
    expect(within(dock).getByText('zaplanowane')).toBeTruthy()
  })

  it('wycofanie receptury w użyciu jest zablokowane z powodem', async () => {
    const cmds = vi.fn()
    render(<AppCtx.Provider value={app}><RecepturyModule active setCtx={vi.fn()} setCmds={cmds} /></AppCtx.Provider>)
    fireEvent.click(await screen.findByText('KIRMIZI'))
    await waitFor(() => expect(cmds.mock.lastCall![0].find((c: { id: string }) => c.id === 'archive').disabled).toBe(false))
    React.act(() => cmds.mock.lastCall![0].find((c: { id: string }) => c.id === 'archive').run())
    expect(await screen.findByText(/otwarte zamówienia \(1\)/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Wycofaj recepturę' }) as HTMLButtonElement).disabled).toBe(true)
    expect(rec.deactivate).not.toHaveBeenCalled()
  })

  it('nowa receptura: zapis wysyła dawki z przecinkiem i nazwę rodzaju; zajęta nazwa nie przechodzi', async () => {
    const cmds = vi.fn()
    rec.create.mockImplementation(async (dto: unknown) => ({ ...BEYAZ, id: 'r5', name: 'YAPRAK', ...(dto as object) }))
    render(<AppCtx.Provider value={app}><RecepturyModule active setCtx={vi.fn()} setCmds={cmds} /></AppCtx.Provider>)
    await screen.findByText('KIRMIZI')
    React.act(() => cmds.mock.lastCall![0].find((c: { id: string }) => c.id === 'new').run())
    const nazwa = await screen.findByLabelText('Nazwa receptury')
    expect((screen.getByLabelText('Termin przydatności (dni)') as HTMLInputElement).value).toBe('364')
    fireEvent.change(nazwa, { target: { value: 'kirmizi' } })
    expect(screen.getByText(/już jest/)).toBeTruthy()
    fireEvent.change(nazwa, { target: { value: 'YAPRAK' } })
    const skl = screen.getByLabelText('Składnik 1')
    fireEvent.change(skl, { target: { value: 'van' } })
    fireEvent.keyDown(skl, { key: 'Enter' })
    fireEvent.change(screen.getByLabelText('Dawka 1'), { target: { value: '2,5' } })
    expect(screen.getByLabelText('Składnik 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz recepturę' }))
    await waitFor(() => expect(rec.create).toHaveBeenCalled())
    expect(rec.create.mock.calls[0][0]).toMatchObject({ name: 'YAPRAK', shelfLifeDays: 364, ingredients: [{ ingredientId: 'i-van', qtyPer100kg: 2.5 }] })
    await waitFor(() => expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dodano recepturę „YAPRAK”' })))
  })

  it('wycofane: przywrócenie jednym przyciskiem', async () => {
    rec.activate.mockResolvedValue({ ...BEYAZ, id: 'r9', name: 'STARA' })
    mount()
    await screen.findByText('KIRMIZI')
    fireEvent.click(screen.getByRole('button', { name: /Wycofane/ }))
    fireEvent.click(await screen.findByText('STARA'))
    fireEvent.click(within(screen.getByLabelText('Szczegóły receptury')).getByRole('button', { name: /Przywróć/ }))
    await waitFor(() => expect(rec.activate).toHaveBeenCalledWith('r9'))
  })
})
