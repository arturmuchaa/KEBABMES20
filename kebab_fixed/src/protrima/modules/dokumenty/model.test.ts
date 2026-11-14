import { describe, it, expect } from 'vitest'
import { zWz, zCmr, zHdi, filtruj, sortuj, dzialania, FILTR_DOMYSLNY, type Dok, type Filtr } from './model'

const wz = (o: Record<string, unknown> = {}) => zWz({ id: 'w1', number: 'WZ/2/11/26', buyer_name: 'VATAN Sp. z o.o.', total_value: 8670.3, valued: true, status: 'wstepny',
  issued_date: '2026-11-14', release_date: '2026-11-14', currency: 'PLN', source_type: 'manual', doc_series: 'WZ', ...o })
const F = (o: Partial<Filtr> = {}): Filtr => ({ ...FILTR_DOMYSLNY, okres: 'wszystko', ...o })
const DZIS = '2026-11-14'

describe('Dokumenty — wiersze', () => {
  it('WZ: stan z serii, załadunku i anulowania; wartość z walutą', () => {
    expect(wz().etykietaStanu).toBe('wystawiony')
    expect(wz({ loaded_at: '2026-11-14T08:00:00Z' }).etykietaStanu).toBe('załadowany')
    expect(wz({ loading_status: 'rozjazd', loaded_at: 'x' }).etykietaStanu).toBe('rozjazd')
    const a = wz({ status: 'anulowany' })
    expect([a.stan, a.etykietaStanu]).toEqual(['anulowany', 'anulowany'])
    expect(wz({ doc_series: 'WM', valued: false }).wartosc).toBeNull()
    expect(wz({ currency: 'EUR' }).waluta).toBe('EUR')
    expect(wz({ release_date: '', issued_date: '2026-11-10' }).data).toBe('2026-11-10')
  })
  it('CMR i HDI: klient, zamówienie, przewoźnik, rodzaj, niekompletny', () => {
    const c = zCmr({ id: 'c1', number: '68/11/26', client_name: 'VATAN', status: 'wystawiony', issue_date: '2026-11-13', order_id: 'o1', order_no: 'VATAN/Z/3', carrier_name: 'TRANS-POL', scope: 'fv' })
    expect([c.klient, c.orderNo, c.przewoznik, c.rodzajHdi]).toEqual(['VATAN', 'VATAN/Z/3', 'TRANS-POL', 'do faktury'])
    const h = zHdi({ id: 'h1', number: '52/11/26', client_name: 'VATAN', status: 'wystawiony', incomplete: true, issue_date: '2026-11-13', scope: 'usluga' })
    expect([h.rodzajHdi, h.etykietaStanu]).toEqual(['usługa', 'niekompletny'])
  })
})

describe('Dokumenty — filtr', () => {
  const lista: Dok[] = [
    wz({ id: 'a', number: 'WZ/1/11/26', release_date: '2026-11-01' }),
    wz({ id: 'b', number: 'WZ/9/10/26', release_date: '2026-10-31', buyer_name: 'vatan  sp. z o.o.' }),
    wz({ id: 'c', number: 'WM/3/11/26', doc_series: 'WM', release_date: '2026-11-14' }),
    wz({ id: 'd', number: 'WZ/7/11/26', release_date: '', issued_date: '', status: 'anulowany' }),
    wz({ id: 'e', number: 'WZ/8/11/26', release_date: '2026-11-08', buyer_name: 'BEYOGLU', order_no: 'BEY/Z/2/11/26' }),
  ]
  const ids = (d: Dok[]) => d.map(x => x.id)
  it('okresy: ten miesiąc, poprzedni, 7 dni, dziś; bez daty tylko przy „wszystko”', () => {
    expect(ids(filtruj(lista, F({ okres: 'miesiac', stan: 'wszystkie' }), DZIS))).toEqual(['a', 'c', 'e'])
    expect(ids(filtruj(lista, F({ okres: 'poprzedni', stan: 'wszystkie' }), DZIS))).toEqual(['b'])
    expect(ids(filtruj(lista, F({ okres: '7dni', stan: 'wszystkie' }), DZIS))).toEqual(['c', 'e'])
    expect(ids(filtruj(lista, F({ okres: 'dzis', stan: 'wszystkie' }), DZIS))).toEqual(['c'])
    expect(ids(filtruj(lista, F({ okres: 'zakres', od: '2026-10-31', do: '2026-11-01', stan: 'wszystkie' }), DZIS))).toEqual(['a', 'b'])
    expect(ids(filtruj(lista, F({ stan: 'wszystkie' }), DZIS))).toContain('d')
  })
  it('stan, seria, klient (wielkość liter i spacje), szukaj po numerze/zamówieniu', () => {
    expect(ids(filtruj(lista, F(), DZIS))).not.toContain('d')
    expect(ids(filtruj(lista, F({ stan: 'anulowane' }), DZIS))).toEqual(['d'])
    expect(ids(filtruj(lista, F({ seria: 'WM' }), DZIS))).toEqual(['c'])
    expect(ids(filtruj(lista, F({ klient: 'VATAN SP. Z O.O.' }), DZIS))).toEqual(['a', 'b', 'c'])
    expect(ids(filtruj(lista, F({ szukaj: 'bey/z' }), DZIS))).toEqual(['e'])
    expect(ids(filtruj(lista, F({ szukaj: 'wm/3' }), DZIS))).toEqual(['c'])
  })
})

describe('Dokumenty — sort', () => {
  it('numer naturalnie (rok, miesiąc, kolejny), puste daty na końcu', () => {
    const l = [wz({ id: '1', number: 'WZ/10/11/26' }), wz({ id: '2', number: 'WZ/2/11/26' }), wz({ id: '3', number: 'WZ/30/10/26' })]
    expect(sortuj(l, 'numer', 'asc').map(d => d.id)).toEqual(['3', '2', '1'])
    expect(sortuj(l, 'numer', 'desc').map(d => d.id)).toEqual(['1', '2', '3'])
    const d = [wz({ id: 'x', release_date: '', issued_date: '' }), wz({ id: 'y', release_date: '2026-11-02' }), wz({ id: 'z', release_date: '2026-11-05' })]
    expect(sortuj(d, 'data', 'desc').map(x => x.id)).toEqual(['z', 'y', 'x'])
    expect(sortuj(d, 'data', 'asc').map(x => x.id)).toEqual(['y', 'z', 'x'])
  })
})

describe('Dokumenty — działania', () => {
  it('WZ ręczna: wszystko dostępne; anulowana: tylko druk (anuluj/ceny/dopisz wyłączone z powodem)', () => {
    expect(dzialania(wz()).anuluj.ok).toBe(true)
    const a = dzialania(wz({ status: 'anulowany' }))
    expect([a.anuluj.ok, a.ceny.ok, a.dopisz.ok]).toEqual([false, false, false])
    expect(a.anuluj.powod).toMatch(/anulowany/)
  })
  it('WM/WZ podziału i załadowana WZ z zamówienia: anulowanie wyłączone z podpowiedzią', () => {
    expect(dzialania(wz({ source_type: 'order', split_scope: 'calosc', doc_series: 'WM' })).anuluj).toEqual({ ok: false, powod: expect.stringMatching(/komplet/) })
    expect(dzialania(wz({ source_type: 'order', loaded_at: 'x' })).anuluj).toEqual({ ok: false, powod: expect.stringMatching(/załadun/) })
  })
  it('raport rozjazdu tylko przy rozjeździe; CMR edycja; HDI anulowanie', () => {
    expect(dzialania(wz()).rozjazd.ok).toBe(false)
    expect(dzialania(wz({ loading_status: 'rozjazd', source_type: 'order', source_id: 'o1' })).rozjazd.ok).toBe(true)
    expect(dzialania(zCmr({ id: 'c', number: '1', status: 'wystawiony' })).edytujCmr.ok).toBe(true)
    expect(dzialania(zHdi({ id: 'h', number: '1', status: 'anulowany' })).anulujHdi.ok).toBe(false)
  })
})
