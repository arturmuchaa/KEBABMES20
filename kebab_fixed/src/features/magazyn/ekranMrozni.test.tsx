// @vitest-environment jsdom
/**
 * MROŹNIA z ważeniem (spec 2026-09-29): pełny karton → paleta → waga →
 * etykieta → mroźnia. Niepełny idzie starą ścieżką. Niezgodna waga nie
 * blokuje — tylko ostrzeżenie.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const s = vi.hoisted(() => ({
  sprawdz: null as any,
  wazenia: [] as any[],
  stare: [] as string[],
  druki: [] as string[],
  alarmy: [] as any[],
  ok: true,
  wyjazdy: [] as string[],
  lista: [] as any[],
  kartony: [] as any[],
  wm: {} as Record<string, any>,
}))

const PALETY = [
  { id: 'jednorazowa', name: 'Jednorazowa', tareMinKg: 20, tareMaxKg: 30, marginPct: 1 },
  { id: 'euro', name: 'EURO', tareMinKg: 33.25, tareMaxKg: 36.75, marginPct: 1 },
]

vi.mock('@/lib/api', () => ({
  magazynApi: {
    mrozniaKartony: () => Promise.resolve(s.kartony),
    mrozniaWazenia: () => Promise.resolve(s.wm),
    mrozniaWyjazd: (kod: string) => { s.wyjazdy.push(kod); return Promise.resolve({ result: 'SUCCESS', cartonNo: '000123', clientName: 'YALCIN' }) },
    paletyMrozni: () => Promise.resolve(PALETY),
    mrozniaSprawdz: () => Promise.resolve(s.sprawdz),
    mrozniaKarton: (kod: string) => { s.stare.push(kod); return Promise.resolve({ result: 'SUCCESS', cartonNo: '000123', clientName: 'YALCIN' }) },
    mrozniaWazenie: (b: any) => {
      s.wazenia.push(b)
      return Promise.resolve({
        id: 'w1', code: b.code, containerKind: 'stock', containerId: 'c1', cartonNo: '000123',
        clientName: 'YALCIN', orderNo: '', lines: [{ qty: 15, kgPerUnit: 50, recipeName: 'ZAGROS', productTypeName: '' }],
        palletTypeId: b.palletTypeId, palletTypeName: 'EURO', tareMinKg: 33.25, tareMaxKg: 36.75, tareKg: 35,
        marginPct: 1, grossKg: b.grossKg, netKg: 750, diffKg: s.ok ? -5 : 40, ok: s.ok, weighMode: b.mode,
        operator: 'Jan', weighedAt: '2026-09-29T10:24:00',
      })
    },
  },
  palletScanApi: {
    inColdStorage: () => Promise.resolve(s.lista),
    scan: (kod: string) => { s.stare.push(kod); return Promise.resolve({ result: 'SUCCESS', order: { clientName: 'X' }, palletNo: 1, totalKg: 1 }) },
  },
  isOfflineError: () => false,
  errCode: () => '',
}))

vi.mock('@/lib/zebra', () => ({
  getDevices: () => Promise.resolve({ default: { send: (z: string, ok: () => void) => { s.druki.push(z); ok() } }, list: [] }),
  sendZpl: (d: any, z: string) => new Promise<void>(res => d.send(z, res)),
  probeBrowserPrint: () => Promise.resolve({ ok: true }),
}))

vi.mock('./dzwiek', () => ({ grajBlad: () => {} }))

import { EkranMrozni, pelnoscPalety } from './EkranMrozni'

const PELNY = {
  result: 'OK', status: 'full', kind: 'stock', id: 'c1', code: 'SCARTON|0123456789abcdef0123', cartonNo: '000123',
  clientName: 'YALCIN', orderNo: '', palletNo: 0, full: true, inColdStorage: false, netKg: 750, qty: 15,
  lines: [{ qty: 15, kgPerUnit: 50, recipeName: 'ZAGROS', productTypeName: '' }], lastWeighing: null,
}

function wjazd() { fireEvent.click(screen.getByRole('button', { name: /Wjedź do mroźni/ })) }
function wyjazd() { fireEvent.click(screen.getByRole('button', { name: /Wyjedź z mroźni/ })) }

function skanuj(kod: string) {
  const pole = screen.getByPlaceholderText('Skanuj kartkę palety…')
  fireEvent.change(pole, { target: { value: kod } })
  fireEvent.keyDown(pole, { key: 'Enter' })
  fireEvent.submit(pole.closest('form') ?? pole)
}

beforeEach(() => {
  s.sprawdz = PELNY; s.wazenia = []; s.stare = []; s.druki = []; s.alarmy = []; s.ok = true; s.wyjazdy = []
  s.lista = []; s.kartony = []; s.wm = {}
  try { localStorage.clear() } catch { /* */ }
})
afterEach(() => { cleanup(); (window as any).__scaleSim?.(null) })

describe('mroźnia — ważenie pełnego kartonu', () => {
  it('skan → EURO → waga 780 → ZGODNA → zapis, etykieta, bez alarmu', async () => {
    render(<EkranMrozni onAlarm={a => s.alarmy.push(a)} />)
    wjazd()
    skanuj('SCARTON|0123456789abcdef0123')
    await screen.findByRole('dialog', { name: 'Ważenie kartonu' })
    act(() => { (window as any).__scaleSim(780) })
    fireEvent.click(screen.getByRole('button', { name: /EURO/ }))
    expect(screen.getByTestId('werdykt').textContent).toContain('ZGODNA')
    fireEvent.click(screen.getByRole('button', { name: /Zatwierdź/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(s.wazenia).toEqual([{ code: PELNY.code, palletTypeId: 'euro', grossKg: 780, mode: 'auto' }])
    expect(s.druki).toHaveLength(1)
    expect(s.druki[0]).toContain('ZGODNA')
    expect(s.stare).toEqual([])
    expect(s.alarmy).toEqual([])
    expect(screen.getByText(/780 kg brutto · ZGODNA/)).toBeTruthy()
  })

  it('waga niestabilna — nie da się zatwierdzić', async () => {
    render(<EkranMrozni onAlarm={a => s.alarmy.push(a)} />)
    wjazd()
    skanuj('SCARTON|0123456789abcdef0123')
    await screen.findByRole('dialog')
    act(() => { (window as any).__scaleSim(700, false) })
    fireEvent.click(screen.getByRole('button', { name: /EURO/ }))
    expect((screen.getByRole('button', { name: /Zatwierdź/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('waga się ustala…')).toBeTruthy()
  })

  it('niezgodna wjeżdża, ale podnosi ostrzeżenie', async () => {
    s.ok = false
    render(<EkranMrozni onAlarm={a => s.alarmy.push(a)} />)
    wjazd()
    skanuj('SCARTON|0123456789abcdef0123')
    await screen.findByRole('dialog')
    act(() => { (window as any).__scaleSim(825) })
    fireEvent.click(screen.getByRole('button', { name: /EURO/ }))
    expect(screen.getByTestId('werdykt').textContent).toContain('NIEZGODNA +40 kg')
    fireEvent.click(screen.getByRole('button', { name: /Zatwierdź/ }))
    await waitFor(() => expect(s.alarmy).toHaveLength(1))
    expect(s.alarmy[0].ton).toBe('uwaga')
    expect(s.alarmy[0].naglowek).toContain('NIEZGODNA')
    expect(s.druki[0]).toContain('NIEZGODNA +40 kg')
  })

  it('bez wagi — brutto wpisane ręcznie', async () => {
    render(<EkranMrozni onAlarm={a => s.alarmy.push(a)} />)
    wjazd()
    skanuj('SCARTON|0123456789abcdef0123')
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: /Jednorazowa/ }))
    fireEvent.change(screen.getByLabelText('Brutto ręcznie'), { target: { value: '775,5' } })
    fireEvent.click(screen.getByRole('button', { name: /Zatwierdź/ }))
    await waitFor(() => expect(s.wazenia).toHaveLength(1))
    expect(s.wazenia[0]).toMatchObject({ palletTypeId: 'jednorazowa', grossKg: 775.5, mode: 'manual' })
  })

  it('niepełny karton (bez przejścia do pakowania) — alarm, nic nie wjeżdża', async () => {
    s.sprawdz = { ...PELNY, full: false, status: 'packing' }
    render(<EkranMrozni onAlarm={a => s.alarmy.push(a)} />)
    wjazd()
    skanuj('SCARTON|0123456789abcdef0123')
    await waitFor(() => expect(s.alarmy[0]?.naglowek).toBe('KARTON NIE JEST PEŁNY'))
    expect(s.stare).toEqual([])
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('mroźnia — kartka niedopakowanego kartonu', () => {
  it('otwiera ten karton do pakowania zamiast alarmu', async () => {
    s.sprawdz = { ...PELNY, full: false, open: true, status: 'packing' }
    const otworz = vi.fn()
    render(<EkranMrozni onAlarm={a => s.alarmy.push(a)} onOtworzKarton={otworz} />)
    wjazd()
    skanuj('SCARTON|0123456789abcdef0123')
    await waitFor(() => expect(otworz).toHaveBeenCalledWith('c1'))
    expect(s.stare).toEqual([])
    expect(s.alarmy).toEqual([])
  })
})


describe('mroźnia — tryb wjazd / wyjazd (29.09.2026)', () => {
  it('bez wybranego trybu skan nic nie robi, tylko mówi „wybierz"', async () => {
    render(<EkranMrozni onAlarm={a => s.alarmy.push(a)} />)
    skanuj('SCARTON|0123456789abcdef0123')
    await waitFor(() => expect(s.alarmy[0]?.naglowek).toBe('WYBIERZ: WJAZD CZY WYJAZD'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('„Zważ później": karton wjeżdża bez ważenia', async () => {
    render(<EkranMrozni onAlarm={a => s.alarmy.push(a)} />)
    wjazd()
    skanuj('SCARTON|0123456789abcdef0123')
    fireEvent.click(await screen.findByRole('button', { name: 'Zważ później' }))
    await waitFor(() => expect(s.stare).toEqual([PELNY.code]))
    expect(s.wazenia).toEqual([])
    expect(await screen.findByText(/DO ZWAŻENIA/)).toBeTruthy()
  })

  it('wjazd: karton już w mroźni → karta kartonu, nie czerwony alarm', async () => {
    s.sprawdz = { ...PELNY, status: 'cold_storage', inColdStorage: true }
    const karta = vi.fn()
    render(<EkranMrozni onAlarm={a => s.alarmy.push(a)} onKartaKartonu={karta} />)
    wjazd()
    skanuj('SCARTON|0123456789abcdef0123')
    await waitFor(() => expect(karta).toHaveBeenCalledWith('SCARTON|0123456789abcdef0123'))
    expect(s.alarmy).toEqual([])
  })

  it('wyjazd: karton z mroźni wraca do pakowania', async () => {
    s.sprawdz = { ...PELNY, status: 'cold_storage', inColdStorage: true }
    render(<EkranMrozni onAlarm={a => s.alarmy.push(a)} />)
    wyjazd()
    skanuj('SCARTON|0123456789abcdef0123')
    await waitFor(() => expect(s.wyjazdy).toEqual([PELNY.code]))
    expect(await screen.findByText(/Wyjechał: karton 000123/)).toBeTruthy()
  })
})

// Właściciel 30.09.2026: lista mroźni ma mówić wprost — pełny (zielony) czy
// niepełny (szary) i czy zważony, kiedy i kto.
describe('mroźnia — lista: pełny/niepełny i ważenie', () => {
  it('pełność palety liczona ze skanów wobec rozpisu', () => {
    expect(pelnoscPalety(15, 15)).toEqual({ pelny: true, t: 'PEŁNY 15/15 szt' })
    expect(pelnoscPalety(10, 15).pelny).toBe(false)
    expect(pelnoscPalety(10, 15).t).toBe('NIEPEŁNY 10/15 szt')
    expect(pelnoscPalety(0, 20).t).toContain('BEZ SKANU')
  })

  it('pełny zważony na zielono z godziną i osobą; niepełny szary „nie zważony"', async () => {
    s.lista = [
      { orderId: 'o1', orderNo: 'YALCIN/Z/9/09/26', clientName: 'YALCIN', deliveryDate: '2026-10-05', palletId: 'p1',
        palletNo: 1, cartonNo: '000501', totalKg: 750, totalQty: 15, scannedQty: 15, parts: [] },
    ]
    s.kartony = [{ id: 'c9', cartonNo: '000777', clientName: 'ZAGROS', packedQty: 8, targetQty: 15, full: false, kg: 400, coldStorageAt: '' }]
    s.wm = { p1: { ok: true, grossKg: 790, diffKg: 0, weighedAt: '2026-09-30T08:05:00', operator: 'Jan', weighMode: 'auto' } }
    render(<EkranMrozni onAlarm={a => s.alarmy.push(a)} />)
    await waitFor(() => expect(screen.getAllByTestId('wiersz-mrozni').length).toBe(2))
    const [pelny, niepelny] = screen.getAllByTestId('wiersz-mrozni')
    expect(pelny.dataset.pelny).toBe('1')
    expect(pelny.textContent).toContain('PEŁNY 15/15 szt')
    expect(pelny.textContent).toContain('✓ ZWAŻONY')
    expect(pelny.textContent).toContain('30.09 08:05 · Jan')
    expect(niepelny.dataset.pelny).toBe('0')
    expect(niepelny.textContent).toContain('NIEPEŁNY 8/15 szt')
    expect(niepelny.textContent).toContain('NIE ZWAŻONY')
  })
})
