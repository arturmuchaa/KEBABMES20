// @vitest-environment jsdom
/**
 * Papiery kursu — ekran, na który prowadzi powiadomienie z pulpitu.
 *
 * Biuro (12.09.2026): „magazynier potwierdza załadunek, biuro dostaje
 * informację i drukuje dokumenty — magazynier nie ma drukarki ani uprawnień".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const stan = vi.hoisted(() => ({
  kurs: null as any, oznaczone: [] as string[], wystawione: [] as any[],
}))

vi.mock('@/lib/api', () => ({
  zaladunkiApi: {
    get: () => Promise.resolve(stan.kurs),
    wydrukowano: (id: string) => { stan.oznaczone.push(id); return Promise.resolve({ ok: true }) },
    wystaw: (id: string, orders: any[], cmr: any) => {
      stan.wystawione.push({ id, orders, cmr })
      return Promise.resolve({ ok: true })
    },
  },
  carriersApi: { list: () => Promise.resolve([]) },
}))

import { ZaladunekDrukPage } from './ZaladunekDrukPage'

beforeEach(() => { stan.kurs = null; stan.oznaczone = []; stan.wystawione = [] })
afterEach(cleanup)

function pokaz() {
  render(
    <MemoryRouter initialEntries={['/office/zaladunek/k1/druk']}>
      <Routes><Route path="/office/zaladunek/:id/druk" element={<ZaladunekDrukPage />} /></Routes>
    </MemoryRouter>,
  )
}

const KURS = {
  id: 'k1', plate: 'KRA613FC', finished_at: '2026-09-12T10:00:00Z', printed_at: null,
  pozycje: [{
    order_id: 'o1', order_no: 'YALCIN/Z/4/09/26', client_name: 'YALCIN', wz_status: 'potwierdzony',
    kg_zaladowane: 300, zaladowano: [{ stock_id: 'f1', batch_no: '500', szt: 10 }],
    wz: [{ id: 'wm1', number: 'WM/3/09/26', doc_series: 'WM' },
         { id: 'wz1', number: 'WZ/21/09/26', doc_series: 'WZ' }],
    hdi: [{ id: 'h1', number: '23/09/26', scope: null },
          { id: 'h2', number: '24/09/26', scope: 'fv' }],
    cmr: [{ id: 'c1', number: 'CMR/9/09/26', scope: null },
          { id: 'c2', number: 'CMR/10/09/26', scope: 'fv' }],
  }],
}

describe('papiery kursu', () => {
  it('pokazuje KOMPLET: WM, WZ, oba HDI i oba CMR', async () => {
    stan.kurs = KURS
    pokaz()
    expect(await screen.findByText('YALCIN')).toBeTruthy()
    expect(screen.getByText('WM/3/09/26')).toBeTruthy()
    expect(screen.getByText('WZ/21/09/26')).toBeTruthy()
    expect(screen.getByText('HDI do faktury')).toBeTruthy()
    expect(screen.getByText('CMR na drogę')).toBeTruthy()
    expect(screen.getByText('CMR do faktury')).toBeTruthy()
  })

  it('rozjazd widać ZANIM biuro wydrukuje', async () => {
    stan.kurs = { ...KURS, pozycje: [{ ...KURS.pozycje[0], wz_status: 'rozjazd' }] }
    pokaz()
    expect(await screen.findByText(/rozjazd — sprawdź przed wydrukiem/)).toBeTruthy()
  })

  it('oznaczenie jako wydrukowane zdejmuje kurs z pulpitu', async () => {
    stan.kurs = KURS
    pokaz()
    fireEvent.click(await screen.findByText(/Wydrukowane — zdejmij z pulpitu/))
    await waitFor(() => expect(stan.oznaczone).toEqual(['k1']))
    expect(await screen.findByText(/Oznaczone jako wydrukowane/)).toBeTruthy()
  })

  it('kurs juz wydrukowany nie da sie oznaczyc drugi raz', async () => {
    stan.kurs = { ...KURS, printed_at: '2026-09-12T11:00:00Z' }
    pokaz()
    const przycisk = await screen.findByRole('button')
    expect((przycisk as HTMLButtonElement).disabled).toBe(true)
  })
})


// ── Kurs czekający na BIURO ──────────────────────────────────────────
//
// Skan zapisał, co wyjechało, ale papierów nie wystawił — magazynier nie ma
// drukarki ani uprawnień. Biuro decyduje PER ODBIORCA i dopiero to zdejmuje
// towar ze stanu.
const KURS_DO_WYSTAWIENIA = {
  id: 'k2', plate: 'KRA613FC', finished_at: '2026-09-19T10:00:00Z', printed_at: null,
  pozycje: [{
    order_id: 'o1', order_no: 'YALCIN/Z/4/09/26', client_name: 'YALCIN',
    wz_status: 'do_wystawienia', kg_zaladowane: 300,
    zaladowano: [{ stock_id: 'f1', batch_no: '500', szt: 10 }],
    wz: [], hdi: [], cmr: [],
  }],
}

describe('kurs czekający na wystawienie', () => {
  it('pokazuje, ile FAKTYCZNIE wyjechało', async () => {
    stan.kurs = KURS_DO_WYSTAWIENIA
    pokaz()
    expect(await screen.findByText(/Do wystawienia/)).toBeTruthy()
    expect(screen.getByText(/300/)).toBeTruthy()
  })

  it('domyślnie całość na fakturę — wysyła kilogramy z kursu', async () => {
    stan.kurs = KURS_DO_WYSTAWIENIA
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    pokaz()
    fireEvent.click(await screen.findByTestId('wystaw-komplet'))

    await waitFor(() => expect(stan.wystawione).toHaveLength(1))
    expect(stan.wystawione[0].orders).toEqual([{ order_id: 'o1', cel_kg: 300 }])
  })

  it('podział wysyła kilogramy wpisane przez biuro', async () => {
    stan.kurs = KURS_DO_WYSTAWIENIA
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    pokaz()
    fireEvent.click(await screen.findByTestId('podziel-o1'))
    fireEvent.change(screen.getByTestId('kg-fv-o1'), { target: { value: '180' } })
    fireEvent.click(screen.getByTestId('wystaw-komplet'))

    await waitFor(() => expect(stan.wystawione).toHaveLength(1))
    expect(stan.wystawione[0].orders).toEqual([{ order_id: 'o1', cel_kg: 180 }])
  })

  it('podział bez kilogramów NIE wystawia niczego', async () => {
    stan.kurs = KURS_DO_WYSTAWIENIA
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    pokaz()
    fireEvent.click(await screen.findByTestId('podziel-o1'))
    fireEvent.click(screen.getByTestId('wystaw-komplet'))

    expect(await screen.findByText(/Podaj kilogramy na fakturę/)).toBeTruthy()
    expect(stan.wystawione).toHaveLength(0)
  })

  it('kurs z gotowymi papierami nie prosi o wystawienie', async () => {
    stan.kurs = KURS
    pokaz()
    await screen.findByText('YALCIN')
    expect(screen.queryByTestId('wystaw-komplet')).toBeNull()
  })
})
