import { describe, it, expect } from 'vitest'
import { mapClientOrder, type WzDoc } from '@/lib/api'
import { computeMetrics, etapZamowienia } from './model'
import { autoZDokumentow, mapujZamowienie } from './mapuj'

/**
 * Płynny status (właściciel 31.10.2026): „ładuję auto na YALCIN, a jest »potwierdzone«”.
 * Zamówienie w kształcie API (syntetyczne): jedna pozycja 20 × 40 kg, dwie palety.
 */
const RAW = (o: Record<string, unknown> = {}) => ({ id: 'o1', order_no: 'YALCIN/Z/7/10/26', client_name: 'YALCIN', status: 'confirmed', lines: [
  { id: 'a', qty: 20, kg_per_unit: 40, recipe_id: 'k', recipe_name: 'KIRMIZI', product_type_name: 'UDO', qty_stock: 0, qty_delivered: 0 },
], ...o })
const PAL = (s1: string, s2: string) => [
  { id: 'p1', palletNo: 1, cartonNo: '000801', status: s1, items: [{ orderLineId: 'a', qty: 10 }] },
  { id: 'p2', palletNo: 2, cartonNo: '000802', status: s2, items: [{ orderLineId: 'a', qty: 10 }] },
]
const zamowienie = (pal: unknown[], o: Record<string, unknown> = {}, zaladunki?: Record<string, { plate: string; at?: string }>, wz: WzDoc[] = []) =>
  mapujZamowienie(mapClientOrder(RAW(o)), { clients: [], pallets: { o1: pal as never }, wz, planByLine: {}, zaladunki })
const etap = (o: ReturnType<typeof zamowienie>) => etapZamowienia(o, computeMetrics(o))

describe('etap zamówienia — płynny status', () => {
  it('skany na auto: „W załadunku” z liczbą palet; po zakończeniu kursu „Załadowane” z numerem rejestracyjnym', () => {
    expect(etap(zamowienie(PAL('cold_storage', 'cold_storage')))).toMatchObject({ etap: 'potwierdzone', tekst: 'Potwierdzone' })
    expect(etap(zamowienie(PAL('loaded', 'cold_storage')))).toMatchObject({ etap: 'zaladunek', tekst: 'W załadunku', szczegol: '1/2 palet' })
    // Po kursie stan schodzi dopiero przy papierach biura — wyrób nadal liczy się jako „na magazynie”.
    const naStanie = { lines: [{ id: 'a', qty: 20, kg_per_unit: 40, recipe_id: 'k', recipe_name: 'KIRMIZI', qty_stock: 20 }] }
    expect(etap(zamowienie(PAL('shipped', 'shipped'), naStanie, { o1: { plate: 'KOL47267' } }))).toMatchObject({ etap: 'zaladowane', tekst: 'Załadowane', szczegol: 'KOL47267' })
  })
  it('drugie auto: część wyjechała, reszta właśnie się ładuje → „W załadunku” liczy obie; bez auta — „Załadowane częściowo”', () => {
    expect(etap(zamowienie(PAL('shipped', 'loaded')))).toMatchObject({ etap: 'zaladunek', szczegol: '2/2 palet' })
    expect(etap(zamowienie(PAL('shipped', 'cold_storage')))).toMatchObject({ etap: 'zaladowane', tekst: 'Załadowane częściowo', szczegol: '1/2 palet' })
  })
  it('wcześniej wyjechała część (dokument z autem), reszty brakuje → „Załadowane częściowo”; komplet na stanie → „Załadowane”', () => {
    const wz = [{ id: 'w1', number: 'WM/1', status: 'zatwierdzony', source_type: 'order', source_id: 'o1', vehicle_plate: 'KR12345', loaded_at: '2026-10-30T07:00:00Z', valued: false, lines: [], total_value: 0 }] as WzDoc[]
    const linia = (o: Record<string, unknown>) => ({ lines: [{ id: 'a', qty: 20, kg_per_unit: 40, recipe_id: 'k', recipe_name: 'KIRMIZI', ...o }] })
    expect(etap(zamowienie([], linia({ qty_delivered: 8 }), undefined, wz))).toMatchObject({ etap: 'zaladowane', tekst: 'Załadowane częściowo', szczegol: 'KR12345' })
    expect(etap(zamowienie(PAL('shipped', 'shipped'), linia({ qty_stock: 20 }), { o1: { plate: 'KOL47267' } }))).toMatchObject({ tekst: 'Załadowane', szczegol: 'KOL47267' })
  })
  it('paleta, która wyjechała, zostaje „wydana” (shipped), nie wraca jako rozpisana', () => {
    expect(zamowienie(PAL('shipped', 'loaded')).pallets.map(p => p.status)).toEqual(['shipped', 'loaded'])
  })
  it('przed załadunkiem: pokrycie → „W realizacji” z procentem, komplet → „Gotowe do wysyłki”; szkic i anulowane bez zmian', () => {
    expect(etap(zamowienie(PAL('created', 'created'), { lines: [{ id: 'a', qty: 20, kg_per_unit: 40, recipe_id: 'k', recipe_name: 'KIRMIZI', qty_stock: 5 }] })))
      .toMatchObject({ etap: 'realizacja', tekst: 'W realizacji', szczegol: '25%' })
    expect(etap(zamowienie(PAL('cold_storage', 'cold_storage'), { lines: [{ id: 'a', qty: 20, kg_per_unit: 40, recipe_id: 'k', recipe_name: 'KIRMIZI', qty_stock: 12, qty_delivered: 8 }] })))
      .toMatchObject({ etap: 'gotowe', tekst: 'Gotowe do wysyłki', szczegol: '2/2 palet' })
    expect(etap(zamowienie([], { status: 'draft' })).tekst).toBe('Szkic')
    expect(etap(zamowienie([], { status: 'cancelled' })).tekst).toBe('Anulowane')
  })
  it('zrealizowane: numer rejestracyjny z dokumentu wydania (stempel załadunku); anulowany dokument się nie liczy', () => {
    const wz = [
      { id: 'w1', number: 'WM/1', status: 'zatwierdzony', source_type: 'order', source_id: 'o1', vehicle_plate: 'KR12345', loaded_at: '2026-10-30T07:00:00Z', valued: false, lines: [], total_value: 0 },
      { id: 'w2', number: 'WM/2', status: 'anulowany', source_type: 'order', source_id: 'o1', vehicle_plate: 'XX00000', loaded_at: '2026-10-31T07:00:00Z', valued: false, lines: [], total_value: 0 },
    ] as WzDoc[]
    expect(autoZDokumentow('o1', wz)).toEqual({ plate: 'KR12345', at: '2026-10-30T07:00:00Z' })
    expect(etap(zamowienie([], { status: 'done' }, undefined, wz))).toMatchObject({ etap: 'zrealizowane', tekst: 'Zrealizowane', szczegol: 'KR12345' })
  })
})
