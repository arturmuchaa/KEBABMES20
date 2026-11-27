import { describe, expect, it } from 'vitest'
import type { SeasonedPallet } from '@/lib/api'
import {
  bledyPozycji, doDto, grupujZamowienia, lezyGodzin, podpowiedzPalet, prognozaKoncowki, stanPlanu, sumaKoncowek, sztukZPalety,
  type Pozycja, type Skladnik,
} from './model'

let nr = 40
function pal(p: Partial<SeasonedPallet>): SeasonedPallet {
  nr += 1
  return {
    id: p.id ?? `p${nr}`, qr: `SP|p${nr}`, palletNo: p.palletNo ?? nr, batchNo: '724', recipeId: 'kir', recipeName: 'KIRMIZI',
    seasonedMeatId: 'sm1', kgWeighed: 600, status: 'in_cold', isRemainder: false, parentId: null,
    labelPrintedAt: null, takenAt: null, takenBy: '', takenPlanId: null, returnedAt: null, kgReturned: null,
    mixedAt: '2026-11-26T08:00:00+01:00', materialTypeId: '', materialName: '', planIds: [], ...p,
  }
}
const poz = (p: Partial<Pozycja> = {}): Pozycja => ({
  klucz: 'k1', qty: 20, kgPerUnit: 40, recipeId: 'kir', productTypeId: 'pt', palety: [], zKoncowek: false, ...p,
})
const MIX: Skladnik[] = [{ materialTypeId: 'udo', nazwa: 'UDO', pct: 70 }, { materialTypeId: 'filet', nazwa: 'FILET', pct: 30 }]

describe('sztuki i końcówka', () => {
  it('liczy pełne sztuki z palety w dół', () => {
    expect(sztukZPalety(598, 40)).toBe(14)
    expect(sztukZPalety(600, 40)).toBe(15)
    expect(sztukZPalety(10, 0)).toBe(0)
  })
  it('przewiduje końcówkę palet pozycji', () => {
    expect(prognozaKoncowki([pal({ kgWeighed: 598 }), pal({ kgWeighed: 600 })], 29, 40)).toBe(38)
  })
  it('sumuje końcówki i liczy pełne sztuki', () => {
    const s = sumaKoncowek([pal({ kgWeighed: 24, isRemainder: true }), pal({ kgWeighed: 31, isRemainder: true })])
    expect(s.kg).toBe(55)
    expect(s.sztuk(40)).toBe(1)
  })
  it('licznik leżenia w pełnych godzinach od zważenia', () => {
    expect(lezyGodzin(pal({ mixedAt: '2026-11-26T20:00:00+01:00' }), new Date('2026-11-27T22:30:00+01:00'))).toBe(26)
    expect(lezyGodzin(pal({ mixedAt: null }), new Date())).toBe(0)
  })
})

describe('podpowiedź palet', () => {
  const k = pal({ id: 'k', kgWeighed: 120, isRemainder: true, mixedAt: '2026-11-26T10:00:00+01:00' })
  const A = pal({ id: 'A', mixedAt: '2026-11-25T08:00:00+01:00' })
  const B = pal({ id: 'B', mixedAt: '2026-11-26T08:00:00+01:00' })
  const C = pal({ id: 'C', mixedAt: '2026-11-27T20:00:00+01:00' })
  it('najpierw końcówki, potem palety leżące najdłużej, do pokrycia ilości', () => {
    expect(podpowiedzPalet(poz(), [], [C, B, A, k], new Map())).toEqual(['k', 'A', 'B'])
  })
  it('pomija kg zajęte w innych pozycjach planu', () => {
    expect(podpowiedzPalet(poz(), [], [C, B, A, k], new Map([['A', 600]]))).toEqual(['k', 'B', 'C'])
  })
  it('pomija palety innej receptury i spoza chłodni', () => {
    const D = pal({ id: 'D', recipeId: 'doner', mixedAt: '2026-11-20T08:00:00+01:00' })
    const E = pal({ id: 'E', status: 'on_hall', mixedAt: '2026-11-20T08:00:00+01:00' })
    expect(podpowiedzPalet(poz({ qty: 10 }), [], [D, E, A], new Map())).toEqual(['A'])
  })
  it('kebab mix: palety każdego składnika na jego udział', () => {
    const U1 = pal({ id: 'U1', materialTypeId: 'udo', kgWeighed: 600 })
    const F1 = pal({ id: 'F1', materialTypeId: 'filet', kgWeighed: 200, mixedAt: '2026-11-25T08:00:00+01:00' })
    const F2 = pal({ id: 'F2', materialTypeId: 'filet', kgWeighed: 300, mixedAt: '2026-11-26T08:00:00+01:00' })
    expect(podpowiedzPalet(poz(), MIX, [F2, F1, U1], new Map())).toEqual(['U1', 'F1', 'F2'])
  })
})

describe('błędy pozycji', () => {
  it('paleta innej receptury', () => {
    const d = pal({ id: 'd', palletNo: 42, recipeId: 'doner', recipeName: 'DONER' })
    expect(bledyPozycji(poz({ palety: ['d'] }), [], new Map([['d', d]]))).toContain('Paleta 42 to DONER')
  })
  it('za mało sztuk z palet', () => {
    const a = pal({ id: 'a', kgWeighed: 598 })
    expect(bledyPozycji(poz({ qty: 30, palety: ['a'] }), [], new Map([['a', a]]))).toContain('Palety dają 14 szt., a pozycja ma 30')
  })
  it('brak palet', () => {
    expect(bledyPozycji(poz(), [], new Map())).toContain('Wybierz palety')
  })
  it('kebab mix bez palety jednego składnika', () => {
    const u = pal({ id: 'u', materialTypeId: 'udo' })
    expect(bledyPozycji(poz({ palety: ['u'] }), MIX, new Map([['u', u]]))).toContain('Brak palety z mięsem FILET')
  })
  it('kebab mix z za małą paletą składnika', () => {
    const u = pal({ id: 'u', materialTypeId: 'udo' })
    const f = pal({ id: 'f', materialTypeId: 'filet', kgWeighed: 144 })
    expect(bledyPozycji(poz({ palety: ['u', 'f'] }), MIX, new Map([['u', u], ['f', f]])))
      .toContain('FILET: palety dają 12 szt., a pozycja ma 20')
  })
  it('paleta wywieziona do TEGO planu nie jest błędem (edycja w trakcie dnia)', () => {
    const a = pal({ id: 'a', status: 'on_hall', takenPlanId: 'pl1', kgWeighed: 600 })
    expect(bledyPozycji(poz({ qty: 15, palety: ['a'] }), [], new Map([['a', a]]), 'pl1')).toEqual([])
    expect(bledyPozycji(poz({ qty: 15, palety: ['a'] }), [], new Map([['a', a]]), 'inny')).toContain(`Paleta ${a.palletNo} nie leży w chłodni`)
  })
  it('pozycji rozpoczętej przez halę nie sprawdzamy — jej palety i ilość są już na hali', () => {
    expect(bledyPozycji(poz({ zamrozona: true, palety: [] }), [], new Map())).toEqual([])
  })
  it('pozycja z końcówek liczy sztuki z sumy kg', () => {
    const a = pal({ id: 'a', kgWeighed: 24, isRemainder: true, batchNo: '724' })
    const b = pal({ id: 'b', kgWeighed: 31, isRemainder: true, batchNo: '731' })
    expect(bledyPozycji(poz({ qty: 1, zKoncowek: true, palety: ['a', 'b'] }), [], new Map([['a', a], ['b', b]]))).toEqual([])
  })
})

describe('zapis i stan planu', () => {
  it('DTO włącza blokadę palet i niesie palety w kolejności', () => {
    const dto = doDto([poz({ palety: ['p2', 'p1'], zKoncowek: true }), poz({ klucz: 'k2', qty: 0 })], '2026-11-28')
    expect(dto.palletGate).toBe(true)
    expect(dto.planDate).toBe('2026-11-28')
    expect(dto.lines).toHaveLength(1)
    expect(dto.lines[0].palletIds).toEqual(['p2', 'p1'])
    expect(dto.lines[0].fromRemainders).toBe(true)
  })
  const sum = (s: Partial<NonNullable<Parameters<typeof stanPlanu>[0]['summary']>>) => ({
    units: 10, labelsPrinted: 10, pallets: 2, palletsTaken: 0, palletsReturned: 0, balanceReady: false, ...s,
  })
  it('stan planu z serwerowego podsumowania', () => {
    expect(stanPlanu({ status: 'draft', summary: null })).toBe('szkic')
    expect(stanPlanu({ status: 'active', summary: sum({ labelsPrinted: 4 }) })).toBe('do-druku')
    expect(stanPlanu({ status: 'active', summary: sum({}) })).toBe('gotowy')
    expect(stanPlanu({ status: 'active', summary: sum({ palletsTaken: 1 }) })).toBe('w-produkcji')
    expect(stanPlanu({ status: 'done', summary: sum({ balanceReady: false }) })).toBe('do-bilansu')
    expect(stanPlanu({ status: 'done', summary: sum({ balanceReady: true }) })).toBe('zamkniety')
  })
})

describe('zamówienia do wciągnięcia — pogrupowane klient → zamówienie', () => {
  const l = (clientName: string, orderNo: string, lineId: string, qty: number, kg = 40) => ({
    orderId: `o-${orderNo}`, orderNo, clientId: `c-${clientName}`, clientName, lineId, productTypeId: 'udo', recipeId: 'kir',
    packagingId: '', kgPerUnit: kg, qtyRemaining: qty, qtyOrdered: qty, kg: qty * kg,
  })
  it('klienci alfabetycznie, zamówienia po numerze, pozycje w kolejności zamówienia; sumy kg i sztuk', () => {
    const g = grupujZamowienia([l('YALCIN', 'YAL/Z/2', 'a', 10), l('TRUVA', 'TRU/Z/1', 'b', 20), l('YALCIN', 'YAL/Z/1', 'c', 14), l('YALCIN', 'YAL/Z/2', 'd', 5, 30)])
    expect(g.map(k => k.clientName)).toEqual(['TRUVA', 'YALCIN'])
    expect(g[1].zamowienia.map(z => z.orderNo)).toEqual(['YAL/Z/1', 'YAL/Z/2'])
    expect(g[1].zamowienia[1].linie.map(x => x.lineId)).toEqual(['a', 'd'])
    expect(g[1].zamowienia[1]).toMatchObject({ szt: 15, kg: 550 })
    expect(g[1]).toMatchObject({ szt: 29, kg: 1110 })
  })
  it('filtr po kliencie, numerze zamówienia albo nazwie receptury', () => {
    const lista = [l('YALCIN', 'YAL/Z/1', 'a', 10), l('TRUVA', 'TRU/Z/1', 'b', 20)]
    expect(grupujZamowienia(lista, 'tru').map(k => k.clientName)).toEqual(['TRUVA'])
    expect(grupujZamowienia(lista, 'yal/z').map(k => k.clientName)).toEqual(['YALCIN'])
    expect(grupujZamowienia(lista, 'kirm', () => 'KIRMIZI')).toHaveLength(2)
    expect(grupujZamowienia(lista, 'beyaz', () => 'KIRMIZI')).toHaveLength(0)
  })
})
