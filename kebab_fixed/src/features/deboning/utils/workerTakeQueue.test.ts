import { describe, expect, it } from 'vitest'
import { workerTakeState, type QueuedTake } from './workerTakeQueue'

const zs = (over: Partial<QueuedTake> = {}): QueuedTake => ({
  id: 'zs1', workerId: 'anatoli', rawBatchId: 'b441', rawBatchNo: '441',
  kgTaken: 150, kgMeatWeighed: 0, meatType: 'zs', ...over,
})
const bs = (over: Partial<QueuedTake> = {}): QueuedTake =>
  zs({ id: 'bs1', kgTaken: 15, meatType: 'bs', ...over })

describe('workerTakeState — kolejka pobrań per rodzaj mięsa', () => {
  it('bez pobrań: kafel czysty, klik zakłada nowe pobranie', () => {
    const s = workerTakeState([], 'anatoli', 'zs', 'b441')
    expect(s.action).toBe('new')
    expect(s.pendingKg).toBeUndefined()
    expect(s.blocked).toBe(false)
  })

  it('suwak Z/S przy otwartym Z/S: domknięcie tego pobrania', () => {
    const s = workerTakeState([zs()], 'anatoli', 'zs', 'b441')
    expect(s.action).toBe('resume')
    expect(s.resumeEntryId).toBe('zs1')
    expect(s.pendingKg).toBe(150)
  })

  // Sedno zgłoszenia z hali (28.07): Anatoli robi 150 kg z/s, wpada pilne
  // zamówienie na b/s — operator przełącza suwak i musi móc DODAĆ drugie
  // pobranie, a nie zobaczyć zablokowany kafel.
  it('suwak B/S przy otwartym Z/S: nowe pobranie, kafel nie blokuje', () => {
    const s = workerTakeState([zs()], 'anatoli', 'bs', 'b441')
    expect(s.action).toBe('new')
    expect(s.blocked).toBe(false)
    expect(s.pendingKg).toBeUndefined()
  })

  it('kafel pokazuje kg RODZAJU z suwaka, nie sumy obu pobrań', () => {
    const takes = [zs(), bs()]
    expect(workerTakeState(takes, 'anatoli', 'bs', 'b441').pendingKg).toBe(15)
    expect(workerTakeState(takes, 'anatoli', 'zs', 'b441').pendingKg).toBe(150)
  })

  it('drugi rodzaj widać jako znacznik, żeby operator o nim nie zapomniał', () => {
    const takes = [zs(), bs()]
    expect(workerTakeState(takes, 'anatoli', 'zs', 'b441').otherKindKg).toBe(15)
    expect(workerTakeState(takes, 'anatoli', 'bs', 'b441').otherKindKg).toBe(150)
    expect(workerTakeState([zs()], 'anatoli', 'zs', 'b441').otherKindKg).toBeUndefined()
  })

  it('suwak B/S wskazuje pobranie B/S do domknięcia, nie Z/S', () => {
    const s = workerTakeState([zs(), bs()], 'anatoli', 'bs', 'b441')
    expect(s.action).toBe('resume')
    expect(s.resumeEntryId).toBe('bs1')
    expect(s.pendingKg).toBe(15)
  })

  // Mięso wraca pod partię POBRANIA (prod 2026-07-10) — reguła musi działać
  // per rodzaj, inaczej otwarte z/s z innej partii blokowałoby domknięcie b/s.
  it('inna wybrana partia niż partia pobrania: blokada z podpowiedzią', () => {
    const s = workerTakeState([bs()], 'anatoli', 'bs', 'b442')
    expect(s.action).toBe('wrong-batch')
    expect(s.blocked).toBe(true)
    expect(s.wrongBatchNos).toEqual(['441'])
  })

  it('otwarte Z/S z innej partii nie blokuje pobrania B/S z wybranej', () => {
    const s = workerTakeState([zs({ rawBatchId: 'b440', rawBatchNo: '440' })], 'anatoli', 'bs', 'b441')
    expect(s.action).toBe('new')
    expect(s.blocked).toBe(false)
  })

  it('bez wybranej partii domyka najstarsze pobranie danego rodzaju', () => {
    const s = workerTakeState(
      [bs({ id: 'bs-old', rawBatchId: 'b440', rawBatchNo: '440' }), bs({ id: 'bs-new' })],
      'anatoli', 'bs', null)
    expect(s.action).toBe('resume')
    expect(s.resumeEntryId).toBe('bs-old')
    expect(s.pendingKg).toBe(30)
    expect(s.pendingBatchNos).toEqual(['440', '441'])
  })

  it('przy wybranej partii domyka pobranie Z TEJ partii', () => {
    const s = workerTakeState(
      [zs({ id: 'zs-440', rawBatchId: 'b440', rawBatchNo: '440' }), zs({ id: 'zs-441' })],
      'anatoli', 'zs', 'b441')
    expect(s.resumeEntryId).toBe('zs-441')
  })

  it('zważone porcje sumują się tylko w obrębie rodzaju', () => {
    const s = workerTakeState([zs({ kgMeatWeighed: 60 }), bs({ kgMeatWeighed: 3 })], 'anatoli', 'zs', 'b441')
    expect(s.pendingWeighedKg).toBe(60)
  })

  it('brak meatType (stare pobrania sprzed b/s) liczy się jako Z/S', () => {
    const s = workerTakeState([zs({ meatType: undefined })], 'anatoli', 'zs', 'b441')
    expect(s.action).toBe('resume')
  })

  it('pobrania innych pracowników nie wpływają na kafel', () => {
    const s = workerTakeState([zs({ workerId: 'serhii' })], 'anatoli', 'zs', 'b441')
    expect(s.action).toBe('new')
    expect(s.otherKindKg).toBeUndefined()
  })
})
