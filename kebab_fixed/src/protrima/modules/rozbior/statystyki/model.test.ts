import { describe, it, expect } from 'vitest'
import { okres, przesun, delta, tekstZWagi, pasekBilansu, ubytkiNadwyzki } from './model'
import type { DeboningStats } from '@/lib/api'

const DZIS = new Date(2026, 10, 28, 10, 0)
const fr = (a: number, m: number, u = 0) => ({ auto: { n: a ? 1 : 0, kg: a }, manual: { n: m ? 4 : 0, kg: m }, unknown: { n: 0, kg: u }, office: { kg: 0 } })

describe('okres', () => {
  it('dziś — na żywo', () => {
    expect(okres('dzis', DZIS)).toMatchObject({ od: '2026-11-28', do: '2026-11-28', naZywo: true })
  })
  it('wczoraj', () => expect(okres('wczoraj', DZIS)).toMatchObject({ od: '2026-11-27', do: '2026-11-27', naZywo: false }))
  it('7 dni = dziś−6..dziś', () => expect(okres('7dni', DZIS)).toMatchObject({ od: '2026-11-22', do: '2026-11-28', naZywo: true }))
  it('miesiąc = od 1. dnia', () => expect(okres('miesiac', DZIS)).toMatchObject({ od: '2026-11-01', do: '2026-11-28' }))
  it('zakres', () => expect(okres('zakres', DZIS, { od: '2026-10-01', do: '2026-10-31' })).toMatchObject({ od: '2026-10-01', do: '2026-10-31', naZywo: false }))
})

describe('przesun', () => {
  it('wstecz o długość okresu', () => expect(przesun({ od: '2026-11-22', do: '2026-11-28' }, -1, DZIS)).toEqual({ od: '2026-11-15', do: '2026-11-21' }))
  it('naprzód nie wychodzi poza dziś', () => expect(przesun({ od: '2026-11-22', do: '2026-11-28' }, 1, DZIS)).toEqual({ od: '2026-11-22', do: '2026-11-28' }))
  it('naprzód o dzień', () => expect(przesun({ od: '2026-11-26', do: '2026-11-26' }, 1, DZIS)).toEqual({ od: '2026-11-27', do: '2026-11-27' }))
})

describe('delta', () => {
  it('p.p. w górę = dobrze', () => expect(delta(64.1, 62.9, 'wiecej', 'pp')).toEqual({ tekst: '+1,2 p.p.', poziom: 'dobrze' }))
  it('więcej ubytku = źle', () => expect(delta(5, 3, 'mniej', 'pp')?.poziom).toBe('zle'))
  it('kg z separatorem', () => {
    const d = delta(10500, 9300, 'brak', 'kg')!
    expect(d.tekst.replace(/\s/g, ' ')).toBe('+1 200 kg')
    expect(d.poziom).toBe('neutral')
  })
  it('procent względny', () => expect(delta(110, 100, 'wiecej', '%')).toEqual({ tekst: '+10%', poziom: 'dobrze' }))
  it('bez zmiany = neutral', () => expect(delta(64, 64, 'wiecej', 'pp')).toEqual({ tekst: '±0 p.p.', poziom: 'neutral' }))
  it('brak poprzedniego → null', () => expect(delta(64, null, 'wiecej', 'pp')).toBeNull())
})

describe('tekstZWagi', () => {
  it('procent i ręczne', () => {
    const w = { meat: fr(150, 4), backs: fr(0, 0), bones: fr(0, 0), autoPct: 97.4, manualCount: 4 }
    expect(tekstZWagi(w)).toBe('97,4% z wagi · 4 ręcznie')
  })
  it('wszystko z wagi', () => expect(tekstZWagi({ meat: fr(10, 0), backs: fr(0, 0), bones: fr(0, 0), autoPct: 100, manualCount: 0 })).toBe('100% z wagi'))
  it('brak trybu', () => expect(tekstZWagi({ meat: fr(0, 0, 10), backs: fr(0, 0), bones: fr(0, 0), autoPct: null, manualCount: 0 })).toBe('tryb nieznany'))
})

describe('pasekBilansu', () => {
  const s = { summary: { kgQuarter: 1000, kgMeat: 640, kgBacks: 150, kgBones: 170, missingKg: 40,
    meatByType: { zs: { kgQuarter: 900, kgMeat: 590, yieldPct: 65.6 }, bs: { kgQuarter: 100, kgMeat: 50, yieldPct: 50 } } } } as unknown as DeboningStats
  it('segmenty sumują się do 100%', () => {
    const p = pasekBilansu(s)
    expect(p.map(x => x.klucz)).toEqual(['zs', 'bs', 'grzbiety', 'kosci', 'ubytek'])
    expect(Math.abs(p.reduce((a, x) => a + x.pct, 0) - 100)).toBeLessThan(0.1)
  })
  it('nadwyżka: ubytek kg < 0 i pct 0', () => {
    const n = { summary: { ...s.summary, kgMeat: 700, missingKg: -20, meatByType: { zs: { kgQuarter: 900, kgMeat: 650, yieldPct: 72 }, bs: { kgQuarter: 100, kgMeat: 50, yieldPct: 50 } } } } as unknown as DeboningStats
    const u = pasekBilansu(n).find(x => x.klucz === 'ubytek')!
    expect(u.kg).toBe(-20)
    expect(u.pct).toBe(0)
  })
})

describe('ubytkiNadwyzki', () => {
  const b = (no: string, q: number, m: number | null) => ({ batchNo: no, kgQuarter: q, missingKg: m })
  it('ubytki i nadwyżki sumowane osobno po partiach, % od całej ćwiartki', () => {
    const s = { summary: { kgQuarter: 4000 }, byBatch: [b('1', 1000, 40), b('2', 1000, -15), b('3', 1000, 20), b('4', 1000, null)] } as unknown as DeboningStats
    expect(ubytkiNadwyzki(s)).toEqual({ ubytek: { kg: 60, pct: 1.5, partie: 2 }, nadwyzka: { kg: 15, pct: 0.375, partie: 1 } })
  })
  it('bez partii: zera', () => {
    const s = { summary: { kgQuarter: 0 }, byBatch: [] } as unknown as DeboningStats
    expect(ubytkiNadwyzki(s)).toEqual({ ubytek: { kg: 0, pct: 0, partie: 0 }, nadwyzka: { kg: 0, pct: 0, partie: 0 } })
  })
})
