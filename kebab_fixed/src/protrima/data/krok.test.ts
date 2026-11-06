import { describe, it, expect } from 'vitest'
import { mapClientOrder } from '@/lib/api'
import { computeMetrics, TODAY, addDays } from './model'
import { mapujZamowienie } from './mapuj'
import { etapyZamowienia, nastepnyKrok } from './krok'

/** Zamówienie w kształcie API (syntetyczne): jedna pozycja 20 × 40 kg. */
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const zam = (o: Record<string, unknown> = {}, linia: Record<string, unknown> = {}, pal: unknown[] = []) => mapujZamowienie(mapClientOrder({
  id: 'o1', order_no: 'X/Z/1/10/26', client_name: 'X', status: 'confirmed', order_date: iso(TODAY),
  lines: [{ id: 'a', qty: 20, kg_per_unit: 40, recipe_id: 'k', recipe_name: 'KIRMIZI', product_type_name: 'UDO', qty_stock: 0, qty_delivered: 0, ...linia }],
  ...o,
} as never), { clients: [], pallets: { o1: pal as never }, wz: [], planByLine: {} })
const PALETA = (status: string, qty = 20) => [{ id: 'p1', palletNo: 1, cartonNo: '000801', status, items: [{ orderLineId: 'a', qty }] }]
const krok = (o: ReturnType<typeof zam>) => nastepnyKrok(o, computeMetrics(o))
const zaDni = (n: number) => iso(addDays(TODAY, n))

describe('następny krok zamówienia — jedno słowo na liście, w panelu i na Pulpicie', () => {
  it('szkic → „Potwierdź” (czynność biura)', () => {
    expect(krok(zam({ status: 'draft' }))).toMatchObject({ kod: 'potwierdz', tekst: 'Potwierdź', akcja: true })
  })
  it('wyrób jest, palety nierozpisane → „Rozpisz palety”', () => {
    expect(krok(zam({ delivery_date: zaDni(5) }, { qty_stock: 20 }))).toMatchObject({ kod: 'palety', akcja: true, tab: 'pallets', pilne: false })
  })
  it('brak wyrobu i wyjazd za tydzień → czekanie na wyrób, bez nawoływania do palet', () => {
    expect(krok(zam({ delivery_date: zaDni(7) }))).toMatchObject({ kod: 'czeka-wyrob', akcja: false })
  })
  it('brak wyrobu, auto jutro, palety nierozpisane → pilne „Rozpisz palety”; z paletami → „Brakuje wyrobu”', () => {
    expect(krok(zam({ delivery_date: zaDni(1) }))).toMatchObject({ kod: 'palety', pilne: true })
    expect(krok(zam({ delivery_date: zaDni(1) }, {}, PALETA('created')))).toMatchObject({ kod: 'brak-wyrobu', pilne: true })
  })
  it('komplet i palety rozpisane → „Czeka na załadunek”; skan na auto → „W załadunku”', () => {
    expect(krok(zam({ delivery_date: zaDni(3) }, { qty_stock: 20 }, PALETA('packed')))).toMatchObject({ kod: 'czeka-zaladunek', akcja: false })
    expect(krok(zam({ delivery_date: zaDni(0) }, { qty_stock: 20 }, PALETA('loaded')))).toMatchObject({ kod: 'w-zaladunku', akcja: false })
  })
  it('auto odjechało (kurs zakończony) → „Papiery kursu” (czynność biura)', () => {
    expect(krok(zam({ delivery_date: zaDni(0) }, { qty_stock: 20 }, PALETA('shipped')))).toMatchObject({ kod: 'papiery', akcja: true, tab: 'shipping' })
  })
  it('wcześniej wyjechała część (WZ z autem już wystawiona), reszty brakuje → nie „Papiery kursu”, tylko prawdziwy krok', () => {
    // Przegląd 0.6.0: auto z wystawionej WZ dawało etap „Załadowane częściowo”, a „Dalej” podsuwało papiery,
    // których nie da się wystawić („To zamówienie nie czeka na papiery kursu”) i chowało brak wyrobu.
    const wz = [{ id: 'w1', number: 'WM/1', status: 'zatwierdzony', source_type: 'order', source_id: 'o1', vehicle_plate: 'KR12345', loaded_at: '2026-10-30T07:00:00Z', valued: false, lines: [], total_value: 0 }]
    const o = mapujZamowienie(mapClientOrder({
      id: 'o1', order_no: 'X/Z/1/10/26', client_name: 'X', status: 'confirmed', order_date: iso(TODAY), delivery_date: zaDni(5),
      lines: [{ id: 'a', qty: 20, kg_per_unit: 40, recipe_id: 'k', recipe_name: 'KIRMIZI', product_type_name: 'UDO', qty_stock: 0, qty_delivered: 8 }],
    } as never), { clients: [], pallets: { o1: [] }, wz: wz as never, planByLine: {} })
    expect(krok(o)).toMatchObject({ kod: 'czeka-wyrob', dopisek: '480 kg' })
  })
  it('drugie auto po częściowej WZ: kurs naprawdę czeka na biuro → „Papiery kursu”', () => {
    const wz = [{ id: 'w1', number: 'WM/1', status: 'zatwierdzony', source_type: 'order', source_id: 'o1', vehicle_plate: 'KR1', loaded_at: '2026-10-30T07:00:00Z', valued: false, lines: [], total_value: 0 }]
    const o = mapujZamowienie(mapClientOrder({
      id: 'o1', order_no: 'X/Z/1/10/26', client_name: 'X', status: 'confirmed', order_date: iso(TODAY), delivery_date: zaDni(0),
      lines: [{ id: 'a', qty: 20, kg_per_unit: 40, recipe_id: 'k', recipe_name: 'KIRMIZI', product_type_name: 'UDO', qty_stock: 12, qty_delivered: 8 }],
    } as never), { clients: [], pallets: { o1: PALETA('shipped', 12) as never }, wz: wz as never, planByLine: {}, zaladunki: { o1: { plate: 'KR2', czekaNaBiuro: true } } })
    expect(krok(o)).toMatchObject({ kod: 'papiery', akcja: true, dopisek: 'KR2' })
  })
  it('zamknięte zamówienia nie mają kroku do zrobienia', () => {
    expect(krok(zam({ status: 'done' }))).toMatchObject({ kod: 'zrealizowane', akcja: false, pilne: false })
    expect(krok(zam({ status: 'cancelled' }))).toMatchObject({ kod: 'anulowane', akcja: false })
  })
})

describe('etapy zamówienia (szyna)', () => {
  it('siedem etapów w kolejności zakładu, jedno słownictwo miar', () => {
    const e = etapyZamowienia(zam({ delivery_date: zaDni(4) }), computeMetrics(zam({ delivery_date: zaDni(4) })))
    expect(e.map(x => x.name)).toEqual(['Przyjęte', 'Zaplanowane', 'Produkcja', 'Pokrycie', 'Palety', 'Załadunek', 'Wydano'])
  })
  it('cały wyrób z magazynu: plan i produkcja „nie trzeba” w normie (bez fałszywego bursztynu)', () => {
    const o = zam({ delivery_date: zaDni(1) }, { qty_stock: 20 })
    const e = etapyZamowienia(o, computeMetrics(o))
    expect(e[1]).toMatchObject({ value: 'nie trzeba', level: 'ok' })
    expect(e[2]).toMatchObject({ value: 'nie trzeba', level: 'ok' })
    expect(e[3]).toMatchObject({ value: '100%', level: 'ok' })
  })
  it('pokrycie przy braku kilku kg pokazuje 99%, nie zaokrąglone 100%', () => {
    const o = zam({ delivery_date: zaDni(5) }, { qty: 1000, kg_per_unit: 1, qty_stock: 999 })
    expect(etapyZamowienia(o, computeMetrics(o))[3].value).toBe('99%')
  })
})
