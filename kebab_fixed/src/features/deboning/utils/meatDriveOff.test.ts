import { describe, it, expect } from 'vitest'
import { buildMeatSnapshot, meatPromptVariant, type MeatSnapshotInput } from './meatDriveOff'

const base: MeatSnapshotInput = {
  autoMode: true,
  connected: true,
  ready: true,
  blocked: false,
  netKg: 100.0,
  gross: 125.5,
  cartTareKg: 5.5,
  e2Count: 10,
  worker: { id: 'w1', name: 'Anatoli' },
  batch: { id: 'b1', internalBatchNo: '412' },
  takenKg: 300.0,
  weighedSoFarKg: 0,
  resumeId: null,
}

describe('buildMeatSnapshot', () => {
  it('komplet danych → snapshot z ZAMROŻONYM netto i kontekstem', () => {
    expect(buildMeatSnapshot(base)).toEqual({
      netKg: 100.0, gross: 125.5, cartTareKg: 5.5, e2Count: 10,
      workerId: 'w1', workerName: 'Anatoli',
      batchId: 'b1', batchNo: '412',
      takenKg: 300.0, weighedSoFarKg: 0, resumeId: null,
    })
  })

  it('tryb ręczny (awaria wagi) → null, nie ma zjazdu do wykrycia', () => {
    expect(buildMeatSnapshot({ ...base, autoMode: false })).toBeNull()
  })

  it('waga rozłączona → null', () => {
    expect(buildMeatSnapshot({ ...base, connected: false })).toBeNull()
  })

  it('brak tary wózka lub pojemników (ready=false) → null', () => {
    expect(buildMeatSnapshot({ ...base, ready: false })).toBeNull()
  })

  it('otwarty kreator ubocznych → null (to paleta na wadze, nie mięso)', () => {
    expect(buildMeatSnapshot({ ...base, blocked: true })).toBeNull()
  })

  it('brak pracownika → null (decyzja: okno tylko przy komplecie danych)', () => {
    expect(buildMeatSnapshot({ ...base, worker: null })).toBeNull()
  })

  it('brak partii → null', () => {
    expect(buildMeatSnapshot({ ...base, batch: null })).toBeNull()
  })

  it('brak pobranej ćwiartki → null', () => {
    expect(buildMeatSnapshot({ ...base, takenKg: 0 })).toBeNull()
  })

  it('netto 0 (pusta waga / sam wózek) → null', () => {
    expect(buildMeatSnapshot({ ...base, netKg: 0 })).toBeNull()
  })

  it('mięso większe niż pobranie → null (błędna tara albo nie ta partia)', () => {
    expect(buildMeatSnapshot({ ...base, netKg: 210, weighedSoFarKg: 100 })).toBeNull()
  })

  it('domykanie pobrania: dolicza wcześniejsze porcje', () => {
    const s = buildMeatSnapshot({ ...base, resumeId: 'e9', weighedSoFarKg: 120 })
    expect(s?.resumeId).toBe('e9')
    expect(s?.weighedSoFarKg).toBe(120)
  })
})

describe('meatPromptVariant', () => {
  const snap = buildMeatSnapshot(base)!

  it('domykanie, 100 z 300 kg = 33% → podpowiada PORCJĘ', () => {
    const v = meatPromptVariant({ ...snap, resumeId: 'e9' })
    expect(v.primary).toBe('part')
    expect(v.secondary).toBe('complete')
    expect(v.totalWeighedKg).toBe(100.0)
    expect(Math.round(v.pct)).toBe(33)
  })

  it('domykanie, 200 z 300 kg = 67% (≥63) → podpowiada CAŁOŚĆ', () => {
    const v = meatPromptVariant({ ...snap, resumeId: 'e9', netKg: 200 })
    expect(v.primary).toBe('complete')
    expect(v.secondary).toBe('part')
    expect(Math.round(v.pct)).toBe(67)
  })

  it('domykanie z wcześniejszymi porcjami: 80 + 120 z 300 = 67% → CAŁOŚĆ', () => {
    const v = meatPromptVariant({ ...snap, resumeId: 'e9', netKg: 120, weighedSoFarKg: 80 })
    expect(v.primary).toBe('complete')
    expect(v.totalWeighedKg).toBe(200.0)
  })

  it('zwykły wpis, 33% → podpowiada „to dopiero część", wpis w rezerwie', () => {
    const v = meatPromptVariant(snap)
    expect(v.primary).toBe('entry-part')
    expect(v.secondary).toBe('entry')
  })

  it('zwykły wpis, 67% → zwykły wpis, bez wariantu części', () => {
    const v = meatPromptVariant({ ...snap, netKg: 200 })
    expect(v.primary).toBe('entry')
    expect(v.secondary).toBeNull()
  })

  it('zaokrągla sumę do 0,1 kg (bez artefaktów float)', () => {
    const v = meatPromptVariant({ ...snap, netKg: 100.15, weighedSoFarKg: 0.1 })
    expect(v.totalWeighedKg).toBe(100.3)
  })
})
