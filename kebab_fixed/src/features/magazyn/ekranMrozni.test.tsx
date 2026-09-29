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
}))

const PALETY = [
  { id: 'jednorazowa', name: 'Jednorazowa', tareMinKg: 20, tareMaxKg: 30, marginPct: 1 },
  { id: 'euro', name: 'EURO', tareMinKg: 33.25, tareMaxKg: 36.75, marginPct: 1 },
]

vi.mock('@/lib/api', () => ({
  magazynApi: {
    mrozniaKartony: () => Promise.resolve([]),
    paletyMrozni: () => Promise.resolve(PALETY),
    mrozniaSprawdz: () => Promise.resolve(s.sprawdz),
    mrozniaKarton: (kod: string) => { s.stare.push(kod); return Promise.resolve({ result: 'NOT_FULL' }) },
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
    inColdStorage: () => Promise.resolve([]),
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

import { EkranMrozni } from './EkranMrozni'

const PELNY = {
  result: 'OK', kind: 'stock', id: 'c1', code: 'SCARTON|0123456789abcdef0123', cartonNo: '000123',
  clientName: 'YALCIN', orderNo: '', palletNo: 0, full: true, inColdStorage: false, netKg: 750, qty: 15,
  lines: [{ qty: 15, kgPerUnit: 50, recipeName: 'ZAGROS', productTypeName: '' }], lastWeighing: null,
}

function skanuj(kod: string) {
  const pole = screen.getByPlaceholderText('Skanuj kartkę palety…')
  fireEvent.change(pole, { target: { value: kod } })
  fireEvent.keyDown(pole, { key: 'Enter' })
  fireEvent.submit(pole.closest('form') ?? pole)
}

beforeEach(() => {
  s.sprawdz = PELNY; s.wazenia = []; s.stare = []; s.druki = []; s.alarmy = []; s.ok = true
  try { localStorage.clear() } catch { /* */ }
})
afterEach(() => { cleanup(); (window as any).__scaleSim?.(null) })

describe('mroźnia — ważenie pełnego kartonu', () => {
  it('skan → EURO → waga 780 → ZGODNA → zapis, etykieta, bez alarmu', async () => {
    render(<EkranMrozni onAlarm={a => s.alarmy.push(a)} />)
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
    skanuj('SCARTON|0123456789abcdef0123')
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: /Jednorazowa/ }))
    fireEvent.change(screen.getByLabelText('Brutto ręcznie'), { target: { value: '775,5' } })
    fireEvent.click(screen.getByRole('button', { name: /Zatwierdź/ }))
    await waitFor(() => expect(s.wazenia).toHaveLength(1))
    expect(s.wazenia[0]).toMatchObject({ palletTypeId: 'jednorazowa', grossKg: 775.5, mode: 'manual' })
  })

  it('niepełny karton — bez ważenia, stara ścieżka', async () => {
    s.sprawdz = { ...PELNY, full: false }
    render(<EkranMrozni onAlarm={a => s.alarmy.push(a)} />)
    skanuj('SCARTON|0123456789abcdef0123')
    await waitFor(() => expect(s.stare).toEqual(['SCARTON|0123456789abcdef0123']))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('mroźnia — kartka niedopakowanego kartonu', () => {
  it('otwiera ten karton do pakowania zamiast alarmu', async () => {
    s.sprawdz = { ...PELNY, full: false, open: true }
    const otworz = vi.fn()
    render(<EkranMrozni onAlarm={a => s.alarmy.push(a)} onOtworzKarton={otworz} />)
    skanuj('SCARTON|0123456789abcdef0123')
    await waitFor(() => expect(otworz).toHaveBeenCalledWith('c1'))
    expect(s.stare).toEqual([])
    expect(s.alarmy).toEqual([])
  })
})
