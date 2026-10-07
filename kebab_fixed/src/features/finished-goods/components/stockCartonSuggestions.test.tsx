// @vitest-environment jsdom
/**
 * Sekcja „Kartony z magazynu" w rozwinięciu zamówienia — przegląd
 * (dostępne / przypisane / niedostępne), przypisanie i odłączenie kartonu.
 *
 * Sekcja ma być zawsze widoczna, a pusty wynik, błąd pobrania (GET), błąd
 * przypisania i błąd odłączenia mają być od siebie odróżnialne. Po przypisaniu
 * ostatniego kartonu karton ma trafić na listę przypisanych — nie zniknąć.
 *
 * Montujemy z PRAWDZIWYM useApi, mockujemy tylko warstwę API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

const api = vi.hoisted(() => ({
  stockCartonOptions: vi.fn(),
  stockCartonSuggestions: vi.fn(),
  assignStockCarton: vi.fn(),
  detachStockCarton: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ clientOrdersApi: api }))

import { StockCartonSuggestions } from './StockCartonSuggestions'

function karton(id: string, no: number, extra: Record<string, unknown> = {}) {
  return {
    cartonId: id, cartonNo: no, clientName: '', generic: true, status: 'packed',
    inColdStorage: true, loaded: false, shipped: false,
    packedQty: 4, targetQty: 4, units: 4, batches: ['P-77'],
    lines: [{ recipeName: 'KIRMIZI', productTypeName: 'KEBAB UDO 100%', packagingName: 'TULEJA 30', kgPerUnit: 20, packedQty: 4, targetQty: 4 }],
    reason: null, canDetach: false, detachBlockedReason: null,
    ...extra,
  }
}

function overview(p: { available?: any[]; assigned?: any[]; unavailable?: any[]; blocked?: string | null; status?: string } = {}) {
  const assigned = p.assigned ?? []
  return {
    orderId: 'o1', orderNo: 'ZAM/1', orderStatus: p.status ?? 'confirmed',
    assignBlockedReason: p.blocked ?? null,
    available: p.available ?? [], assigned, unavailable: p.unavailable ?? [],
    assignedTotals: { cartons: assigned.length, units: assigned.reduce((s, c) => s + c.units, 0) },
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const assignBtns = () => screen.queryAllByRole('button', { name: /Przypisz do tego zamówienia/ }) as HTMLButtonElement[]
const assignedSection = () => screen.getByRole('region', { name: 'Przypisane kartony' })

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset())
})
afterEach(cleanup)

describe('StockCartonSuggestions', () => {
  it('pokazuje sekcję i stan ładowania; woła nowy przegląd, nie stare sugestie', async () => {
    const d = deferred<any>()
    api.stockCartonOptions.mockReturnValue(d.promise)
    render(<StockCartonSuggestions orderId="o1" orderStatus="confirmed" />)
    expect(screen.getByText(/Kartony z magazynu/)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/Szukam kartonów/)
    d.resolve(overview())
    await screen.findByText(/nie znalazł pasujących/)
    expect(api.stockCartonOptions).toHaveBeenCalledWith('o1')
    expect(api.stockCartonSuggestions).not.toHaveBeenCalled()
  })

  it('pusty wynik: sekcja widoczna, „Przypisano: 0”, wyjaśnienie, brak przycisków', async () => {
    api.stockCartonOptions.mockResolvedValue(overview())
    render(<StockCartonSuggestions orderId="o1" orderStatus="confirmed" />)
    await screen.findByText(/nie znalazł pasujących/)
    expect(screen.getByTestId('assigned-totals').textContent).toMatch(/Przypisano: 0 kartonów \/ 0 szt\./)
    expect(document.body.textContent).toMatch(/nie oznacza, że towaru nie ma na magazynie/)
    expect(assignBtns()).toHaveLength(0)
  })

  it('błąd GET jest widoczny (to nie pusta lista) i ponowienie działa', async () => {
    api.stockCartonOptions
      .mockRejectedValueOnce(new Error('Serwer nie odpowiada'))
      .mockResolvedValueOnce(overview({ available: [karton('c1', 101)] }))
    render(<StockCartonSuggestions orderId="o1" orderStatus="confirmed" />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Nie udało się pobrać listy kartonów/)
    expect(alert.textContent).toMatch(/Serwer nie odpowiada/)
    expect(screen.queryByText(/nie znalazł pasujących/)).toBeNull()
    expect(screen.queryByText(/Przypisano:/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Spróbuj ponownie/ }))
    await screen.findByText(/Karton 000101/)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.stockCartonOptions).toHaveBeenCalledTimes(2)
  })

  it('dostępny karton: numer, skład, sztuki, etykieta „bez klienta”, instrukcja', async () => {
    api.stockCartonOptions.mockResolvedValue(overview({
      available: [karton('c1', 101), karton('c2', 102, { generic: false, clientName: 'DÖNER GMBH', units: 7 })],
    }))
    render(<StockCartonSuggestions orderId="o1" orderStatus="confirmed" />)
    await screen.findByText(/Karton 000101/)
    const tekst = document.body.textContent ?? ''
    expect(tekst).toMatch(/Na magazyn — bez klienta/)
    expect(tekst).toMatch(/DÖNER GMBH/)
    expect(tekst).toMatch(/7 szt\./)
    expect(tekst).toMatch(/4× 20 kg · KEBAB UDO 100% · TULEJA 30/)
    expect(tekst).toMatch(/Partia: P-77/)
    expect(tekst).toMatch(/zachowuje etykietę i partie/)
    expect(tekst).toMatch(/nie twórz dodatkowych palet ani nowych kartonów/)
    expect(assignBtns()).toHaveLength(2)
    expect(api.assignStockCarton).not.toHaveBeenCalled()
  })

  it('przypisanie ostatniego kartonu: POST raz, callback raz, karton na liście przypisanych', async () => {
    const c = karton('c1', 101, { units: 6 })
    api.stockCartonOptions
      .mockResolvedValueOnce(overview({ available: [c] }))
      .mockResolvedValueOnce(overview({ assigned: [{ ...c, canDetach: true }] }))
    api.assignStockCarton.mockResolvedValue({ ok: true })
    const onAssigned = vi.fn()
    render(<StockCartonSuggestions orderId="o1" orderStatus="confirmed" onAssigned={onAssigned} />)
    fireEvent.click((await screen.findAllByRole('button', { name: /Przypisz do tego zamówienia/ }))[0])

    await waitFor(() => expect(screen.getByTestId('assigned-totals').textContent).toMatch(/Przypisano: 1 karton \/ 6 szt\./))
    expect(within(assignedSection()).getByText(/Karton 000101/)).toBeTruthy()
    expect(api.assignStockCarton).toHaveBeenCalledTimes(1)
    expect(api.assignStockCarton).toHaveBeenCalledWith('o1', 'c1')
    expect(onAssigned).toHaveBeenCalledTimes(1)
    expect(api.stockCartonOptions).toHaveBeenCalledTimes(2)
    const sukces = screen.getAllByRole('status').find(el => /Przypisano karton 000101 \(6 szt\.\)/.test(el.textContent ?? ''))
    expect(sukces).toBeTruthy()
  })

  it('odrzucony callback rodzica nie jest błędem przypisania', async () => {
    api.stockCartonOptions
      .mockResolvedValueOnce(overview({ available: [karton('c1', 101)] }))
      .mockResolvedValueOnce(overview({ assigned: [karton('c1', 101)] }))
    api.assignStockCarton.mockResolvedValue({ ok: true })
    const onAssigned = vi.fn().mockRejectedValue(new Error('lista padła'))
    render(<StockCartonSuggestions orderId="o1" orderStatus="confirmed" onAssigned={onAssigned} />)
    fireEvent.click((await screen.findAllByRole('button', { name: /Przypisz do tego zamówienia/ }))[0])
    await screen.findByText(/Przypisano karton 000101/)
    await waitFor(() => expect(api.stockCartonOptions).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('niedostępne: lista z licznikiem i powodem z serwera', async () => {
    api.stockCartonOptions.mockResolvedValue(overview({
      unavailable: [
        karton('c3', 103, { reason: 'karton spakowany częściowo (2/4)' }),
        karton('c4', 104, { reason: 'inna tuleja niż w zamówieniu' }),
      ],
    }))
    render(<StockCartonSuggestions orderId="o1" orderStatus="confirmed" />)
    await screen.findByText(/Kartony niedostępne dla tego zamówienia \(2\)/)
    const tekst = document.body.textContent ?? ''
    expect(tekst).toMatch(/Karton 000103 — karton spakowany częściowo \(2\/4\)/)
    expect(tekst).toMatch(/Karton 000104 — inna tuleja niż w zamówieniu/)
    expect(assignBtns()).toHaveLength(0)
  })

  it('globalna blokada dokumentu: powód widoczny, brak przycisków przypisania', async () => {
    api.stockCartonOptions.mockResolvedValue(overview({
      available: [karton('c1', 101)],
      blocked: 'Do zamówienia wystawiono już WZ/12 — nowe kartony nie mogą zostać przypisane.',
    }))
    render(<StockCartonSuggestions orderId="o1" orderStatus="confirmed" />)
    const blokada = await screen.findByTestId('assign-blocked')
    expect(blokada.textContent).toMatch(/wystawiono już WZ\/12/)
    expect(screen.getByText(/Karton 000101/)).toBeTruthy()
    expect(assignBtns()).toHaveLength(0)
  })

  it('błąd POST zostaje na ekranie i można spróbować ponownie', async () => {
    api.stockCartonOptions.mockResolvedValue(overview({ available: [karton('c1', 101)] }))
    api.assignStockCarton
      .mockRejectedValueOnce(new Error('Karton jest już przypisany'))
      .mockResolvedValueOnce({ ok: true })
    const onAssigned = vi.fn()
    render(<StockCartonSuggestions orderId="o1" orderStatus="confirmed" onAssigned={onAssigned} />)
    fireEvent.click((await screen.findAllByRole('button', { name: /Przypisz do tego zamówienia/ }))[0])

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Nie udało się przypisać kartonu 000101/)
    expect(alert.textContent).toMatch(/Karton jest już przypisany/)
    expect(alert.textContent).not.toMatch(/pobrać listy/)
    expect(onAssigned).not.toHaveBeenCalled()

    const btn = assignBtns()[0]
    await waitFor(() => expect(btn.disabled).toBe(false))
    fireEvent.click(btn)
    await waitFor(() => expect(onAssigned).toHaveBeenCalledTimes(1))
    expect(api.assignStockCarton).toHaveBeenCalledTimes(2)
  })

  it('w trakcie POST wszystkie przyciski są zablokowane, podwójny klik = jeden POST', async () => {
    api.stockCartonOptions.mockResolvedValue(overview({
      available: [karton('c1', 101), karton('c2', 102)],
      assigned: [karton('c9', 109, { canDetach: true })],
    }))
    const post = deferred<any>()
    api.assignStockCarton.mockReturnValue(post.promise)
    render(<StockCartonSuggestions orderId="o1" orderStatus="confirmed" />)
    await screen.findByText(/Karton 000101/)
    const [b1, b2] = assignBtns()

    fireEvent.click(b1)
    fireEvent.click(b1)
    fireEvent.click(b2)
    expect(b1.disabled).toBe(true)
    expect(b2.disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Odłącz od zamówienia/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Odśwież/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.assignStockCarton).toHaveBeenCalledTimes(1)
    expect(api.assignStockCarton).toHaveBeenCalledWith('o1', 'c1')

    post.resolve({ ok: true })
    await screen.findByText(/Przypisano karton 000101/)
  })

  it('błąd GET po udanym POST: komunikat o przypisaniu zostaje, stara lista nie pozwala przypisać', async () => {
    api.stockCartonOptions
      .mockResolvedValueOnce(overview({ available: [karton('c1', 101), karton('c2', 102)] }))
      .mockRejectedValueOnce(new Error('Timeout'))
    api.assignStockCarton.mockResolvedValue({ ok: true })
    const onAssigned = vi.fn()
    render(<StockCartonSuggestions orderId="o1" orderStatus="confirmed" onAssigned={onAssigned} />)
    fireEvent.click((await screen.findAllByRole('button', { name: /Przypisz do tego zamówienia/ }))[0])

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Nie udało się pobrać listy kartonów/)
    expect(alert.textContent).not.toMatch(/przypisać/)
    expect(document.body.textContent).toMatch(/Przypisano karton 000101/)
    expect(onAssigned).toHaveBeenCalledTimes(1)
    expect(assignBtns()).toHaveLength(0)
    expect(screen.queryByText(/Karton 000102/)).toBeNull()
  })

  it('odłączenie: wymaga potwierdzenia; anulowanie nic nie wysyła', async () => {
    api.stockCartonOptions.mockResolvedValue(overview({ assigned: [karton('c1', 101, { canDetach: true })] }))
    render(<StockCartonSuggestions orderId="o1" orderStatus="confirmed" />)
    fireEvent.click(await screen.findByRole('button', { name: /Odłącz od zamówienia/ }))
    const grupa = screen.getByRole('group', { name: 'Potwierdzenie odłączenia' })
    expect(grupa.textContent).toMatch(/Karton i towar zostają na magazynie/)
    fireEvent.click(within(grupa).getByRole('button', { name: 'Anuluj' }))
    expect(screen.queryByRole('group', { name: 'Potwierdzenie odłączenia' })).toBeNull()
    expect(api.detachStockCarton).not.toHaveBeenCalled()
  })

  it('odłączenie potwierdzone: POST raz, odświeżenie, callback, trwały komunikat przy pustych listach', async () => {
    api.stockCartonOptions
      .mockResolvedValueOnce(overview({ assigned: [karton('c1', 101, { canDetach: true })] }))
      .mockResolvedValueOnce(overview())
    api.detachStockCarton.mockResolvedValue({ ok: true })
    const onAssigned = vi.fn()
    render(<StockCartonSuggestions orderId="o1" orderStatus="confirmed" onAssigned={onAssigned} />)
    fireEvent.click(await screen.findByRole('button', { name: /Odłącz od zamówienia/ }))
    const tak = screen.getByRole('button', { name: /Tak, odłącz/ })
    fireEvent.click(tak)
    fireEvent.click(tak)

    await waitFor(() => expect(screen.getByTestId('assigned-totals').textContent).toMatch(/Przypisano: 0/))
    expect(api.detachStockCarton).toHaveBeenCalledTimes(1)
    expect(api.detachStockCarton).toHaveBeenCalledWith('o1', 'c1')
    expect(onAssigned).toHaveBeenCalledTimes(1)
    expect(api.stockCartonOptions).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toMatch(/Odłączono karton 000101 od tego zamówienia/)
  })

  it('błąd odłączenia jest osobny od błędu pobrania; karton zostaje przypisany', async () => {
    api.stockCartonOptions.mockResolvedValue(overview({ assigned: [karton('c1', 101, { canDetach: true })] }))
    api.detachStockCarton.mockRejectedValue(new Error('Karton jest już na aucie'))
    const onAssigned = vi.fn()
    render(<StockCartonSuggestions orderId="o1" orderStatus="confirmed" onAssigned={onAssigned} />)
    fireEvent.click(await screen.findByRole('button', { name: /Odłącz od zamówienia/ }))
    fireEvent.click(screen.getByRole('button', { name: /Tak, odłącz/ }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Nie udało się odłączyć kartonu 000101: Karton jest już na aucie/)
    expect(alert.textContent).not.toMatch(/pobrać listy/)
    expect(within(assignedSection()).getByText(/Karton 000101/)).toBeTruthy()
    expect(onAssigned).not.toHaveBeenCalled()
  })

  it('karton bez prawa odłączenia: powód z serwera zamiast przycisku', async () => {
    api.stockCartonOptions.mockResolvedValue(overview({
      assigned: [karton('c1', 101, { canDetach: false, loaded: true, detachBlockedReason: 'karton jest załadowany na auto' })],
    }))
    render(<StockCartonSuggestions orderId="o1" orderStatus="confirmed" />)
    await screen.findByText(/Nie można odłączyć: karton jest załadowany na auto/)
    expect(screen.queryByRole('button', { name: /Odłącz od zamówienia/ })).toBeNull()
  })

  it('zamówienie zamknięte: pobiera przegląd, pokazuje przypisane, brak jakichkolwiek akcji', async () => {
    api.stockCartonOptions.mockResolvedValue(overview({
      status: 'done',
      available: [karton('c2', 102)],
      assigned: [karton('c1', 101, { canDetach: true, units: 5 })],
      unavailable: [karton('c3', 103, { reason: 'x' })],
    }))
    render(<StockCartonSuggestions orderId="o1" orderStatus="done" />)
    await screen.findByText(/Zamówienie jest zamknięte \(zrealizowane\)/)
    expect(screen.getByTestId('assigned-totals').textContent).toMatch(/Przypisano: 1 karton \/ 5 szt\./)
    expect(within(assignedSection()).getByText(/Karton 000101/)).toBeTruthy()
    expect(assignBtns()).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Odłącz/ })).toBeNull()
    expect(screen.queryByText(/Karton 000102/)).toBeNull()
    expect(api.stockCartonOptions).toHaveBeenCalledWith('o1')

    cleanup()
    api.stockCartonOptions.mockResolvedValue(overview({ status: 'cancelled' }))
    render(<StockCartonSuggestions orderId="o2" orderStatus="cancelled" />)
    await screen.findByText(/Zamówienie jest zamknięte \(anulowane\)/)
    expect(assignBtns()).toHaveLength(0)
  })

  it('nieaktualny status u rodzica: zamknięcie z serwera i tak blokuje akcje', async () => {
    api.stockCartonOptions.mockResolvedValue(overview({
      status: 'done',
      available: [karton('c2', 102)],
      assigned: [karton('c1', 101, { canDetach: true })],
    }))
    render(<StockCartonSuggestions orderId="o1" orderStatus="confirmed" />)
    await screen.findByText(/Zamówienie jest zamknięte \(zrealizowane\)/)
    expect(assignBtns()).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Odłącz/ })).toBeNull()
  })
})
