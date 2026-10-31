// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Druk bez obsługi: rolka bez zmian → pomiar drukarki; nowa rolka → kalibracja
 * i skok z JEJ pomiaru; brak odczytu → nastawa stanowiska. Atrapa BrowserPrint
 * na granicy `lib/zebra` (tej samej co w starym MES — jej nie zmieniamy).
 */
const z = vi.hoisted(() => ({
  getDevices: vi.fn(), discoverZebraDevices: vi.fn(), withZebraPrinter: vi.fn(), readZebraStatus: vi.fn(),
  calibrateZebra: vi.fn(), sendZplJobs: vi.fn(), sendZpl: vi.fn(), probeBrowserPrint: vi.fn(),
}))
const prof = vi.hoisted(() => ({ media: null as string | null, pending: false, uid: '' }))
vi.mock('@/lib/zebra', () => ({ ...z, zebraErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) }))
vi.mock('@/lib/zebraProfiles', async (orig) => ({
  ...(await orig() as object),
  loadedZebraMedia: () => prof.media, zebraCalibrationPending: () => prof.pending, selectedZebraUid: () => prof.uid, selectZebra: vi.fn(),
}))
import { drukarka, drukujZawieszki, przyjmijSkok, przygotuj, stanDrukarki, zmienRolke } from './drukarka'
import { DEFAULT_CALIBRATION, loadCalibration, saveCalibration } from '@/features/raw-batches/tagPrinterCalibration'

const dev = { uid: 'usb1', name: 'ZDesigner GC420t', send: vi.fn(), sendThenRead: vi.fn() }
const status = (o: Partial<{ valid: boolean; labelLengthMm: number | null; paperOut: boolean; headOpen: boolean }> = {}) => ({
  valid: true, labelLengthMm: 102.4, labelLengthDots: 819, paperOut: false, paused: false, bufferFull: false, formatsInBuffer: 0, labelsRemaining: 0,
  headOpen: false, ribbonOut: false, tooCold: false, tooHot: false, corruptRam: false, partialFormat: false, ...o,
})
const TAG = { receptionNo: '12/10/2026', supplierName: 'KOKO', batchNo: '471', netKg: 540, containers: 36, containerKg: 15, palletIndex: 1, palletCount: 2, batchKg: 840,
  supplierLots: [{ no: 'L-1' }], slaughterDate: '2026-10-28', expiryDate: '2026-11-04', receivedDate: '2026-10-29' }

beforeEach(() => {
  Object.values(z).forEach(f => f.mockReset())
  localStorage.clear()
  prof.media = '80x100'; prof.pending = false; prof.uid = ''
  z.getDevices.mockResolvedValue({ default: dev, list: [dev] })
  z.withZebraPrinter.mockImplementation((_d: unknown, task: (io: unknown) => unknown) => task({ read: vi.fn().mockResolvedValue('GC420t,V61,8,8192KB'), send: vi.fn() }))
  z.readZebraStatus.mockResolvedValue({ raw: '', status: status() })
  z.calibrateZebra.mockResolvedValue({ lengthMm: 102.7, message: 'ok' })
  z.sendZplJobs.mockResolvedValue(undefined)
  z.probeBrowserPrint.mockResolvedValue({ ok: true })
})

describe('przygotowanie drukarki przed serią', () => {
  it('ta sama rolka i pasująca długość → pomiar drukarki, bez kalibracji', async () => {
    expect(await przygotuj(dev, '80x100')).toBe(102.4)
    expect(z.calibrateZebra).not.toHaveBeenCalled()
  })
  it('inna rolka, przerwana kalibracja albo niepasująca długość → kalibracja teraz, skok z jej pomiaru', async () => {
    prof.media = '50x80'
    expect(await przygotuj(dev, '80x100')).toBe(102.7)
    prof.media = '80x100'; prof.pending = true
    expect(await przygotuj(dev, '80x100')).toBe(102.7)
    prof.pending = false
    z.readZebraStatus.mockResolvedValue({ raw: '', status: status({ labelLengthMm: 82.3 }) })
    expect(await przygotuj(dev, '80x100')).toBe(102.7)
    expect(z.calibrateZebra).toHaveBeenCalledTimes(3)
  })
  it('brak pełnej odpowiedzi albo stary BrowserPrint → null (zostaje nastawa), bez kalibracji', async () => {
    z.readZebraStatus.mockResolvedValue({ raw: '', status: status({ valid: false }) })
    expect(await przygotuj(dev, '80x100')).toBeNull()
    expect(await przygotuj({ ...dev, sendThenRead: undefined }, '80x100')).toBeNull()
    expect(z.calibrateZebra).not.toHaveBeenCalled()
  })
  it('skok z pomiaru trafia do nastawy tylko w zakresie i gdy się zmienił', () => {
    expect(przyjmijSkok(101.9).labelLengthMm).toBe(101.9)
    expect(loadCalibration().labelLengthMm).toBe(101.9)
    expect(przyjmijSkok(82.3).labelLengthMm).toBe(101.9) // rolka 50×80 — nie ta etykieta
    expect(przyjmijSkok(null).labelLengthMm).toBe(101.9)
  })
})

describe('druk zawieszek', () => {
  it('domyślnie ciągiem: cała seria jednym zadaniem, bez przerw; skok z drukarki w ^LL każdej etykiety, przesunięcia zostają', async () => {
    saveCalibration({ ...DEFAULT_CALIBRATION, offsetXMm: 1.5 })
    await drukujZawieszki([TAG, { ...TAG, palletIndex: 2, netKg: 300, containers: 20 }])
    const [d, jobs, opts] = z.sendZplJobs.mock.calls[0]
    expect(d).toBe(dev)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].match(/\^XA/g)).toHaveLength(2)
    expect(jobs[0].match(new RegExp(`\\^LL${Math.round(102.4 * 203 / 25.4)}`, 'g'))).toHaveLength(2)
    expect(opts.delayMs).toBeUndefined()
    expect(loadCalibration()).toMatchObject({ labelLengthMm: 102.4, offsetXMm: 1.5 })
  })
  it('tryb „po jednej”: zadanie na zawieszkę z przerwą (każda staje do oderwania)', async () => {
    localStorage.setItem('protrima.zawieszki.seria', 'pojedynczo')
    await drukujZawieszki([TAG, { ...TAG, palletIndex: 2, netKg: 300, containers: 20 }])
    const [, jobs, opts] = z.sendZplJobs.mock.calls[0]
    expect(jobs).toHaveLength(2)
    expect(opts.delayMs).toBeGreaterThanOrEqual(600)
  })
  it('brak drukarki: komunikat słowami — inny, gdy zapamiętana drukarka zniknęła', async () => {
    z.getDevices.mockResolvedValue({ default: null, list: [] })
    await expect(drukarka()).rejects.toThrow(/Nie widzę drukarki etykiet/)
    prof.uid = 'usb9'
    await expect(drukarka()).rejects.toThrow(/Zapamiętana drukarka etykiet nie odpowiada/)
    expect(z.sendZplJobs).not.toHaveBeenCalled()
  })
  it('„Zmieniam rolkę” kalibruje i zapisuje zmierzony skok', async () => {
    expect(await zmienRolke()).toMatch(/zmierzyła etykietę: 102,7 mm/)
    expect(loadCalibration().labelLengthMm).toBe(102.7)
  })
})

describe('stan drukarki (bez drukowania)', () => {
  it('gotowa: nazwa, model, rolka, skok; problemy drukarki słowami', async () => {
    z.discoverZebraDevices.mockResolvedValue([dev])
    expect(await stanDrukarki()).toMatchObject({ nazwa: 'ZDesigner GC420t', model: 'GC420t', gotowa: true, problemy: [], skokMm: 102.4, rolka: expect.stringMatching(/80 × 100/) })
    z.readZebraStatus.mockResolvedValue({ raw: '', status: status({ paperOut: true, headOpen: true }) })
    const s = await stanDrukarki()
    expect(s.gotowa).toBe(false)
    expect(s.problemy.join(' ')).toMatch(/brak papieru.*otwarta|otwarta.*brak papieru/i)
  })
  it('usługa BrowserPrint nie odpowiada → powód zamiast wyjątku', async () => {
    z.discoverZebraDevices.mockRejectedValue(new Error('Nie udało się wczytać klienta BrowserPrint'))
    z.probeBrowserPrint.mockResolvedValue({ ok: false, reason: 'Uruchom Zebra BrowserPrint na tym komputerze.' })
    expect(await stanDrukarki()).toMatchObject({ nazwa: null, powod: 'Nie udało się wczytać klienta BrowserPrint Uruchom Zebra BrowserPrint na tym komputerze.' })
  })
})
