// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'
import type { Recipe } from '@/features/ingredients/types'

const mix = vi.hoisted(() => ({ dayPlan: vi.fn(), saveDayPlan: vi.fn(), demand: vi.fn(), stale: vi.fn(), finishSession: vi.fn(), cancel: vi.fn(), move: vi.fn(), undoConfirm: vi.fn() }))
const rec = vi.hoisted(() => ({ list: vi.fn() }))
const ing = vi.hoisted(() => ({ stock: vi.fn() }))
const meat = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), mixingOrdersApi: mix, recipesApi: rec, ingredientsApi: ing, meatStockApi: meat }))
import { PlanMasowaniaModule } from './PlanMasowaniaModule'
import {
  bilans, bledy, doZapisu, dzisIso, nazwaDnia, odcisk, opisWsadow, polprodukt, potrzebyNaZywo, przesun, przesunDzien, przyprawyPlanu, rodzajDnia,
  stanPartii, wsady, zOgonem, zPlanu, type PartiaMiesa, type Wiersz,
} from './model'

const DZIS = dzisIso()
const KIRMIZI: Recipe = { id: 'r1', name: 'KIRMIZI', totalOutputPer100kg: 125, shelfLifeDays: 364, active: true, createdAt: '', components: [],
  ingredients: [
    { id: 'a', ingredientId: 'i-berg', ingredientName: 'BERG', unit: 'kg', qtyPer100kg: 5, isUnlimited: false },
    { id: 'b', ingredientId: 'i-woda', ingredientName: 'WODA', unit: 'l', qtyPer100kg: 20, isUnlimited: true },
  ] }
const BEYAZ: Recipe = { ...KIRMIZI, id: 'r2', name: 'BEYAZ' }
const REC = new Map([[KIRMIZI.id, KIRMIZI], [BEYAZ.id, BEYAZ]])
const w = (p: Partial<Wiersz>): Wiersz => ({ klucz: p.klucz ?? `k${Math.random()}`, recipeId: 'r1', kg: '600', uwagi: '', status: 'new', lots: [], ...p })
const PARTIE: PartiaMiesa[] = [
  { id: 'ms1', lotNo: '712', kgAvailable: 1000, expiryDate: '2026-11-15', materialTypeId: 'mat-mieso-zs' },
  { id: 'ms2', lotNo: '713', kgAvailable: 500, expiryDate: '2026-11-16', materialTypeId: 'mat-mieso-zs' },
  { id: 'ms4', lotNo: '715', kgAvailable: 300, expiryDate: '2026-11-16', materialTypeId: 'mat-filet-kurczak', materialName: 'Filet' },
]

describe('Plan masowania — logika', () => {
  it('wsady masownic: 600 i 200, reszta dolewana do ostatniego wsadu w granicach maksimum', () => {
    expect(wsady(600)).toEqual([600]); expect(wsady(650)).toEqual([650]); expect(wsady(800)).toEqual([600, 200])
    expect(wsady(850)).toEqual([600, 250]); expect(wsady(742)).toEqual([600, 142]); expect(wsady(120)).toEqual([120]); expect(wsady(0)).toEqual([])
    expect(opisWsadow(1000)).toBe('600 + 2×200'); expect(opisWsadow(1800)).toBe('3×600')
  })
  it('półprodukt jak serwer: mięso + składniki w kg/l i woda', () => {
    expect(polprodukt(KIRMIZI, 600)).toBe(750)
    expect(polprodukt({ ...KIRMIZI, ingredients: [{ ...KIRMIZI.ingredients[0], unit: 'g', qtyPer100kg: 500 }] }, 600)).toBe(600)
  })
  it('dni: dziś / jutro / miniony', () => {
    expect(nazwaDnia(DZIS)).toBe('dziś'); expect(nazwaDnia(przesunDzien(DZIS, 1))).toBe('jutro'); expect(nazwaDnia(przesunDzien(DZIS, -1))).toBe('wczoraj')
    expect(rodzajDnia(przesunDzien(DZIS, -3))).toBe('miniony'); expect(rodzajDnia(przesunDzien(DZIS, 2))).toBe('przyszly')
    expect(przesunDzien('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('pokrycie partiami i błędy przy polu; pozycji w masownicy nie sprawdzamy', () => {
    const cz = w({ klucz: 'a', lots: [{ meatLotId: 'ms1', kgPlanned: 250 }] })
    expect(stanPartii(cz)).toBe('czesc'); expect(stanPartii(w({ lots: [{ meatLotId: 'ms1', kgPlanned: 600 }] }))).toBe('komplet'); expect(stanPartii(w({}))).toBe('brak')
    const b = bledy([w({ klucz: 'x', recipeId: '', kg: '50' }), w({ klucz: 'x2', kg: '' }), w({ klucz: 'y', kg: '0' }), w({ klucz: 'z', kg: '100', lots: [{ meatLotId: 'ms1', kgPlanned: 300 }] }),
      w({ klucz: 'm', status: 'in_progress', id: 'o1', recipeId: '', kg: '' }), w({ klucz: 'ogon', recipeId: '', kg: '' })])
    expect(b.x).toEqual({ receptura: 'Wybierz recepturę' }); expect(b.x2).toEqual({ kg: 'Podaj kg mięsa' }); expect(b.ogon).toBeUndefined()
    expect(b.y.kg).toMatch(/większe od zera/); expect(b.z.partie).toMatch(/przekraczają/); expect(b.m).toBeUndefined()
  })
  it('zapis: kolejność = seq, pusty ogon nie idzie, uwagi i przecinek dziesiętny; odcisk łapie zmianę kolejności', () => {
    const a = w({ klucz: 'a', id: 'o1', kg: '612,5', uwagi: ' filet osobno ', lots: [{ meatLotId: 'ms1', kgPlanned: 612.5 }, { meatLotId: 'ms2', kgPlanned: 0 }] })
    const b2 = w({ klucz: 'b', recipeId: 'r2', kg: '200' })
    const lista = zOgonem([a, b2])
    expect(lista).toHaveLength(3)
    expect(doZapisu(lista)).toEqual([
      { id: 'o1', recipeId: 'r1', meatKg: 612.5, seq: 1, notes: 'filet osobno', meatLots: [{ meatLotId: 'ms1', kgPlanned: 612.5 }] },
      { id: undefined, recipeId: 'r2', meatKg: 200, seq: 2, notes: '', meatLots: [] },
    ])
    expect(odcisk(przesun(lista, 'b', -1))).not.toBe(odcisk(lista))
    expect(odcisk(zOgonem(lista))).toBe(odcisk(lista))
  })
  it('bilans z/s: kg bez partii liczą się do z/s, filet przypisany ręcznie nie; pozycja gotowa nie bierze z puli', () => {
    const b = bilans([w({ kg: '600', lots: [{ meatLotId: 'ms1', kgPlanned: 400 }, { meatLotId: 'ms4', kgPlanned: 200 }] }), w({ kg: '300' }),
      w({ status: 'done', id: 'o9', kg: '800' }), w({ status: 'in_progress', id: 'o8', kg: '800', kgDone: 600 })], REC, PARTIE)
    expect(b.pulaZs).toBe(1500); expect(b.potrzebaZs).toBe(900); expect(b.zostanieZs).toBe(600); expect(b.bezPartiiKg).toBe(300); expect(b.miesoKg).toBe(2500)
  })
  it('przyprawy: tylko niewykonana część planu, brak liczony do stanu, woda bez stanu', () => {
    const p = przyprawyPlanu([w({ kg: '600' }), w({ status: 'done', id: 'o1', kg: '1000' }), w({ status: 'in_progress', id: 'o2', kg: '800', kgDone: 600 })], REC,
      [{ ingredientId: 'i-berg', ingredientName: 'BERG', unit: 'kg', isUnlimited: false, qtyAvailable: 25, qtyReserved: 0 }])
    expect(p[0]).toMatchObject({ nazwa: 'BERG', potrzeba: 40, stan: 25, brak: 15 })
    expect(p[1]).toMatchObject({ nazwa: 'WODA', bezStanu: true, brak: 0 })
  })
  it('potrzeby z zamówień schodzą na żywo ze szkicem; propozycja w pełnych wsadach 200 kg', () => {
    const dane = [{ recipeId: 'r1', recipeName: 'KIRMIZI', orderedKg: 1250, seasonedFreeKg: 250, productionPlanKg: 0, plannedMixingKg: 500, plannedMixingThisDayKg: 500,
      missingOutputKg: 500, missingMeatKg: 400, nearestDelivery: '2026-12-02', orders: [] }]
    // Szkic = zapisany plan dnia (400 kg mięsa → 500 kg): brak 500 kg półproduktu → 400 kg mięsa.
    expect(potrzebyNaZywo([w({ id: 'o1', status: 'confirmed', kg: '400' })], dane, REC)[0]).toMatchObject({ brakKg: 500, proponowaneMiesoKg: 400 })
    // Dopisana pozycja 400 kg pokrywa brak.
    expect(potrzebyNaZywo([w({ id: 'o1', status: 'confirmed', kg: '400' }), w({ kg: '400' })], dane, REC)[0].brakKg).toBe(0)
    // Pusty szkic: brak 1000 → 800 kg mięsa.
    expect(potrzebyNaZywo([], dane, REC)[0]).toMatchObject({ brakKg: 1000, proponowaneMiesoKg: 800 })
    // 742 kg braku → 593,6 kg mięsa → 600.
    expect(potrzebyNaZywo([], [{ ...dane[0], orderedKg: 742, seasonedFreeKg: 0, plannedMixingKg: 0, plannedMixingThisDayKg: 0 }], REC)[0].proponowaneMiesoKg).toBe(600)
  })
  it('plan z serwera: gotowa pozycja pokazuje zużyte kg i numer partii przyprawionego', () => {
    const [x] = zPlanu([{ id: 'o1', recipeId: 'r1', meatKg: 600, status: 'done', notes: 'x', meatLots: [{ meatLotId: 'ms1', meatLotNo: '712', kgPlanned: 0, kgActual: 600 }],
      sessions: [{ batchNo: '712', kgMeat: 600, kgOutput: 750 }] }])
    expect(x).toMatchObject({ kg: '600', uwagi: 'x', status: 'done', partie: [{ batchNo: '712' }] })
    expect(stanPartii(x)).toBe('komplet')
  })
})

describe('Plan masowania — ekran', () => {
  const app = { toast: vi.fn(), openOrder: vi.fn(), appRef: { current: null }, scale: 1 } as unknown as AppApi
  const cmds = vi.fn()
  const mount = () => render(<AppCtx.Provider value={app}><PlanMasowaniaModule active setCtx={vi.fn()} setCmds={cmds} /></AppCtx.Provider>)
  const cmd = (id: string) => cmds.mock.lastCall![0].find((c: { id: string }) => c.id === id)
  const PLAN = [
    { id: 'o1', recipeId: 'r1', recipeName: 'KIRMIZI', meatKg: 600, status: 'confirmed', orderNo: 'MAS/1', kgDone: 0, notes: '', sessions: [],
      meatLots: [{ meatLotId: 'ms1', meatLotNo: '712', kgPlanned: 400, kgActual: 0 }, { meatLotId: 'ms2', meatLotNo: '713', kgPlanned: 200, kgActual: 0 }] },
  ]
  afterEach(cleanup)
  beforeEach(() => {
    ;[...Object.values(mix), rec.list, ing.stock, meat.list, cmds].forEach(f => f.mockReset())
    ;(app.toast as ReturnType<typeof vi.fn>).mockClear()
    mix.dayPlan.mockResolvedValue({ items: PLAN, rev: 'a', planDate: DZIS })
    mix.saveDayPlan.mockResolvedValue({ items: PLAN, rev: 'b', planDate: DZIS })
    mix.demand.mockResolvedValue({ planDate: DZIS, items: [{ recipeId: 'r2', recipeName: 'BEYAZ', orderedKg: 1000, seasonedFreeKg: 0, productionPlanKg: 0, plannedMixingKg: 0, plannedMixingThisDayKg: 0,
      missingOutputKg: 1000, missingMeatKg: 800, nearestDelivery: '2026-12-02', orders: [{ id: 'z1', orderNo: 'BEY/Z/1', clientName: 'BEYOGLU', deliveryDate: '2026-12-02', kg: 1000 }] }] })
    mix.stale.mockResolvedValue([{ id: 's1', recipeId: 'r1', recipeName: 'KIRMIZI', meatKg: 600, status: 'confirmed', planDate: przesunDzien(DZIS, -1), reservedKg: 600,
      meatLots: [{ meatLotId: 'ms2', meatLotNo: '713', kgPlanned: 600, kgActual: 0 }], sessions: [] }])
    rec.list.mockResolvedValue([KIRMIZI, BEYAZ])
    ing.stock.mockResolvedValue([{ ingredientId: 'i-berg', ingredientName: 'BERG', unit: 'kg', isUnlimited: false, qtyAvailable: 10, qtyReserved: 0 }])
    meat.list.mockResolvedValue({ data: [{ id: 'ms1', lotNo: '712', kgAvailable: 600, expiryDate: '2026-11-15', materialTypeId: 'mat-mieso-zs', status: 'AVAILABLE' },
      { id: 'ms2', lotNo: '713', kgAvailable: 300, expiryDate: '2026-11-16', materialTypeId: 'mat-mieso-zs', status: 'AVAILABLE' }] })
  })

  it('potrzeba z zamówień → pozycja w planie → zapis z seq i uwagami', async () => {
    mount()
    const tbl = await screen.findByLabelText('Pozycje planu masowania')
    await within(tbl).findByDisplayValue('600')
    fireEvent.click(await screen.findByRole('button', { name: /800 kg mięsa/ }))
    expect(within(tbl).getByDisplayValue('800')).toBeTruthy()
    expect(screen.getByText(/Zamówienia mają pokrycie/)).toBeTruthy()
    expect(cmd('save').disabled).toBe(false)
    await React.act(async () => { await cmd('save').run() })
    expect(mix.saveDayPlan).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'o1', recipeId: 'r1', meatKg: 600, seq: 1, notes: '' }),
      expect.objectContaining({ id: undefined, recipeId: 'r2', meatKg: 800, seq: 2, meatLots: [] }),
    ], DZIS)
  })

  it('powłoka renderująca się po setCmds nie wpada w pętlę (zablokowany pasek boczny)', async () => {
    // Jak App: setCmds zapisuje polecenia w stanie powłoki, co renderuje moduł ponownie.
    let wywolan = 0
    function Powloka() {
      const [, setC] = React.useState<unknown>(null)
      const ustaw = React.useCallback((c: unknown) => { wywolan++; setC(c) }, [])
      return <AppCtx.Provider value={app}><PlanMasowaniaModule active setCtx={vi.fn()} setCmds={ustaw} /></AppCtx.Provider>
    }
    const blad = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Powloka />)
    const tbl = await screen.findByLabelText('Pozycje planu masowania')
    await within(tbl).findByDisplayValue('600')
    const po = wywolan
    await new Promise(r => setTimeout(r, 50))
    expect(wywolan).toBe(po)
    expect(wywolan).toBeLessThan(20)
    expect(blad.mock.calls.some(c => String(c[0]).includes('Maximum update depth'))).toBe(false)
    blad.mockRestore()
  })

  it('zaległe zlecenie widać na dzisiejszym planie; przeniesienie woła serwer', async () => {
    mix.move.mockResolvedValue({})
    mount()
    expect(await screen.findByText(/Zaległe zlecenia z poprzednich dni: 1/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: /Przenieś…/ })[0])
    fireEvent.click(await screen.findByRole('button', { name: /Przenieś na dziś/ }))
    await waitFor(() => expect(mix.move).toHaveBeenCalledWith('s1', DZIS))
  })

  it('długa lista zaległych: zwinięta, te z mięsem na wierzchu, hurtowe anulowanie tylko tych bez mięsa', async () => {
    const z = (id: string, reservedKg: number) => ({ id, recipeId: 'r1', recipeName: `REC-${id}`, meatKg: 600, status: 'confirmed', planDate: przesunDzien(DZIS, -9), reservedKg,
      meatLots: reservedKg ? [{ meatLotId: 'ms2', meatLotNo: '713', kgPlanned: reservedKg, kgActual: 0 }] : [], sessions: [] })
    mix.stale.mockResolvedValue([z('a', 0), z('b', 0), z('c', 4000), z('d', 0), z('e', 0)])
    mix.cancel.mockResolvedValue({})
    mount()
    expect(await screen.findByText(/Zaległe zlecenia z poprzednich dni: 5/)).toBeTruthy()
    expect(screen.getByText('REC-c')).toBeTruthy()            // trzyma mięso — widać od razu
    expect(screen.queryByText('REC-a')).toBeNull()            // reszta zwinięta
    fireEvent.click(screen.getByRole('button', { name: /Anuluj 4 bez mięsa…/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Anuluj 4 zleceń' }))
    await waitFor(() => expect(mix.cancel).toHaveBeenCalledTimes(4))
    expect(mix.cancel.mock.calls.map(c => c[0])).toEqual(['a', 'b', 'd', 'e'])
  })

  it('potwierdzenie pozycji z dwóch partii: podział i sekwencja sesji, mieszana ostatnia', async () => {
    mix.finishSession.mockResolvedValue({})
    mount()
    const tbl = await screen.findByLabelText('Pozycje planu masowania')
    await within(tbl).findByDisplayValue('600')
    fireEvent.click(within(tbl).getByRole('button', { name: /Potwierdź…/ }))
    // 400 + 200 → brak resztek (mod 200) → dwie partie czyste, bez mieszanej.
    fireEvent.click(await screen.findByRole('button', { name: /Potwierdź — 2 partie/ }))
    await waitFor(() => expect(mix.finishSession).toHaveBeenCalledTimes(2))
    expect(mix.finishSession.mock.calls[0]).toEqual(['o1', 400, '', [{ meatLotId: 'ms1', kg: 400 }]])
    expect(mix.finishSession.mock.calls[1]).toEqual(['o1', 200, '', [{ meatLotId: 'ms2', kg: 200 }]])
  })

  it('niezapisany plan blokuje potwierdzenie i wydruk; błąd pola zatrzymuje zapis', async () => {
    mount()
    const tbl = await screen.findByLabelText('Pozycje planu masowania')
    const kg = await within(tbl).findByDisplayValue('600')
    fireEvent.change(kg, { target: { value: '0' } })
    expect((within(tbl).getByRole('button', { name: /Potwierdź…/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(cmd('print').disabled).toBe(true)
    await React.act(async () => { cmd('save').onDisabledClick?.(); await cmd('save').run() })
    expect(mix.saveDayPlan).not.toHaveBeenCalled()
    expect(within(tbl).getByText(/większe od zera/)).toBeTruthy()
  })

  it('plan miniony: tylko podgląd, bez zapisu, z anulowaniem niewykonanego zlecenia', async () => {
    mount()
    await screen.findByLabelText('Pozycje planu masowania')
    mix.dayPlan.mockResolvedValue({ items: PLAN, rev: 'a', planDate: przesunDzien(DZIS, -1) })
    fireEvent.click(screen.getByLabelText('Dzień wcześniej'))
    expect(await screen.findByText(/plan miniony — tylko podgląd/)).toBeTruthy()
    await waitFor(() => expect(cmd('save')).toBeUndefined())
    const tbl = screen.getByLabelText('Pozycje planu masowania')
    expect(await within(tbl).findByRole('button', { name: /Anuluj…/ })).toBeTruthy()
    expect(within(tbl).queryByDisplayValue('600')).toBeNull()
  })
})
