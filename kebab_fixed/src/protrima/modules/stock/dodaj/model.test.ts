import { describe, it, expect } from 'vitest'
import type { Line, Order } from '../../../data/model'
import {
  bledyKoszyka, dodajPartie, drzewoZamowien, payloadKoszyka, pozycjaZLinii, rozpoznajPartie,
  statusPozycji, sumyKoszyka, type PozycjaKoszyka,
} from './model'

const linia = (p: Partial<Line> = {}): Line => ({
  id: 'l1', lp: 1, product: 'KEBAB UDO 100%', recipe: 'KIRMIZI', recipeId: 'r-kir', kgPerUnit: 10,
  packaging: 'METAL 65CM', qty: 80, planned: 0, produced: 0, stock: 0, delivered: 0, unposted: 0,
  mixingMeatKg: null, mixingRemainingKg: null, productTypeId: 't-udo', packagingId: 'pk-65', ...p,
})
const zam = (p: Partial<Order> & { id: string; no: string }, lines: Line[], klient = { id: 'c-yal', name: 'YALCIN' }): Order => ({
  client: { ...klient, country: '', city: '', nip: '', address: '', contact: '', phone: '', terms: '' },
  orderDate: new Date('2026-11-20'), status: 'confirmed', source: '', createdBy: '', lines, pallets: [],
  retiredPalletNos: [], history: [], docs: [], ...p,
})

const ZAMOWIENIA: Order[] = [
  zam({ id: 'o2', no: '44/11', delivery: new Date('2026-11-30') }, [linia({ id: 'l2', qty: 30 })]),
  zam({ id: 'o1', no: '41/11', delivery: new Date('2026-11-27') }, [linia({ id: 'l1' })]),
  zam({ id: 'o3', no: '12/11' }, [linia({ id: 'l3', recipe: 'BEYAZ', recipeId: 'r-bey', qty: 5, kgPerUnit: 20 })], { id: 'c-bul', name: 'BULLI' }),
  zam({ id: 'o4', no: '9/11', status: 'done' }, [linia({ id: 'l4' })], { id: 'c-zam', name: 'ZAMKNIETY' }),
  zam({ id: 'o5', no: '10/11', status: 'draft' }, [linia({ id: 'l5' })], { id: 'c-szk', name: 'SZKIC' }),
  zam({ id: 'o6', no: '11/11' }, [linia({ id: 'l6', usluga: true })], { id: 'c-usl', name: 'USLUGA' }),
]

describe('drzewoZamowien', () => {
  it('dwa otwarte zamówienia YALCIN to dwie gałęzie pod jednym klientem', () => {
    const d = drzewoZamowien(ZAMOWIENIA)
    const yal = d.filter(k => k.clientName === 'YALCIN')
    expect(yal).toHaveLength(1)
    expect(yal[0].zamowienia.map(z => z.orderNo)).toEqual(['41/11', '44/11'])
    expect(yal[0].zamowienia[0].kgLeft).toBe(800)
    expect(yal[0].kgLeft).toBe(1100)
  })
  it('pomija zamknięte, szkice i pozycje usługowe; klienci alfabetycznie', () => {
    expect(drzewoZamowien(ZAMOWIENIA).map(k => k.clientName)).toEqual(['BULLI', 'YALCIN'])
  })
  it('filtr q po recepturze zostawia tylko pasujące zamówienia', () => {
    const d = drzewoZamowien(ZAMOWIENIA, 'beyaz')
    expect(d.map(k => k.clientName)).toEqual(['BULLI'])
    expect(drzewoZamowien(ZAMOWIENIA, '44/')[0].zamowienia.map(z => z.orderNo)).toEqual(['44/11'])
  })
})

const yal41 = () => pozycjaZLinii(ZAMOWIENIA[1], ZAMOWIENIA[1].lines[0])
const zPartiami = (p: PozycjaKoszyka, ...wiersze: Array<[string, string]>): PozycjaKoszyka =>
  ({ ...p, partie: wiersze.map(([nr, qty], i) => ({ key: `k${i}`, nr, qty })) })

describe('partie pozycji', () => {
  it('pozycjaZLinii: jedna partia z brakującą ilością', () => {
    const p = yal41()
    expect(p.partie).toHaveLength(1)
    expect(p.partie[0]).toMatchObject({ nr: '', qty: '80' })
    expect(p).toMatchObject({ cel: 80, orderNo: '41/11', clientName: 'YALCIN', recipeId: 'r-kir', kgPerUnit: 10, productTypeId: 't-udo', packagingId: 'pk-65', zrodlo: 'zamowienie' })
  })
  it('pozycjaZLinii: brak braków → cała ilość pozycji', () => {
    const o = zam({ id: 'x', no: 'X' }, [linia({ stock: 80 })])
    expect(pozycjaZLinii(o, o.lines[0]).partie[0].qty).toBe('80')
  })
  it('dodajPartie: nowy wiersz z resztą sztuk', () => {
    const p = dodajPartie(zPartiami(yal41(), ['111', '30']))
    expect(p.partie).toHaveLength(2)
    expect(p.partie[1]).toMatchObject({ nr: '', qty: '50' })
    expect(new Set(p.partie.map(x => x.key)).size).toBe(2)
    expect(dodajPartie(zPartiami(yal41(), ['111', '80'])).partie[1].qty).toBe('')
  })
  it('statusPozycji', () => {
    expect(statusPozycji(zPartiami(yal41(), ['111', '30'], ['112', '50']))).toBe('ok')
    expect(statusPozycji(zPartiami(yal41(), ['111', '30'], ['112', '40']))).toBe('mniej')
    expect(statusPozycji(zPartiami(yal41(), ['111', '30'], ['112', '60']))).toBe('wiecej')
  })
})

describe('rozpoznajPartie', () => {
  it('wsad masowni', () => {
    expect(rozpoznajPartie('111', '2026-11-23', ['111', '112'])).toEqual({ naWyrobie: '231126 111', masownia: true, nrMasowni: '111' })
  })
  it('numer z datą nie dostaje drugiej daty, nadal rozpoznany jako masownia', () => {
    expect(rozpoznajPartie('231126 111', '2026-11-23', ['111'])).toEqual({ naWyrobie: '231126 111', masownia: true, nrMasowni: '111' })
  })
  it('numer spoza masowni dostaje datę produkcji', () => {
    expect(rozpoznajPartie('PP13', '2026-11-23', [])).toEqual({ naWyrobie: '231126 PP13', masownia: false })
  })
  it('pusty wpis', () => {
    expect(rozpoznajPartie('  ', '2026-11-23', ['111']).naWyrobie).toBe('—')
  })
})

describe('bledyKoszyka', () => {
  it('pusty koszyk', () => {
    expect(bledyKoszyka([], '2026-11-23').koszyk).toBeTruthy()
  })
  it('pusty numer partii i zero sztuk — błąd przy polu', () => {
    const p = zPartiami(yal41(), ['', '30'], ['112', '0'])
    const b = bledyKoszyka([p], '2026-11-23')
    expect(b[`${p.key}:k0:nr`]).toBe('Wpisz numer partii')
    expect(b[`${p.key}:k1:qty`]).toBe('Podaj sztuki')
    expect(b[`${p.key}:k0:qty`]).toBeUndefined()
  })
  it('brak daty', () => {
    expect(bledyKoszyka([zPartiami(yal41(), ['111', '80'])], '').data).toBeTruthy()
  })
  it('poprawny koszyk — brak błędów, także gdy suma ≠ cel', () => {
    expect(bledyKoszyka([zPartiami(yal41(), ['111', '30'], ['112', '40'])], '2026-11-23')).toEqual({})
  })
})

describe('payloadKoszyka', () => {
  it('80 szt rozbite na 111 (30) i 112 (50) — dwa wpisy z masowni', () => {
    const items = payloadKoszyka([zPartiami(yal41(), ['111', '30'], ['112', '50'])], '2026-11-23', ['111', '112'])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      qty: 30, kgPerUnit: 10, producedDate: '2026-11-23', clientOrderNo: '41/11', recipeId: 'r-kir',
      recipeName: 'KIRMIZI', productTypeId: 't-udo', packagingId: 'pk-65', clientName: 'YALCIN',
      batchNo: '', seasonedBatchNos: ['111'], consumeSeasoned: true,
    })
    expect(items[1]).toMatchObject({ qty: 50, seasonedBatchNos: ['112'], consumeSeasoned: true, batchNo: '' })
  })
  it('partia spoza masowni — numer z datą, bez zdejmowania mięsa', () => {
    const [it0] = payloadKoszyka([zPartiami(yal41(), ['PP13', '80'])], '2026-11-23', ['111'])
    expect(it0).toMatchObject({ batchNo: '231126 PP13', seasonedBatchNos: [], consumeSeasoned: false })
  })
  it('liczby z przecinkiem i pozycja ręczna bez numeru zamówienia', () => {
    const reczna: PozycjaKoszyka = { ...zPartiami(yal41(), ['5', '12']), key: 'r-1', zrodlo: 'reczna', orderNo: '', kgPerUnit: 12.5 }
    const [it0] = payloadKoszyka([reczna], '2026-11-23', [])
    expect(it0).toMatchObject({ clientOrderNo: '', qty: 12, kgPerUnit: 12.5 })
  })
})

describe('sumyKoszyka', () => {
  it('partie, sztuki, kg', () => {
    expect(sumyKoszyka([zPartiami(yal41(), ['111', '30'], ['112', '50'])])).toEqual({ partie: 2, sztuki: 80, kg: 800 })
  })
})

describe('dataLokalna', () => {
  it('bierze dzień z czasu lokalnego, nie z UTC', async () => {
    const { dataLokalna } = await import('./model')
    expect(dataLokalna(new Date(2026, 10, 27, 0, 30))).toBe('2026-11-27')
    expect(dataLokalna(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})
