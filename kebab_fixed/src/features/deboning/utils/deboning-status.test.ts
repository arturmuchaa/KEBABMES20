import { describe, it, expect } from 'vitest'
import { splitEntriesByStatus, calcSessionSummary, sortEntriesByCreatedAt, takenOnProductionDay } from './index'

const base = {
  kgBones: 0, kgBacks: 0, workerId: 'w1', rawBatchId: 'b1', yieldPct: 70,
}

describe('splitEntriesByStatus', () => {
  it('rozdziela pending i complete', () => {
    const { pending, complete } = splitEntriesByStatus([
      { ...base, status: 'pending', kgTaken: 60, kgMeat: 0 },
      { ...base, status: 'complete', kgTaken: 100, kgMeat: 70 },
    ] as any)
    expect(pending).toHaveLength(1)
    expect(complete).toHaveLength(1)
    expect((pending[0] as any).kgTaken).toBe(60)
  })

  it('brak status traktuje jak complete', () => {
    const { complete } = splitEntriesByStatus([{ ...base, kgTaken: 100, kgMeat: 70 }] as any)
    expect(complete).toHaveLength(1)
  })
})

describe('sortEntriesByCreatedAt', () => {
  it('normalizuje kolejność rosnąco (backend zwraca DESC, HMI zakłada ASC)', () => {
    // Bug prod 2026-07-08: „Ostatnie wpisy" pokazywały 8 NAJSTARSZYCH wpisów
    // (partia 404), bo slice(-8) na liście DESC z backendu bierze koniec listy.
    const sorted = sortEntriesByCreatedAt([
      { id: 'c', createdAt: '2026-07-08T12:29:35' },
      { id: 'b', createdAt: '2026-07-08T07:07:44' },
      { id: 'a', createdAt: '2026-07-08T05:54:32' },
    ] as any)
    expect(sorted.map((e: any) => e.id)).toEqual(['a', 'b', 'c'])
    // slice(-1) po normalizacji = najnowszy wpis
    expect((sorted.slice(-1)[0] as any).id).toBe('c')
  })

  it('dwufazowy wpis żyje po czasie ZWAŻENIA (completedAt), nie pobrania', () => {
    // Bug prod 2026-07-09: Adrian pobrał później (createdAt najnowszy), ale
    // zważył pierwszy — po każdym cudzym zważeniu wskakiwał na górę feedu.
    const sorted = sortEntriesByCreatedAt([
      { id: 'adrian', createdAt: '2026-07-09T08:00:00', completedAt: '2026-07-09T08:05:00' },
      { id: 'inny',   createdAt: '2026-07-09T07:50:00', completedAt: '2026-07-09T08:15:00' },
    ] as any)
    // „inny" zważył później → jest ostatni (czyli na górze po reverse())
    expect(sorted.map((e: any) => e.id)).toEqual(['adrian', 'inny'])
  })

  it('nie mutuje wejścia i toleruje brak createdAt', () => {
    const input = [{ id: 'x' }, { id: 'y', createdAt: '2026-07-08T10:00:00' }] as any
    const sorted = sortEntriesByCreatedAt(input)
    expect(input[0].id).toBe('x')
    expect(sorted).toHaveLength(2)
  })
})

describe('calcSessionSummary pomija pending', () => {
  it('pending nie zanizaja wydajnosci ani liczby wpisow', () => {
    const s = calcSessionSummary([
      { ...base, status: 'complete', kgTaken: 100, kgMeat: 70 },
      { ...base, status: 'pending', kgTaken: 60, kgMeat: 0 },
    ] as any)
    expect(s.entryCount).toBe(1)
    expect(s.totalKgTaken).toBe(100)
    expect(Math.round(s.avgYieldPct)).toBe(70)
  })
})

describe('takenOnProductionDay', () => {
  // Prod 2026-07-21: wpis Ryszarda pobrany 20.07 11:45, domknięty 21.07 06:10.
  // _reattach_overnight_session przepięło go do dzisiejszej sesji, więc HMI —
  // które pobiera wpisy PO SESJI, nie po dacie — doliczyło jego 240 kg do
  // dzisiejszego kafelka: 240 + 150 = 390 kg zamiast 150 kg.
  const dzis = new Date('2026-07-21T09:00:00')

  it('pomija wpis pobrany wczoraj, a domknięty dziś', () => {
    const out = takenOnProductionDay([
      { createdAt: '2026-07-20T11:45:00', completedAt: '2026-07-21T06:10:00', kgTaken: 240 },
      { createdAt: '2026-07-21T08:43:00', completedAt: '2026-07-21T08:43:00', kgTaken: 150 },
    ] as any, dzis)
    expect(out).toHaveLength(1)
    expect((out[0] as any).kgTaken).toBe(150)
  })

  it('zostawia wpis pobrany dziś, jeszcze niedomknięty', () => {
    const out = takenOnProductionDay([
      { createdAt: '2026-07-21T07:10:00', completedAt: null, kgTaken: 135 },
    ] as any, dzis)
    expect(out).toHaveLength(1)
  })

  it('nocna zmiana przed 04:00 liczy się do poprzedniego dnia produkcyjnego', () => {
    const przedSwitem = new Date('2026-07-21T02:30:00')
    const out = takenOnProductionDay([
      { createdAt: '2026-07-20T22:00:00', completedAt: null, kgTaken: 90 },
    ] as any, przedSwitem)
    expect(out).toHaveLength(1)
  })

  it('bez createdAt nie wywala się i nie zgaduje dnia', () => {
    expect(takenOnProductionDay([{ kgTaken: 10 } as any], dzis)).toHaveLength(0)
  })
})
