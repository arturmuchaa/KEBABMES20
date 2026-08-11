import { describe, it, expect } from 'vitest'
import {
  canSubmitReception, checkAgainstHdi, groupLines, nextSupplierBatchNo, parseKg,
  receptionIssues, receptionTotalKg, renumberAfterRemove, withContainers,
  type HdiLine,
} from './receptionSplit'

const line = (no: string, kg: number, group = 0, extra: Partial<HdiLine> = {}): HdiLine => ({
  supplierBatchNo: no, kgReceived: kg, group,
  slaughterDate: '2026-08-10', expiryDate: '2026-08-17', ...extra,
})

/** Dostawa z przykładu: 10 t rozbite na 6000 + 4000 kg. */
const dostawa = (): HdiLine[] => [
  line('A001', 600), line('A002', 1200), line('A003', 2400),
  line('A004', 800), line('A005', 1000),
  line('A006', 1500, 1), line('A007', 1500, 1), line('A008', 1000, 1),
]

describe('groupLines', () => {
  it('sumuje kilogramy w obrębie numeru porządkowego', () => {
    const [g1, g2] = groupLines(dostawa(), 2)
    expect(g1.kg).toBe(6000)
    expect(g2.kg).toBe(4000)
  })

  it('zbiera numery partii dostawcy przypisane do grupy', () => {
    const [g1, g2] = groupLines(dostawa(), 2)
    expect(g1.supplierNos).toEqual(['A001', 'A002', 'A003', 'A004', 'A005'])
    expect(g2.supplierNos).toEqual(['A006', 'A007', 'A008'])
  })

  it('bierze NAJWCZEŚNIEJSZĄ datę w grupie — FEFO liczy od najkrótszej', () => {
    const lines = [
      line('A001', 600, 0, { slaughterDate: '2026-08-10', expiryDate: '2026-08-17' }),
      line('A003', 2400, 0, { slaughterDate: '2026-08-09', expiryDate: '2026-08-16' }),
    ]
    const [g1] = groupLines(lines, 1)
    expect(g1.slaughterDate).toBe('2026-08-09')
    expect(g1.expiryDate).toBe('2026-08-16')
  })

  it('zwraca też puste grupy — operator ma zobaczyć pusty numer, nie jego brak', () => {
    const groups = groupLines([line('A001', 600)], 3)
    expect(groups).toHaveLength(3)
    expect(groups[2].kg).toBe(0)
  })
})

describe('receptionTotalKg', () => {
  it('liczy całą dostawę niezależnie od podziału', () => {
    expect(receptionTotalKg(dostawa())).toBe(10000)
  })
})

describe('receptionIssues', () => {
  it('poprawna dostawa nie ma żadnych zastrzeżeń', () => {
    expect(receptionIssues(dostawa(), 2)).toEqual({ errors: [], warnings: [] })
  })

  it('numer porządkowy bez kilogramów blokuje zapis', () => {
    const { errors } = receptionIssues(dostawa(), 3)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('#3')
    expect(canSubmitReception(dostawa(), 3)).toBe(false)
  })

  it('pozycja bez wagi blokuje zapis', () => {
    const { errors } = receptionIssues([...dostawa(), line('A009', 0)], 2)
    expect(errors.some(e => e.includes('A009'))).toBe(true)
  })

  it('partia dostawcy w dwóch grupach OSTRZEGA, ale nie blokuje', () => {
    const lines = [...dostawa(), line('A003', 500, 1)]
    const { errors, warnings } = receptionIssues(lines, 2)
    expect(errors).toEqual([])
    expect(warnings.some(w => w.includes('A003'))).toBe(true)
    expect(canSubmitReception(lines, 2)).toBe(true)
  })

  it('ta sama partia dwa razy w TEJ SAMEJ grupie to nie podział', () => {
    const lines = [...dostawa(), line('A003', 500)]
    expect(receptionIssues(lines, 2).warnings).toEqual([])
  })

  it('waga bez numeru partii dostawcy ostrzega o braku identyfikowalności', () => {
    const { errors, warnings } = receptionIssues([line('', 2400)], 1)
    expect(errors).toEqual([])
    expect(warnings).toHaveLength(1)
  })
})

describe('parseKg — waga przepisana z HDI', () => {
  it('czyta format z dokumentu dostawcy: „1 800,00"', () => {
    expect(parseKg('1 800,00')).toBe(1800)
    expect(parseKg('2 160,00')).toBe(2160)
    expect(parseKg('600,00')).toBe(600)
  })

  it('twarda spacja tysięcy też przechodzi — tak wkleja się z PDF', () => {
    expect(parseKg('9 000,00')).toBe(9000)
  })

  it('kropka z klawiatury numerycznej działa tak samo', () => {
    expect(parseKg('1800.5')).toBe(1800.5)
  })

  it('śmieci i wartości niedodatnie dają 0, nie NaN', () => {
    expect(parseKg('')).toBe(0)
    expect(parseKg('abc')).toBe(0)
    expect(parseKg('0')).toBe(0)
  })
})

describe('nextSupplierBatchNo', () => {
  it('podpowiada kolejny numer partii dostawcy', () => {
    expect(nextSupplierBatchNo('112819')).toBe('112820')
    expect(nextSupplierBatchNo('112829')).toBe('112830')
  })

  it('zachowuje zera wiodące', () => {
    expect(nextSupplierBatchNo('00042')).toBe('00043')
  })

  it('numer nieliczbowy nie generuje podpowiedzi', () => {
    expect(nextSupplierBatchNo('A001')).toBe('')
    expect(nextSupplierBatchNo('')).toBe('')
  })
})

describe('withContainers', () => {
  it('liczy pojemniki z kalibru — w GÓRĘ, bo niepełny to nadal jeden', () => {
    // Dostawa 9000 kg z HDI 33656: 5235 i 3765 kg przy pojemniku 15 kg.
    const g = withContainers(groupLines([
      line('112819', 5235), line('112824', 3765, 1),
    ], 2), 15)
    expect(g.map(x => x.containersCount)).toEqual([349, 251])
  })

  it('ręczne przeliczenie stosu wygrywa z wyliczeniem', () => {
    const g = withContainers(groupLines(dostawa(), 2), 15, { 1: 206 })
    expect(g[1].containersCount).toBe(206)
  })

  it('bez kalibru nie zmyśla liczby', () => {
    expect(withContainers(groupLines(dostawa(), 2), null)[0].containersCount).toBeNull()
  })
})

describe('checkAgainstHdi', () => {
  const groups = (containers: number[]) =>
    groupLines(dostawa(), 2).map((g, i) => ({ ...g, containersCount: containers[i] ?? null }))

  it('wyliczone pojemniki też się liczą — nie tylko ręcznie wpisane', () => {
    // Regresja: kontrola sumowała wyłącznie nadpisania i przy nietkniętym
    // formularzu raportowała rozjazd o całą dostawę (−600).
    const g = withContainers(groupLines([
      line('112819', 5235), line('112824', 3765, 1),
    ], 2), 15)
    const out = checkAgainstHdi(
      [line('112819', 5235), line('112824', 3765, 1)], g, { kg: 9000, containers: 600 })
    expect(out).toEqual({ kgDiff: 0, containersDiff: 0, ok: true })
  })

  it('zgodna suma i liczba pojemników — brak zastrzeżeń', () => {
    const out = checkAgainstHdi(dostawa(), groups([400, 200]), { kg: 10000, containers: 600 })
    expect(out).toEqual({ kgDiff: 0, containersDiff: 0, ok: true })
  })

  it('pominięta pozycja HDI wychodzi jako brakujące kilogramy', () => {
    const bez = dostawa().slice(0, -1)          // bez A008 (1000 kg)
    const out = checkAgainstHdi(bez, groups([400, 200]), { kg: 10000, containers: 600 })
    expect(out.kgDiff).toBe(-1000)
    expect(out.ok).toBe(false)
  })

  it('rozjazd pojemników łapie przeliczenie stosu', () => {
    const out = checkAgainstHdi(dostawa(), groups([400, 206]), { kg: 10000, containers: 600 })
    expect(out.containersDiff).toBe(6)
  })

  it('nieuzupełniona stopka HDI niczego nie zgłasza', () => {
    const out = checkAgainstHdi(dostawa(), groups([400, 200]), { kg: 0, containers: 0 })
    expect(out.ok).toBe(true)
  })
})

describe('renumberAfterRemove', () => {
  it('zsuwa grupy bez dziur po skasowaniu środkowej', () => {
    const lines = [line('A1', 100, 0), line('A2', 100, 1), line('A3', 100, 2)]
    const out = renumberAfterRemove(lines, 1)
    expect(out.map(l => l.group)).toEqual([0, 0, 1])
  })

  it('pozycje skasowanej grupy wracają do poprzedniej, a nie znikają', () => {
    const lines = [line('A1', 100, 0), line('A2', 100, 1)]
    expect(renumberAfterRemove(lines, 1).map(l => l.group)).toEqual([0, 0])
  })
})
