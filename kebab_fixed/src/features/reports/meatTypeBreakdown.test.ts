import { describe, expect, it } from 'vitest'
import { meatByType, type MeatEntry } from './meatTypeBreakdown'

// Dzień 4.08.2026 z produkcji: 5 956,50 kg mięsa, w tym 33,0 kg b/s
// (partia 458 — dwa pobrania na mięso bez skóry).
const DZIEN_4_08: MeatEntry[] = [
  { meatType: 'zs', kgMeat: 1881.5 },
  { meatType: 'zs', kgMeat: 1503.0 },
  { meatType: 'zs', kgMeat: 2539.0 },
  { meatType: 'bs', kgMeat: 16.5 },
  { meatType: 'bs', kgMeat: 16.5 },
]

describe('meatByType — sekcja „Mięsa" karty 2.1.1', () => {
  it('jeden rodzaj daje jedną pozycję z pełną masą', () => {
    expect(meatByType([{ meatType: 'zs', kgMeat: 3203 }])).toEqual([
      { type: 'zs', label: 'Mięso Z/S', kg: 3203 },
    ])
  })

  it('rozbija dzień na rodzaje i nie gubi ani kilograma', () => {
    const rows = meatByType(DZIEN_4_08)
    expect(rows.map(r => r.label)).toEqual(['Mięso Z/S', 'Mięso B/S'])
    expect(rows.map(r => r.kg)).toEqual([5923.5, 33])
    expect(rows.reduce((s, r) => s + r.kg, 0)).toBeCloseTo(5956.5, 6)
  })

  // Backend zwraca meatType z domyślną wartością 'zs', ale wpisy sprzed
  // wprowadzenia kolumny mogą przyjść bez niej.
  it('wpis bez rodzaju liczy się jako Z/S', () => {
    expect(meatByType([{ kgMeat: 100 }, { meatType: 'zs', kgMeat: 50 }])).toEqual([
      { type: 'zs', label: 'Mięso Z/S', kg: 150 },
    ])
  })

  it('rodzaj bez masy nie pojawia się na karcie', () => {
    const rows = meatByType([{ meatType: 'zs', kgMeat: 900 }, { meatType: 'bs', kgMeat: 0 }])
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('zs')
  })

  it('pusty dzień daje pustą sekcję', () => {
    expect(meatByType([])).toEqual([])
  })

  // Karta drukuje mięso rozliczone (zaokrąglone do 2 miejsc). Gdyby suma
  // rodzajów rozjechała się z tą liczbą choćby o grosz, wiersz „Suma"
  // przestałby zgadzać się z masą surowców.
  it('uzgadnia sumę rodzajów z masą mięsa na karcie', () => {
    const rows = meatByType(DZIEN_4_08, 5956.49)
    expect(rows.reduce((s, r) => s + r.kg, 0)).toBeCloseTo(5956.49, 6)
    // Korekta idzie na pozycję największą — 33 kg b/s zostaje nietknięte.
    expect(rows.find(r => r.type === 'bs')!.kg).toBe(33)
  })

  it('nieznany rodzaj nie znika z karty', () => {
    const rows = meatByType([{ meatType: 'filet', kgMeat: 120 }])
    expect(rows).toHaveLength(1)
    expect(rows[0].kg).toBe(120)
    expect(rows[0].label).toContain('Mięso')
  })
})
