import { describe, expect, it } from 'vitest'
import type { LabelDesign, LabelField } from '@/lib/api'
import { nowySzablon, PRZYKLAD } from './model'
import { profilRolki, zplSzablonu } from './zpl'
import { bityDoGfa, progujDoBitow } from './raster'

const d = (pola: LabelField[], zm: Partial<LabelDesign> = {}): LabelDesign =>
  ({ ...nowySzablon('zebra'), clientId: 'cy', backgroundZpl: '^GFA,2,2,1,FF00', fields: pola, ...zm })
const pole = (p: Partial<LabelField>): LabelField => ({ id: 'f', kind: 'weight', xMm: 10, yMm: 20, sizePt: 36, font: 'arial', ...p })

describe('ZPL szablonu Zebry', () => {
  it('rozmiar rolki 100 × 150, UTF-8 i tło z importu', () => {
    const z = zplSzablonu(d([]), PRZYKLAD, {})
    expect(z.startsWith('^XA')).toBe(true)
    expect(z).toContain('^CI28')
    expect(z).toContain('^PW799')
    expect(z).toContain('^LL1199')
    expect(z).toContain('^FO0,0^GFA,2,2,1,FF00^FS')
    expect(z.trim().endsWith('^XZ')).toBe(true)
  })
  it('pole wagi: pozycja w punktach, wartość sztuki', () => {
    const z = zplSzablonu(d([pole({})]), { ...PRZYKLAD, weightKg: 40 }, {})
    expect(z).toContain('^FO80,160')
    expect(z).toContain('^FD40 kg^FS')
  })
  it('obrót 90° → ^A0R', () => {
    expect(zplSzablonu(d([pole({ rotation: 90 })]), PRZYKLAD, {})).toMatch(/\^A0R,\d+,\d+/)
  })
  it('QR 30 mm → ^BQN,2,8 z kodem sztuki', () => {
    const z = zplSzablonu(d([pole({ kind: 'qr', qrMm: 30, xMm: 5, yMm: 5 })]), PRZYKLAD, {})
    expect(z).toContain('^BQN,2,8')
    expect(z).toContain('^FDQA,U|przyklad^FS')
  })
  it('znaki ^ i ~ w danych nie rozbijają ZPL', () => {
    const z = zplSzablonu(d([pole({ kind: 'client' })]), { ...PRZYKLAD, clientName: 'A^B~C' }, {})
    expect(z).not.toContain('A^B~C')
    expect(z).toContain('^FDA B C^FS')
  })
  it('pole poza etykietą pominięte — żadnego ^FO poza ^PW', () => {
    const z = zplSzablonu(d([pole({ kind: 'qr', qrMm: 30, xMm: 85, yMm: 5 })]), PRZYKLAD, {})
    expect(z).not.toContain('^BQN')
  })
  it('biała zakrywka → wypełniony biały prostokąt', () => {
    const z = zplSzablonu(d([pole({ kind: 'box', wMm: 20, hMm: 5, fill: 'white', xMm: 10, yMm: 10 })]), PRZYKLAD, {})
    expect(z).toContain('^FO80,80^GB160,40,40,W^FS')
  })
  it('rolka: 100 × 150 → 100x150, nieznany rozmiar → błąd', () => {
    expect(profilRolki(d([]))).toBe('100x150')
    expect(profilRolki(d([], { widthMm: 80, heightMm: 100 }))).toBe('80x100')
    expect(() => profilRolki(d([], { widthMm: 104, heightMm: 192 }))).toThrow(/Brak rolki 104 × 192 mm/)
  })
})

describe('raster PDF → tło Zebry', () => {
  it('bity 16 × 2 → ^GFA z poprawnym hex', () => {
    const bits = new Uint8Array(32)
    for (let x = 0; x < 8; x++) bits[x] = 1
    bits[16 + 15] = 1
    expect(bityDoGfa(bits, 16, 2)).toBe('^GFA,4,4,2,FF000001')
  })
  it('progowanie: ciemne piksele → 1, jasne i przezroczyste → 0', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 250, 250, 250, 255, 0, 0, 0, 0, 120, 120, 120, 255])
    expect(Array.from(progujDoBitow(rgba, 4, 1))).toEqual([1, 0, 0, 1])
  })
})

describe('tło w pamięci drukarki (seria)', () => {
  it('tło wysyłane raz jako ~DG, etykieta przywołuje je ^XG', async () => {
    const { tloDoPamieci } = await import('./zpl')
    const sz = d([])
    const { zpl, nazwa } = tloDoPamieci(sz)
    expect(zpl).toBe(`~DGR:${nazwa}.GRF,2,1,FF00`)
    expect(nazwa).toMatch(/^K[0-9A-Z]{1,7}$/)
    const etykieta = zplSzablonu(sz, PRZYKLAD, { tloZPamieci: nazwa })
    expect(etykieta).toContain(`^FO0,0^XGR:${nazwa}.GRF,1,1^FS`)
    expect(etykieta).not.toContain('^GFA')
  })
  it('różne tła — różne nazwy', async () => {
    const { tloDoPamieci } = await import('./zpl')
    expect(tloDoPamieci(d([])).nazwa).not.toBe(tloDoPamieci(d([], { backgroundZpl: '^GFA,2,2,1,00FF' })).nazwa)
  })
})
