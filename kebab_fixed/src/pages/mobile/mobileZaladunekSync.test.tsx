// @vitest-environment jsdom
/**
 * Załadunek na KILKU urządzeniach — baza jest jedynym źródłem prawdy.
 *
 * Właściciel (20.09.2026): „urządzenie A realizuje zamówienie, urządzenie B
 * nadal widzi je jako rozpoczęte — w produkcji to niedopuszczalne".
 *
 * Przyczyna: lista zamówień pojazdu żyła w `localStorage` TEGO urządzenia,
 * a serwer dociągano wyłącznie jako SUMĘ (dopisz brakujące, nigdy nie
 * odejmuj). Zamówienie zamknięte na A nie miało jak zniknąć z ekranu B.
 *
 * Te testy udają JEDEN serwer i DWA urządzenia, które z nim rozmawiają —
 * inaczej „synchronizacja" byłaby sprawdzana na jednym ekranie i niczego
 * by nie dowodziła.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/** Udawany serwer — wspólny dla obu „urządzeń". */
const serwer = vi.hoisted(() => ({
  naAucie: [] as Array<{ id: string; orderNo: string; palety: Array<{ nr: number; zaladowana: boolean }> }>,
  aktywne: [] as Array<{ id: string; order_no: string; client_name: string }>,
  offline: false,
  /** Jak backend odpowie na najbliższy skan. */
  wynikSkanu: 'SUCCESS' as string,
  /** Ostrzeżenie „poza kolejnością" doklejane przez backend do udanego skanu. */
  pozaKolejnoscia: null as any,
}))

function migawka() {
  if (serwer.offline) return Promise.reject(new TypeError('Failed to fetch'))
  const orders = serwer.naAucie.map((o, i) => {
    const zaladowane = o.palety.filter((p) => p.zaladowana).length
    return {
      id: o.id, orderNo: o.orderNo, clientName: 'DEM`S', deliveryDate: null,
      orderStatus: 'confirmed', position: i,
      pallets: o.palety.map((p) => ({
        id: `${o.id}-${p.nr}`, palletNo: p.nr,
        status: p.zaladowana ? 'loaded' : 'created',
        totalQty: 4, totalKg: 100, items: [], onThisVehicle: p.zaladowana,
      })),
      totals: {
        totalPallets: o.palety.length, loadedPallets: zaladowane,
        coldPallets: 0, createdPallets: o.palety.length - zaladowane,
        shippedPallets: 0, totalKg: o.palety.length * 100, loadedKg: zaladowane * 100,
      },
    }
  })
  return Promise.resolve({
    vehicle: { id: 'v1', name: 'SOLÓWKA', plate: 'KR 1', kind: 'own' },
    orders,
    totals: {
      totalPallets: orders.reduce((s, o) => s + o.totals.totalPallets, 0),
      loadedPallets: orders.reduce((s, o) => s + o.totals.loadedPallets, 0),
      shippedPallets: 0,
      totalKg: orders.reduce((s, o) => s + o.totals.totalKg, 0),
      loadedKg: orders.reduce((s, o) => s + o.totals.loadedKg, 0),
    },
  })
}

vi.mock('@/lib/api', async () => {
  const rzeczywiste = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    errCode: rzeczywiste.errCode,
    isOfflineError: rzeczywiste.isOfflineError,
    palletScanApi: {
      activeLoading: () => Promise.resolve(serwer.aktywne),
      scan: (_code: string, action: string) => {
        if (serwer.offline) return Promise.reject(new TypeError('Failed to fetch'))
        if (action === 'loaded' && serwer.wynikSkanu !== 'SUCCESS') {
          const e: any = new Error('odmowa')
          e.code = serwer.wynikSkanu
          return Promise.reject(e)
        }
        // Serwer odnotowuje skan — kolejna migawka go pokaże.
        const zam = serwer.naAucie[0]
        if (zam) { const p = zam.palety.find((x) => !x.zaladowana); if (p) p.zaladowana = true }
        return Promise.resolve({
          palletNo: 1, totalKg: 100, result: 'SUCCESS',
          order: { id: zam?.id ?? '', orderNo: zam?.orderNo ?? '' },
          pozaKolejnoscia: serwer.pozaKolejnoscia,
        })
      },
      finalizeLoading: () => {
        serwer.naAucie = []            // `release_orders` po stronie bazy
        return Promise.resolve({ orders: [{ wz_number: 'WZ/9/09/26' }] })
      },
      loadingDocument: () => Promise.resolve({ vehicle: {}, orders: [] }),
    },
    vehicleLoadingApi: {
      state: () => migawka(),
      addOrder: (_v: string, id: string) => {
        const a = serwer.aktywne.find((x) => x.id === id)
        serwer.naAucie.push({ id, orderNo: a?.order_no ?? id, palety: [{ nr: 1, zaladowana: false }] })
        return migawka()
      },
      removeOrder: (_v: string, id: string) => {
        serwer.naAucie = serwer.naAucie.filter((o) => o.id !== id)
        return migawka()
      },
      reorder: () => migawka(),
      clear: () => { serwer.naAucie = []; return migawka() },
    },
  }
})
vi.mock('@/lib/clientNames', () => ({ useClientNames: () => (n: string) => n }))
vi.mock('@/lib/print', () => ({ drukuj: vi.fn() }))

import { MobileZaladunekPage } from './MobileZaladunekPage'
import { POLL_MS } from '@/features/loading/useVehicleLoading'

function urzadzenie() {
  return render(
    <MemoryRouter initialEntries={['/mobile/zaladunek/v1']}>
      <Routes>
        <Route path="/mobile/zaladunek/:vehicleId" element={<MobileZaladunekPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Przepuść jeden cykl odpytywania serwera. */
async function tik() {
  await act(async () => {
    vi.advanceTimersByTime(POLL_MS + 10)
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  serwer.naAucie = []
  serwer.offline = false
  serwer.wynikSkanu = 'SUCCESS'
  serwer.pozaKolejnoscia = null
  serwer.aktywne = [{ id: 'o1', order_no: 'DEM-S/Z/1/09/26', client_name: 'DEM`S' }]
  try { localStorage.clear() } catch {}
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  try { localStorage.clear() } catch {}
})

describe('Załadunek — wspólny stan wielu urządzeń', () => {
  it('TEST 2: co zeskanuje A, B widzi po odświeżeniu', async () => {
    // A już dopisało zamówienie i zeskanowało paletę.
    serwer.naAucie = [{ id: 'o1', orderNo: 'DEM-S/Z/1/09/26', palety: [{ nr: 1, zaladowana: true }] }]

    urzadzenie()   // to jest urządzenie B — nie ma u siebie NIC

    expect(await screen.findByText(/DEM-S\/Z\/1\/09\/26/, {}, { timeout: 3000 })).toBeTruthy()
    await waitFor(() => expect(screen.getByText('ZAŁADOWANE')).toBeTruthy())
  })

  it('TEST 4 + 6: gdy A kończy załadunek, zamówienie znika z ekranu B', async () => {
    serwer.naAucie = [{ id: 'o1', orderNo: 'DEM-S/Z/1/09/26', palety: [{ nr: 1, zaladowana: true }] }]
    urzadzenie()
    expect(await screen.findByText(/DEM-S\/Z\/1\/09\/26/, {}, { timeout: 3000 })).toBeTruthy()

    // Urządzenie A kończy załadunek — po stronie SERWERA.
    serwer.naAucie = []
    serwer.aktywne = []

    await tik()

    await waitFor(() => expect(screen.queryByText(/DEM-S\/Z\/1\/09\/26/)).toBeNull())
  })

  it('TEST 7: odświeżenie strony nie tworzy lokalnego stanu — nic nie ma w localStorage', async () => {
    serwer.naAucie = [{ id: 'o1', orderNo: 'DEM-S/Z/1/09/26', palety: [{ nr: 1, zaladowana: true }] }]
    urzadzenie()
    await screen.findByText(/DEM-S\/Z\/1\/09\/26/, {}, { timeout: 3000 })

    const klucze = Object.keys(localStorage)
    expect(klucze.filter((k) => k.includes('zaladunek'))).toEqual([])
  })

  it('TEST 3: druga próba tej samej palety mówi wprost, że już jest', async () => {
    serwer.naAucie = [{ id: 'o1', orderNo: 'DEM-S/Z/1/09/26', palety: [{ nr: 1, zaladowana: true }] }]
    urzadzenie()
    await screen.findByText(/DEM-S\/Z\/1\/09\/26/, {}, { timeout: 3000 })
    serwer.wynikSkanu = 'ALREADY_SCANNED'

    const pole = screen.getByPlaceholderText(/Skanuj QR palety/i)
    fireEvent.change(pole, { target: { value: 'PAL|o1|1' } })
    fireEvent.submit(pole.closest('form')!)

    expect(await screen.findByText('PALETA JUŻ ZESKANOWANA', {}, { timeout: 3000 })).toBeTruthy()
  })

  it('paleta z obcego zamówienia dostaje jednoznaczny komunikat', async () => {
    serwer.naAucie = [{ id: 'o1', orderNo: 'DEM-S/Z/1/09/26', palety: [{ nr: 1, zaladowana: false }] }]
    urzadzenie()
    await screen.findByText(/DEM-S\/Z\/1\/09\/26/, {}, { timeout: 3000 })
    serwer.wynikSkanu = 'WRONG_ORDER'

    const pole = screen.getByPlaceholderText(/Skanuj QR palety/i)
    fireEvent.change(pole, { target: { value: 'PAL|o9|1' } })
    fireEvent.submit(pole.closest('form')!)

    expect(await screen.findByText('PALETA NIE NALEŻY DO TEGO ZAMÓWIENIA', {}, { timeout: 3000 })).toBeTruthy()
  })

  it('skan poza kolejnością OSTRZEGA na żółto, ale paleta wchodzi', async () => {
    // Hala (21.09.2026): „ustawiam POLAT → POTRM → NAZAR — czy system blokuje
    // załadowanie NAZARA między POLAT-em?". Nie blokuje i nie ma blokować;
    // ma to POWIEDZIEĆ, póki magazynier może skan cofnąć.
    serwer.naAucie = [{ id: 'o1', orderNo: 'DEM-S/Z/1/09/26', palety: [{ nr: 1, zaladowana: false }] }]
    serwer.pozaKolejnoscia = {
      pozycja: 3,
      czeka: { orderNo: 'POLAT/Z/1/09/26', clientName: 'POLAT', pozycja: 1, loaded: 4, total: 9 },
    }
    urzadzenie()
    await screen.findByText(/DEM-S\/Z\/1\/09\/26/, {}, { timeout: 3000 })

    const pole = screen.getByPlaceholderText(/Skanuj QR palety/i)
    fireEvent.change(pole, { target: { value: 'PAL|o1|1' } })
    fireEvent.submit(pole.closest('form')!)

    const komunikat = await screen.findByRole('status', {}, { timeout: 3000 })
    expect(komunikat.getAttribute('data-ton')).toBe('uwaga')
    expect(komunikat.textContent).toContain('POZA KOLEJNOŚCIĄ')
    expect(komunikat.textContent).toContain('POLAT')
    expect(komunikat.textContent).toContain('4 z 9')
  })

  it('zwykły skan po kolei zostaje ZIELONY', async () => {
    serwer.naAucie = [{ id: 'o1', orderNo: 'DEM-S/Z/1/09/26', palety: [{ nr: 1, zaladowana: false }] }]
    urzadzenie()
    await screen.findByText(/DEM-S\/Z\/1\/09\/26/, {}, { timeout: 3000 })

    const pole = screen.getByPlaceholderText(/Skanuj QR palety/i)
    fireEvent.change(pole, { target: { value: 'PAL|o1|1' } })
    fireEvent.submit(pole.closest('form')!)

    const komunikat = await screen.findByRole('status', {}, { timeout: 3000 })
    expect(komunikat.getAttribute('data-ton')).toBe('ok')
  })

  it('TEST 9: utrata połączenia jest widoczna, a ekran zachowuje ostatni stan', async () => {
    serwer.naAucie = [{ id: 'o1', orderNo: 'DEM-S/Z/1/09/26', palety: [{ nr: 1, zaladowana: true }] }]
    urzadzenie()
    await screen.findByText(/DEM-S\/Z\/1\/09\/26/, {}, { timeout: 3000 })

    serwer.offline = true
    await tik()

    await waitFor(() =>
      expect(screen.getByText(/BRAK POŁĄCZENIA — DANE MOGĄ BYĆ NIEAKTUALNE/)).toBeTruthy())
    // Ostatnia znana migawka zostaje — magazynier ma widzieć, co ma na aucie.
    expect(screen.queryByText(/DEM-S\/Z\/1\/09\/26/)).toBeTruthy()
  })

  it('TEST 10: po odzyskaniu połączenia ekran bierze stan z serwera', async () => {
    serwer.naAucie = [{ id: 'o1', orderNo: 'DEM-S/Z/1/09/26', palety: [{ nr: 1, zaladowana: true }] }]
    urzadzenie()
    await screen.findByText(/DEM-S\/Z\/1\/09\/26/, {}, { timeout: 3000 })
    serwer.offline = true
    await tik()
    await waitFor(() => expect(screen.getByText(/BRAK POŁĄCZENIA/)).toBeTruthy())

    // Sieć wraca, a w międzyczasie ktoś zamknął załadunek.
    serwer.offline = false
    serwer.naAucie = []
    await tik()

    await waitFor(() => expect(screen.queryByText(/BRAK POŁĄCZENIA/)).toBeNull())
    await waitFor(() => expect(screen.queryByText(/DEM-S\/Z\/1\/09\/26/)).toBeNull())
  })

  it('offline NIE potwierdza skanu jako zaliczonego', async () => {
    serwer.naAucie = [{ id: 'o1', orderNo: 'DEM-S/Z/1/09/26', palety: [{ nr: 1, zaladowana: false }] }]
    urzadzenie()
    await screen.findByText(/DEM-S\/Z\/1\/09\/26/, {}, { timeout: 3000 })
    serwer.offline = true

    const pole = screen.getByPlaceholderText(/Skanuj QR palety/i)
    fireEvent.change(pole, { target: { value: 'PAL|o1|1' } })
    fireEvent.submit(pole.closest('form')!)

    expect(await screen.findByText(/BRAK POŁĄCZENIA — SPRÓBUJ PONOWNIE/, {}, { timeout: 3000 })).toBeTruthy()
    expect(screen.queryByText('PALETA ZESKANOWANA')).toBeNull()
  })
})
