// @vitest-environment jsdom
/**
 * Wydanie pojedynczych sztuk (właściciel 30.09.2026): klient → skan sztuk
 * (schodzą z kartonów) → przekaż do biura. Kiosk niczego nie wystawia.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const s = vi.hoisted(() => ({ skan: null as any, zalozone: [] as any[], przekazane: [] as string[], cofniete: [] as string[], alarmy: [] as any[] }))

const PUSTE = { id: 'd1', status: 'open', clientId: 'k1', clientName: 'KEBAP HAUS', pickup: 'klient', vehicleId: '',
  operator: '', notes: 'odbiór przez klienta', createdAt: '', handedAt: '', qty: 0, kg: 0, units: [] }
const Z_SZTUKA = { ...PUSTE, qty: 1, kg: 50, units: [{ id: 'u1', kg: 50, batchNo: '290926 591', recipeName: 'KIRMIZI',
  productTypeName: '', fromCartonNo: '000123', fromClient: 'ZAGROS' }] }

vi.mock('@/lib/api', () => ({
  magazynApi: {
    wydanieSztukOtwarte: () => Promise.resolve([]),
    wydanieSztukKlienci: () => Promise.resolve([{ id: 'k1', name: 'Kebap Haus GmbH', displayName: 'KEBAP HAUS' },
                                                { id: 'k2', name: 'ZAGROS', displayName: 'ZAGROS' }]),
    zalozWydanieSztuk: (b: any) => { s.zalozone.push(b); return Promise.resolve(PUSTE) },
    skanWydaniaSztuk: () => Promise.resolve(s.skan),
    cofnijZWydaniaSztuk: (_: string, u: string) => { s.cofniete.push(u); return Promise.resolve({ ...PUSTE, backToCarton: true, cartonNo: '000123' }) },
    przekazWydanieSztuk: (id: string) => { s.przekazane.push(id); return Promise.resolve({ ...Z_SZTUKA, status: 'ready' }) },
    porzucWydanieSztuk: () => Promise.resolve({ ok: true }),
  },
  vehiclesApi: { list: () => Promise.resolve([]) },
  isOfflineError: () => false,
}))
vi.mock('./dzwiek', () => ({ grajBlad: () => {}, grajInny: () => {} }))

import { EkranWydaniaSztuk } from './EkranWydaniaSztuk'

beforeEach(() => { s.skan = { result: 'OK', from: { kind: 'stock', cartonNo: '000123', clientName: 'ZAGROS' }, ...Z_SZTUKA }
  s.zalozone = []; s.przekazane = []; s.cofniete = []; s.alarmy = [] })
afterEach(cleanup)

async function doSkanowania() {
  render(<EkranWydaniaSztuk onAlarm={a => s.alarmy.push(a)} onKoniec={() => {}} />)
  fireEvent.click(await screen.findByText('KEBAP HAUS'))
  fireEvent.click(screen.getByRole('button', { name: 'Odbiór przez klienta' }))
  fireEvent.click(screen.getByRole('button', { name: /Skanuj sztuki/ }))
  await screen.findByPlaceholderText('Skanuj etykietę sztuki…')
}

function skanuj(kod: string) {
  const pole = screen.getByPlaceholderText('Skanuj etykietę sztuki…')
  fireEvent.change(pole, { target: { value: kod } })
  fireEvent.keyDown(pole, { key: 'Enter' })
  fireEvent.submit(pole.closest('form') ?? pole)
}

describe('wydanie sztuk z kiosku', () => {
  it('bez klienta i sposobu odbioru nie da się zacząć', async () => {
    render(<EkranWydaniaSztuk onAlarm={() => {}} onKoniec={() => {}} />)
    await screen.findByText('KEBAP HAUS')
    expect((screen.getByRole('button', { name: /Skanuj sztuki/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('skan zdejmuje sztukę z kartonu i mówi skąd; przekazanie idzie do biura', async () => {
    await doSkanowania()
    expect(s.zalozone[0]).toEqual({ client_id: 'k1', pickup: 'klient', vehicle_id: null })
    skanuj('U|0123456789abcdef0123')
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Zdjęta z kartonu 000123 (ZAGROS)'))
    expect(screen.getByTestId('sztuki-wydania').textContent).toContain('KIRMIZI')
    fireEvent.click(screen.getByRole('button', { name: 'Przekaż do biura' }))
    expect(await screen.findByText('Przekazane do biura')).toBeTruthy()
    expect(s.przekazane).toEqual(['d1'])
  })

  it('cudza albo wydana sztuka — czerwony alarm, nic nie znika', async () => {
    await doSkanowania()
    s.skan = { result: 'SHIPPED' }
    skanuj('U|0123456789abcdef0123')
    await waitFor(() => expect(s.alarmy[0]?.naglowek).toBe('SZTUKA JUŻ WYDANA'))
  })

  it('Cofnij odkłada sztukę do kartonu', async () => {
    await doSkanowania()
    skanuj('U|0123456789abcdef0123')
    fireEvent.click(await screen.findByRole('button', { name: 'Cofnij' }))
    await waitFor(() => expect(s.cofniete).toEqual(['u1']))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Wróciła do kartonu 000123'))
  })
})
