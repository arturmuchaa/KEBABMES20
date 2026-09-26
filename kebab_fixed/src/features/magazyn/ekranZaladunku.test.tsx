// @vitest-environment jsdom
/**
 * Załadunek na kiosku magazynu.
 *
 * Pilnuje dwóch rzeczy, które kosztowały już produkcję:
 * 1. skan poza kolejnością OSTRZEGA, ale palety NIE odrzuca (21.09.2026),
 * 2. odmowa niesie KOD z backendu, nie zdanie.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const s = vi.hoisted(() => ({
  migawka: null as any, wynik: null as any, odmowa: null as any,
  skany: [] as string[], dodane: [] as string[],
  finalize: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  vehicleLoadingApi: {
    state: () => Promise.resolve(s.migawka),
    addOrder: (_v: string, id: string) => { s.dodane.push(id); return Promise.resolve(s.migawka) },
    removeOrder: () => Promise.resolve(s.migawka),
  },
  palletScanApi: {
    scan: (kod: string) => {
      s.skany.push(kod)
      return s.odmowa ? Promise.reject(s.odmowa) : Promise.resolve(s.wynik)
    },
    activeLoading: () => Promise.resolve([
      { id: 'nazar', orderNo: 'NAZAR/Z/4/09/26', clientName: 'NAZAR', deliveryDate: null,
        orderStatus: 'confirmed', totalPallets: 2, loadedPallets: 0, coldPallets: 2, createdPallets: 0 },
    ]),
    finalizeLoading: s.finalize,
  },
  errCode: (e: any) => e?.code ?? '',
  isOfflineError: (e: any) => e?.offline === true,
}))
vi.mock('./dzwiek', () => ({ grajInny: () => {}, grajBlad: () => {} }))

import { EkranZaladunku } from './EkranZaladunku'

const MIGAWKA = {
  vehicle: { id: 'v1', name: 'SOLÓWKA', plate: 'KR 8842L', kind: 'own' },
  orders: [{
    id: 'polat', orderNo: 'POLAT/Z/2/09/26', clientName: 'POLAT', deliveryDate: null,
    orderStatus: 'confirmed', position: 0,
    pallets: [{ id: 'p1', palletNo: 1, status: 'cold_storage', totalKg: 620, totalQty: 24, items: [], onThisVehicle: false }],
    totals: { totalPallets: 1, loadedPallets: 0, coldPallets: 1, createdPallets: 0, shippedPallets: 0, totalKg: 620, loadedKg: 0 },
  }],
  totals: { totalPallets: 1, loadedPallets: 0, shippedPallets: 0, totalKg: 620, loadedKg: 0 },
}

beforeEach(() => {
  sessionStorage.clear()
  s.finalize.mockReset()
  s.migawka = MIGAWKA; s.odmowa = null; s.skany = []; s.dodane = []
  s.wynik = { result: 'SUCCESS', palletNo: 1, totalKg: 620,
    order: { id: 'polat', orderNo: 'POLAT/Z/2/09/26' }, pozaKolejnoscia: null }
})

function loaded() {
  s.migawka = { ...MIGAWKA,
    totals: { ...MIGAWKA.totals, loadedPallets: 1, loadedKg: 620 },
    orders: MIGAWKA.orders.map(o => ({ ...o, totals: { ...o.totals, loadedPallets: 1, loadedKg: 620 },
      pallets: o.pallets.map(p => ({ ...p, onThisVehicle: true, cartonNo: '000318' })) })),
  }
}

describe('potwierdzanie kursu', () => {
  it('wyjaśnia brak przypisania kartonu do zamówienia', async () => {
    const alarm = vi.fn()
    s.odmowa = new Error('Biuro musi najpierw przypisać karton do zamówienia')
    render(<EkranZaladunku vehicleId="v1" onAlarm={alarm} onKoniec={vi.fn()} />)
    await screen.findByText('SOLÓWKA')
    skan('SCARTON|abcdef12345678901234')
    await waitFor(() => expect(alarm).toHaveBeenCalledWith(expect.objectContaining({ szczegol: s.odmowa.message })))
  })

  it('odrzuca kod QR wpisany w numer rejestracyjny', async () => {
    loaded()
    s.migawka.vehicle = { ...MIGAWKA.vehicle, kind: 'external' }
    const alarm = vi.fn()
    render(<EkranZaladunku vehicleId="v1" onAlarm={alarm} onKoniec={vi.fn()} />)
    fireEvent.click(await screen.findByText('Zakończ załadunek'))
    fireEvent.change(screen.getByLabelText('Numer rejestracyjny (spedycja)'), { target: { value: 'PAL|polat|1' } })
    fireEvent.click(screen.getByText('Zakończ', { exact: true }))
    expect(s.finalize).not.toHaveBeenCalled()
    expect(alarm).toHaveBeenCalledWith(expect.objectContaining({ naglowek: 'TO KOD SKANERA, NIE REJESTRACJA' }))
  })

  it('odzyskuje identyfikator niepotwierdzonego zapisu po ponownym otwarciu ekranu', async () => {
    loaded()
    s.finalize.mockRejectedValueOnce({ offline: true })
    const props = { vehicleId: 'v1', onAlarm: vi.fn(), onKoniec: vi.fn() }
    const view = render(<EkranZaladunku {...props} />)
    fireEvent.click(await screen.findByText('Zakończ załadunek'))
    fireEvent.click(screen.getByText('Zakończ', { exact: true }))
    await screen.findByText(/Nie otrzymano potwierdzenia/)
    const first = s.finalize.mock.calls[0]
    view.unmount()
    s.finalize.mockResolvedValue({ ok: true, loading_id: 'course1', orders: [] })
    render(<EkranZaladunku {...props} />)
    await screen.findByText(/Nie otrzymano potwierdzenia/)
    fireEvent.click(screen.getByText('Zakończ', { exact: true }))
    await waitFor(() => expect(s.finalize).toHaveBeenCalledTimes(2))
    expect(s.finalize.mock.calls[1]).toEqual(first)
    await waitFor(() => expect(sessionStorage.getItem('magazyn.finalize.v1')).toBeNull())
  })

  it('blokuje skaner pod dialogiem i pokazuje numery kartonów', async () => {
    loaded()
    render(<EkranZaladunku vehicleId="v1" onAlarm={vi.fn()} onKoniec={vi.fn()} />)
    fireEvent.click(await screen.findByText('Zakończ załadunek'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((screen.getByLabelText('Pole skanowania') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('Karton 000318')).toBeTruthy()
    expect(screen.getByText(/Wyjeżdża: 1/)).toBeTruthy()
    skan('PAL|polat|1')
    await Promise.resolve()
    expect(s.skany).toEqual([])
  })

  it('nie ogłasza sukcesu, gdy backend nie utworzył kursu', async () => {
    loaded()
    s.finalize.mockResolvedValue({ ok: false, loading_id: null, orders: [] })
    const alarm = vi.fn(), koniec = vi.fn()
    render(<EkranZaladunku vehicleId="v1" onAlarm={alarm} onKoniec={koniec} />)
    fireEvent.click(await screen.findByText('Zakończ załadunek'))
    fireEvent.click(screen.getByText('Zakończ', { exact: true }))
    await waitFor(() => expect(alarm).toHaveBeenCalledWith(expect.objectContaining({ naglowek: 'KURS NIE ZOSTAŁ ZAPISANY' })))
    expect(koniec).not.toHaveBeenCalled()
  })

  it('ponawia po utracie odpowiedzi tym samym identyfikatorem i składem', async () => {
    loaded()
    s.finalize.mockRejectedValueOnce(Object.assign(new Error('offline'), { offline: true }))
      .mockResolvedValueOnce({ ok: true, loading_id: 'course1', orders: [] })
    const koniec = vi.fn()
    render(<EkranZaladunku vehicleId="v1" onAlarm={vi.fn()} onKoniec={koniec} />)
    fireEvent.click(await screen.findByText('Zakończ załadunek'))
    fireEvent.click(screen.getByText('Zakończ', { exact: true }))
    await screen.findByText(/Nie otrzymano potwierdzenia/)
    await waitFor(() => expect((screen.getByText('Zakończ', { exact: true }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByText('Zakończ', { exact: true }))
    await waitFor(() => expect(koniec).toHaveBeenCalledOnce())
    expect(s.finalize.mock.calls[1]).toEqual(s.finalize.mock.calls[0])
    expect(s.finalize.mock.calls[0][4]).toEqual(['p1'])
  })

  it('pokazuje rozjazd i pominięte zamówienia zamiast zwykłego sukcesu', async () => {
    loaded()
    s.finalize.mockResolvedValue({ ok: true, loading_id: 'course1', orders: [
      { order_id:'polat',client_name:'POLAT',order_no:'Z/1',wz_status:'rozjazd',pallets:1 },
      { order_id:'nazar',client_name:'NAZAR',order_no:'Z/2',skipped:'brak załadowanych sztuk',pallets:0 },
    ] })
    const koniec = vi.fn()
    render(<EkranZaladunku vehicleId="v1" onAlarm={vi.fn()} onKoniec={koniec} />)
    fireEvent.click(await screen.findByText('Zakończ załadunek'))
    fireEvent.click(screen.getByText('Zakończ', { exact: true }))
    await screen.findByText('Kurs zapisany — wymaga wyjaśnienia')
    expect(screen.getByText(/Nie wydano: brak załadowanych sztuk/)).toBeTruthy()
    expect(koniec).not.toHaveBeenCalled()
  })
})
afterEach(cleanup)

function skan(kod: string) {
  const pole = screen.getByLabelText('Pole skanowania')
  fireEvent.change(pole, { target: { value: kod } })
  fireEvent.keyDown(pole, { key: 'Enter' })
}

describe('załadunek na kiosku', () => {
  it('pokazuje auto i zamówienia w kolejności załadunku', async () => {
    render(<EkranZaladunku vehicleId="v1" onAlarm={vi.fn()} onKoniec={() => {}} />)
    expect(await screen.findByText('SOLÓWKA')).toBeTruthy()
    expect(screen.getByText('1. POLAT')).toBeTruthy()
  })

  it('udany skan NIE podnosi alarmu — cisza znaczy dobrze', async () => {
    const onAlarm = vi.fn()
    render(<EkranZaladunku vehicleId="v1" onAlarm={onAlarm} onKoniec={() => {}} />)
    await screen.findByText('SOLÓWKA')
    skan('PAL|polat|1')
    await waitFor(() => expect(s.skany).toEqual(['PAL|polat|1']))
    expect(onAlarm).not.toHaveBeenCalled()
  })

  it('poza kolejnością: BURSZTYN z liczbami, paleta zaliczona', async () => {
    s.wynik = { ...s.wynik, pozaKolejnoscia: { pozycja: 3,
      czeka: { orderNo: 'POLAT/Z/2/09/26', clientName: 'POLAT', pozycja: 1, loaded: 2, total: 3 } } }
    const onAlarm = vi.fn()
    render(<EkranZaladunku vehicleId="v1" onAlarm={onAlarm} onKoniec={() => {}} />)
    await screen.findByText('SOLÓWKA')
    skan('PAL|nazar|1')
    await waitFor(() => expect(onAlarm).toHaveBeenCalled())
    const a = onAlarm.mock.calls[0][0]
    expect(a.ton).toBe('uwaga')
    expect(a.szczegol).toContain('POLAT')
    expect(a.szczegol).toContain('2 z 3')
  })

  it('paleta z obcego zamówienia to CZERWONY alarm', async () => {
    const e: any = new Error('nie ma go na tym samochodzie'); e.code = 'WRONG_ORDER'
    s.odmowa = e
    const onAlarm = vi.fn()
    render(<EkranZaladunku vehicleId="v1" onAlarm={onAlarm} onKoniec={() => {}} />)
    await screen.findByText('SOLÓWKA')
    skan('PAL|obce|1')
    await waitFor(() => expect(onAlarm).toHaveBeenCalled())
    expect(onAlarm.mock.calls[0][0].ton).toBe('blad')
  })

  it('zamówienie dokłada się do auta z listy „Dołóż zamówienie"', async () => {
    render(<EkranZaladunku vehicleId="v1" onAlarm={vi.fn()} onKoniec={() => {}} />)
    fireEvent.click((await screen.findByText('NAZAR')).closest('button')!)
    await waitFor(() => expect(s.dodane).toEqual(['nazar']))
  })
})
