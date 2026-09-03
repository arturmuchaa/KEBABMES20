import { describe, expect, it } from 'vitest'
import {
  dataFefo, ograniczIlosc, podzialStanu, podsumowanieZaznaczenia, przydzialNaMape,
  rozpiszNaPartie, sumaPrzydzialu,
} from './finishedGoodsSelection'

const partia = (over: Partial<any> = {}): any => ({
  batchNo: '010926 518', qtyAvailable: 90, kgPerUnit: 30,
  clientOrderNo: null, ...over,
})

const g = (over: Partial<any> = {}): any => ({
  key: 'k1', productTypeName: 'KEBAB UDO', recipeName: 'KIRMIZI',
  packagingName: 'METAL 65CM', clientName: 'YALCIN', kgPerUnit: 30,
  qty: 142, totalKg: 4260, batches: [partia()], ...over,
})

describe('podzialStanu — wolne kontra pod zamówienia', () => {
  it('sztuki BEZ numeru zamówienia są wolne', () => {
    const s = podzialStanu(g({ batches: [partia({ qtyAvailable: 52 })] }))
    expect(s).toEqual({ wolne: 52, podZamowienia: 0, razem: 52 })
  })

  it('sztuki ostemplowane zamówieniem są zajęte', () => {
    const s = podzialStanu(g({
      batches: [partia({ qtyAvailable: 90, clientOrderNo: 'YALCIN/Z/1/09/26' })],
    }))
    expect(s).toEqual({ wolne: 0, podZamowienia: 90, razem: 90 })
  })

  it('sumuje partie mieszane', () => {
    const s = podzialStanu(g({
      batches: [
        partia({ qtyAvailable: 52 }),
        partia({ batchNo: '310826 512', qtyAvailable: 90, clientOrderNo: 'Z/1' }),
      ],
    }))
    expect(s).toEqual({ wolne: 52, podZamowienia: 90, razem: 142 })
  })

  it('pusty numer zamówienia to NIE rezerwacja', () => {
    const s = podzialStanu(g({ batches: [partia({ qtyAvailable: 10, clientOrderNo: '' })] }))
    expect(s.wolne).toBe(10)
  })

  it('towar bez partii nie wywraca podziału', () => {
    expect(podzialStanu(g({ batches: [] }))).toEqual({ wolne: 0, podZamowienia: 0, razem: 0 })
  })
})

describe('ograniczIlosc — nie da się wydać więcej, niż leży', () => {
  it('przycina do wolnego stanu', () => {
    expect(ograniczIlosc(999, 52)).toBe(52)
  })
  it('przepuszcza ilość mieszczącą się w stanie', () => {
    expect(ograniczIlosc(30, 52)).toBe(30)
  })
  it('liczba ujemna schodzi do zera', () => {
    expect(ograniczIlosc(-5, 52)).toBe(0)
  })
  it('ułamek zaokrągla w dół — wydajemy całe sztuki', () => {
    expect(ograniczIlosc(12.7, 52)).toBe(12)
  })
  it('śmieć w polu daje zero, nie NaN', () => {
    expect(ograniczIlosc(Number('abc'), 52)).toBe(0)
  })
})

describe('podsumowanieZaznaczenia', () => {
  it('liczy pozycje, sztuki i kilogramy', () => {
    const p = podsumowanieZaznaczenia([
      { towar: g({ kgPerUnit: 30 }), ilosc: 90 },
      { towar: g({ key: 'k2', kgPerUnit: 70 }), ilosc: 3 },
    ])
    expect(p).toEqual({ pozycji: 2, sztuk: 93, kg: 2910 })
  })

  it('pomija pozycje z ilością zero — zaznaczone, ale puste', () => {
    const p = podsumowanieZaznaczenia([
      { towar: g(), ilosc: 0 },
      { towar: g({ key: 'k2' }), ilosc: 10 },
    ])
    expect(p).toEqual({ pozycji: 1, sztuk: 10, kg: 300 })
  })

  it('puste zaznaczenie daje zera', () => {
    expect(podsumowanieZaznaczenia([])).toEqual({ pozycji: 0, sztuk: 0, kg: 0 })
  })

  it('kilogramy zaokrągla do trzech miejsc', () => {
    const p = podsumowanieZaznaczenia([{ towar: g({ kgPerUnit: 2.333 }), ilosc: 3 }])
    expect(p.kg).toBe(6.999)
  })
})

describe('rozpiszNaPartie — FEFO', () => {
  const p2 = (id: string, szt: number, termin: string, order: string | null = null): any =>
    ({ id, qtyAvailable: szt, expiryDate: termin, clientOrderNo: order })

  it('bierze najpierw partię z NAJKRÓTSZYM terminem', () => {
    const out = rozpiszNaPartie(
      g({ batches: [p2('B', 50, '2027-09-02'), p2('A', 50, '2027-08-31')] }), 30)
    expect(out).toEqual([{ id: 'A', qty: 30 }])
  })

  it('schodzi na kolejną partię, gdy pierwsza nie wystarcza', () => {
    const out = rozpiszNaPartie(
      g({ batches: [p2('A', 20, '2027-08-31'), p2('B', 50, '2027-09-02')] }), 30)
    expect(out).toEqual([{ id: 'A', qty: 20 }, { id: 'B', qty: 10 }])
  })

  it('pomija partie ZAJĘTE pod zamówienia', () => {
    const out = rozpiszNaPartie(
      g({ batches: [p2('A', 90, '2027-08-31', 'Z/1'), p2('B', 50, '2027-09-02')] }), 30)
    expect(out).toEqual([{ id: 'B', qty: 30 }])
  })

  it('nie rozpisze więcej, niż jest wolne', () => {
    const out = rozpiszNaPartie(g({ batches: [p2('A', 10, '2027-08-31')] }), 999)
    expect(out).toEqual([{ id: 'A', qty: 10 }])
  })

  it('zero sztuk daje pustą listę', () => {
    expect(rozpiszNaPartie(g({ batches: [p2('A', 10, '2027-08-31')] }), 0)).toEqual([])
  })

  it('partia bez terminu ląduje na końcu, nie na początku', () => {
    // Brak terminu nie może udawać „najpilniejszej" — inaczej FEFO wywraca się
    // na jednym niekompletnym wierszu.
    const out = rozpiszNaPartie(
      g({ batches: [p2('BEZ', 50, ''), p2('A', 20, '2027-08-31')] }), 30)
    expect(out).toEqual([{ id: 'A', qty: 20 }, { id: 'BEZ', qty: 10 }])
  })

  it("tryb 'wszystkie' bierze też partie ostemplowane zamówieniem", () => {
    const out = rozpiszNaPartie(
      g({ batches: [p2('A', 90, '2027-08-31', 'Z/1'), p2('B', 50, '2027-09-02')] }),
      100, 'wszystkie')
    expect(out).toEqual([{ id: 'A', qty: 90 }, { id: 'B', qty: 10 }])
  })

  it("domyślny tryb nadal pomija partie pod zamówieniami", () => {
    const out = rozpiszNaPartie(
      g({ batches: [p2('A', 90, '2027-08-31', 'Z/1')] }), 50)
    expect(out).toEqual([])
  })
})

describe('przydzialNaMape / sumaPrzydzialu — ręczna korekta partii', () => {
  it('zamienia propozycję FEFO na mapę partia→sztuki', () => {
    expect(przydzialNaMape([{ id: 'A', qty: 20 }, { id: 'B', qty: 10 }]))
      .toEqual({ A: 20, B: 10 })
  })

  it('sumuje ręcznie poprawiony przydział', () => {
    expect(sumaPrzydzialu({ A: 5, B: 25 })).toBe(30)
  })

  it('pomija partie wyzerowane ręcznie', () => {
    expect(sumaPrzydzialu({ A: 0, B: 30 })).toBe(30)
  })

  it('pusty przydział daje zero', () => {
    expect(sumaPrzydzialu({})).toBe(0)
  })

  it('ignoruje śmieci zamiast dawać NaN', () => {
    expect(sumaPrzydzialu({ A: NaN as any, B: 10 })).toBe(10)
  })
})

describe('dataFefo — magazyn wyrobu niesie datę produkcji, nie termin', () => {
  it('woli termin ważności, gdy jest', () => {
    expect(dataFefo({ expiryDate: '2027-08-31', producedDate: '2026-09-01' }))
      .toBe('2027-08-31')
  })

  it('spada na datę produkcji, gdy terminu brak', () => {
    // Bez tego zapasu WSZYSTKIE partie wyrobu wpadały do worka „bez terminu"
    // i FEFO ustawiało je przypadkowo.
    expect(dataFefo({ producedDate: '2026-09-01' })).toBe('2026-09-01')
  })

  it('FEFO po dacie produkcji bierze najstarszą partię', () => {
    const out = rozpiszNaPartie({ batches: [
      { id: 'NOWA', qtyAvailable: 50, producedDate: '2026-09-01' } as any,
      { id: 'STARA', qtyAvailable: 50, producedDate: '2026-08-19' } as any,
    ] }, 30)
    expect(out).toEqual([{ id: 'STARA', qty: 30 }])
  })
})
