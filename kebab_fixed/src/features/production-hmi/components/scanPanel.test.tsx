// @vitest-environment jsdom
/**
 * Skanowanie gotowych kebabów na stanowisku produkcyjnym.
 *
 * Skaner na hali to „klawiatura": wystukuje kod i (czasem) wciska Enter.
 * Panel musi łapać to bez dotykania ekranu, bo operator ma zajęte ręce —
 * i po każdym skanie sam wracać do gotowości na następny.
 *
 * Jedna droga (01.10.2026): okno skanuje WYŁĄCZNIE pozycję wybraną na liście
 * planu. Nie ma w nim drugiej listy pozycji ani „Zmień pozycję". Sztuka
 * z innej pozycji odbija się na serwerze i NIE jest nazywana duplikatem.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

vi.mock('@/features/pwa/beep', () => ({ beepOk: vi.fn(), beepErr: vi.fn() }))

import { ScanPanel } from './ScanPanel'
import type { PlanLineView } from './PlanList'
import { beepErr, beepOk } from '@/features/pwa/beep'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const linia: PlanLineView = {
  id: 'l1', qty: 20, kgPerUnit: 40, totalKg: 800, recipeName: 'WROCŁAW',
  packagingName: 'METAL 65', clientName: 'Bulli sp. z o.o.', qtyDone: 12,
}

const wynik = (over: any = {}) => ({
  ok: true, unitId: 'u1', status: 'produced', clientName: 'Bulli sp. z o.o.',
  batchNo: '250826 344', weightKg: 35, done: 5, total: 20, onStock: true, planLineId: 'l1', ...over,
})

const naPozycji = (onScan: any, over: any = {}) =>
  render(<ScanPanel line={linia} lp={3} scan={{ total: 20, scanned: 4 }}
    onScan={onScan} onClose={() => {}} {...over} />)

const skanuj = (kod: string) => {
  const pole = screen.getByTestId('pole-skanu') as HTMLInputElement
  fireEvent.change(pole, { target: { value: kod } })
  fireEvent.submit(pole.closest('form')!)
}

describe('ScanPanel — jedna pozycja, jedna droga', () => {
  it('od razu pole czytnika z jednoznacznym kontekstem pozycji', () => {
    naPozycji(vi.fn())
    expect(screen.getByTestId('pole-skanu')).toBeTruthy()
    const ctx = screen.getByTestId('wybrana-pozycja').textContent ?? ''
    expect(ctx).toContain('20 × 40 kg')
    expect(ctx).toContain('WROCŁAW')
    expect(ctx).toContain('Bulli')
    expect(screen.getByTestId('postep-pozycji').textContent).toBe('4 / 20')
  })

  it('NIE ma drugiej listy pozycji ani „Zmień pozycję"', () => {
    naPozycji(vi.fn())
    expect(screen.queryByTestId('zmien-pozycje')).toBeNull()
    expect(screen.queryByTestId(/^pozycja-/)).toBeNull()
    expect(screen.queryByText(/Wybierz pozycję/i)).toBeNull()
  })

  it('jest dialogiem; Escape i „Wróć do planu" zamykają, gdy nic nie czeka', () => {
    const onClose = vi.fn()
    naPozycji(vi.fn(), { onClose })
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('zamknij-skan'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('ScanPanel — skan wybranej pozycji', () => {
  it('skan z czytnika idzie na serwer WRAZ z pozycją', async () => {
    const onScan = vi.fn().mockResolvedValue(wynik())
    naPozycji(onScan)
    skanuj('KEBAB-u1')
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('KEBAB-u1', 'l1'))
  })

  it('po udanym skanie mówi, co weszło na magazyn, i piszczy', async () => {
    naPozycji(vi.fn().mockResolvedValue(wynik({ done: 5 })))
    skanuj('KEBAB-u1')
    expect(await screen.findByText(/Na magazynie/i)).toBeTruthy()
    expect(screen.getByTestId('ostatni-skan').textContent).toMatch(/250826 344/)
    expect(screen.getByTestId('ostatni-skan').textContent).toMatch(/35 kg/)
    expect(screen.getByTestId('postep-pozycji').textContent).toBe('5 / 20')
    expect(beepOk).toHaveBeenCalled()
  })

  it('pole czyści się po każdym skanie — następny kod nie doklei się do poprzedniego', async () => {
    naPozycji(vi.fn().mockResolvedValue(wynik()))
    skanuj('KEBAB-u1')
    await waitFor(() => expect((screen.getByTestId('pole-skanu') as HTMLInputElement).value).toBe(''))
  })

  it('dubel mówi wprost, że ta sztuka już jest', async () => {
    naPozycji(vi.fn().mockRejectedValue(Object.assign(new Error('409: duplikat'), { status: 409 })))
    skanuj('KEBAB-u1')
    expect(await screen.findByText(/już zeskanowana/i)).toBeTruthy()
    expect(beepErr).toHaveBeenCalled()
  })

  // Serwer wie, do której pozycji sztuka należy — to NIE jest duplikat.
  it('sztuka z innej pozycji odbija się z jej nazwą, bez słowa „duplikat"', async () => {
    naPozycji(vi.fn().mockRejectedValue(
      Object.assign(new Error('Ta sztuka jest z pozycji 2 (KIRMIZI)'), { status: 409 })))
    skanuj('KEBAB-u9')
    expect(await screen.findByText(/z pozycji 2 \(KIRMIZI\)/)).toBeTruthy()
    expect(screen.getByText(/innej pozycji/i)).toBeTruthy()
    expect(screen.queryByText(/już zeskanowana/i)).toBeNull()
  })

  it('błąd łączności pokazuje treść, a nie ciche nic', async () => {
    naPozycji(vi.fn().mockRejectedValue(new Error('brak łączności')))
    skanuj('KEBAB-u1')
    expect(await screen.findByText(/brak łączności/i)).toBeTruthy()
  })

  it('liczy sztuki zeskanowane w tej sesji', async () => {
    const onScan = vi.fn()
      .mockResolvedValueOnce(wynik({ done: 5 }))
      .mockResolvedValueOnce(wynik({ unitId: 'u2', done: 6 }))
    naPozycji(onScan)
    skanuj('KEBAB-u1')
    await waitFor(() => expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('1'))
    skanuj('KEBAB-u2')
    await waitFor(() => expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('2'))
  })

  it('nieudany skan NIE podbija licznika sesji', async () => {
    naPozycji(vi.fn().mockRejectedValue(new Error('brak łączności')))
    skanuj('KEBAB-u1')
    await screen.findByText(/brak łączności/i)
    expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('0')
  })

  it('pusty kod nie leci na serwer', () => {
    const onScan = vi.fn()
    naPozycji(onScan)
    skanuj('   ')
    expect(onScan).not.toHaveBeenCalled()
  })

  // Potwierdzenie liczone do PLANU pozycji (jak `isConfirmed`), nie do liczby
  // wydrukowanych etykiet.
  it('komplet skanów do planu pozycji melduje potwierdzenie', async () => {
    naPozycji(vi.fn().mockResolvedValue(wynik({ done: 20, total: 20 })))
    skanuj('KEBAB-u1')
    expect(await screen.findByText(/Pozycja potwierdzona/i)).toBeTruthy()
  })

  it('komplet ETYKIET mniejszy niż plan to jeszcze nie potwierdzenie', async () => {
    naPozycji(vi.fn().mockResolvedValue(wynik({ done: 12, total: 12 })))
    skanuj('KEBAB-u1')
    expect(await screen.findByText(/Na magazynie/i)).toBeTruthy()
    expect(screen.queryByText(/Pozycja potwierdzona/i)).toBeNull()
  })
})

// Hala 25.09.2026: „trzeba klikać Enter, tylko kod się pojawia".
describe('ScanPanel — auto-zatwierdzanie bez Entera', () => {
  it('kompletny kod sztuki wysyła się sam', async () => {
    const onScan = vi.fn().mockResolvedValue(wynik())
    naPozycji(onScan)
    const pole = screen.getByTestId('pole-skanu') as HTMLInputElement
    fireEvent.change(pole, { target: { value: 'U|ac82b8f61e2545a4867b' } })
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('U|ac82b8f61e2545a4867b', 'l1'))
    await waitFor(() => expect(pole.value).toBe(''))
  })

  it('kod z przekręconym separatorem też się wysyła — decyduje serwer', async () => {
    const onScan = vi.fn().mockResolvedValue(wynik())
    naPozycji(onScan)
    fireEvent.change(screen.getByTestId('pole-skanu'), { target: { value: 'U<ac82b8f61e2545a4867b' } })
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(1))
  })

  it('Enter po auto-wysyłce NIE wysyła drugi raz', async () => {
    const onScan = vi.fn().mockResolvedValue(wynik())
    naPozycji(onScan)
    const pole = screen.getByTestId('pole-skanu') as HTMLInputElement
    fireEvent.change(pole, { target: { value: 'U|ac82b8f61e2545a4867b' } })
    fireEvent.submit(pole.closest('form')!)
    await new Promise(r => setTimeout(r, 300))
    expect(onScan).toHaveBeenCalledTimes(1)
  })
})

describe('ScanPanel — szybki wózek', () => {
  it('skan w trakcie poprzedniego NIE ginie — czeka w kolejce, z tą samą pozycją', async () => {
    let puść: (v: any) => void = () => {}
    const onScan = vi.fn()
      .mockImplementationOnce(() => new Promise(r => { puść = r }))
      .mockResolvedValue(wynik())
    naPozycji(onScan)
    skanuj('U|aaaaaaaaaaaaaaaaaaaa')
    skanuj('U|bbbbbbbbbbbbbbbbbbbb')
    expect(onScan).toHaveBeenCalledTimes(1)
    puść(wynik())
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2))
    expect(onScan.mock.calls[1]).toEqual(['U|bbbbbbbbbbbbbbbbbbbb', 'l1'])
  })

  // Wyjście z niezapisaną kolejką = skan „w powietrzu", a operator myśli,
  // że wszedł. Okno czeka, aż kolejka się rozliczy.
  it('nie da się zamknąć okna, dopóki kolejka nie jest rozliczona', async () => {
    let puść: (v: any) => void = () => {}
    const onClose = vi.fn()
    const onScan = vi.fn().mockImplementationOnce(() => new Promise(r => { puść = r }))
    naPozycji(onScan, { onClose })
    skanuj('U|aaaaaaaaaaaaaaaaaaaa')
    const zamknij = screen.getByTestId('zamknij-skan') as HTMLButtonElement
    expect(zamknij.disabled).toBe(true)
    expect(screen.getByTestId('kolejka-skanow').textContent).toMatch(/zapisuję 1/)
    fireEvent.click(zamknij)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    puść(wynik())
    await waitFor(() => expect(zamknij.disabled).toBe(false))
    fireEvent.click(zamknij)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // Odświeżenie planu w trakcie kolejki podmienia dane pozycji — skany mają
  // iść tam, gdzie zostały przyjęte, nie „gdzie teraz wskazuje props".
  it('zmiana propsów w trakcie kolejki nie przepisuje skanów na inną pozycję', async () => {
    let puść: (v: any) => void = () => {}
    const onScan = vi.fn()
      .mockImplementationOnce(() => new Promise(r => { puść = r }))
      .mockResolvedValue(wynik())
    const { rerender } = naPozycji(onScan)
    skanuj('U|aaaaaaaaaaaaaaaaaaaa')
    skanuj('U|bbbbbbbbbbbbbbbbbbbb')
    rerender(<ScanPanel line={{ ...linia, id: 'l2', recipeName: 'KIRMIZI' }} lp={4}
      onScan={onScan} onClose={() => {}} />)
    puść(wynik())
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2))
    expect(onScan.mock.calls.map(c => c[1])).toEqual(['l1', 'l1'])
  })
})

// Prawdziwy entry kiosku (`produkcja.tsx`) ma React.StrictMode: efekty
// przechodzą setup → cleanup → setup. Flaga „zamontowany" ustawiana tylko
// w inicjalizacji refa zostawała wtedy na `false` — wynik nie przychodził,
// a „Czekaj — zapisuję" wisiało na zawsze.
describe('ScanPanel — React.StrictMode', () => {
  const wStrict = (onScan: any, onClose = vi.fn()) => {
    render(
      <StrictMode>
        <button type="button">pod spodem</button>
        <ScanPanel line={linia} lp={3} scan={{ total: 20, scanned: 4 }} onScan={onScan} onClose={onClose} />
      </StrictMode>,
    )
    return onClose
  }

  it('udany skan pokazuje wynik, piszczy i zdejmuje „zapisuję"', async () => {
    const onClose = wStrict(vi.fn().mockResolvedValue(wynik()))
    skanuj('U|aaaaaaaaaaaaaaaaaaaa')
    expect(await screen.findByText('Na magazynie')).toBeTruthy()
    expect(beepOk).toHaveBeenCalledTimes(1)
    await waitFor(() => expect((screen.getByTestId('zamknij-skan') as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('1')
    fireEvent.click(screen.getByTestId('zamknij-skan'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('błędny skan mówi to i pozwala wrócić', async () => {
    const onClose = wStrict(vi.fn().mockRejectedValue(new Error('brak łączności')))
    skanuj('U|aaaaaaaaaaaaaaaaaaaa')
    expect(await screen.findByText('Nie weszła')).toBeTruthy()
    expect(beepErr).toHaveBeenCalledTimes(1)
    await waitFor(() => expect((screen.getByTestId('zamknij-skan') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByTestId('zamknij-skan'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('kolejka dwóch skanów rozlicza się do końca i odblokowuje powrót', async () => {
    let puść: (v: any) => void = () => {}
    const onScan = vi.fn()
      .mockImplementationOnce(() => new Promise(r => { puść = r }))
      .mockResolvedValue(wynik({ done: 6 }))
    wStrict(onScan)
    skanuj('U|aaaaaaaaaaaaaaaaaaaa')
    skanuj('U|bbbbbbbbbbbbbbbbbbbb')
    expect(screen.getByTestId('kolejka-skanow').textContent).toMatch(/zapisuję 2/)
    puść(wynik())
    await waitFor(() => expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('2'))
    await waitFor(() => expect(screen.queryByTestId('kolejka-skanow')).toBeNull())
    expect((screen.getByTestId('zamknij-skan') as HTMLButtonElement).disabled).toBe(false)
  })

  it('po wyniku pole czytnika wraca do fokusu', async () => {
    wStrict(vi.fn().mockResolvedValue(wynik()))
    const pole = screen.getByTestId('pole-skanu')
    skanuj('U|aaaaaaaaaaaaaaaaaaaa')
    ;(pole as HTMLInputElement).blur()
    expect(document.activeElement).not.toBe(pole)
    await screen.findByText('Na magazynie')
    await waitFor(() => expect(document.activeElement).toBe(pole))
  })
})

describe('ScanPanel — fokus zamknięty w oknie', () => {
  it('Tab z ostatniego przycisku wraca do pola, nie wychodzi pod spód', () => {
    render(<>
      <button type="button" data-testid="pod-spodem">plan</button>
      <ScanPanel line={linia} lp={3} onScan={vi.fn()} onClose={() => {}} />
    </>)
    const pole = screen.getByTestId('pole-skanu')
    expect(document.activeElement).toBe(pole)
    screen.getByTestId('zamknij-skan').focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(pole)
    fireEvent.keyDown(pole, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByTestId('zamknij-skan'))
  })

  it('fokus, który uciekł pod spód, wraca do okna', () => {
    render(<>
      <button type="button" data-testid="pod-spodem">plan</button>
      <ScanPanel line={linia} lp={3} onScan={vi.fn()} onClose={() => {}} />
    </>)
    screen.getByTestId('pod-spodem').focus()
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('po zamknięciu fokus wraca tam, skąd operator przyszedł', () => {
    const Ramka = ({ otwarte }: { otwarte: boolean }) => <>
      <button type="button" data-testid="skanuj">Skanuj</button>
      {otwarte && <ScanPanel line={linia} lp={3} onScan={vi.fn()} onClose={() => {}} />}
    </>
    const { rerender } = render(<Ramka otwarte={false} />)
    screen.getByTestId('skanuj').focus()
    rerender(<Ramka otwarte />)
    expect(document.activeElement).toBe(screen.getByTestId('pole-skanu'))
    rerender(<Ramka otwarte={false} />)
    expect(document.activeElement).toBe(screen.getByTestId('skanuj'))
  })

  it('kod czekający na auto-wysyłkę NIE idzie po zamknięciu okna', async () => {
    vi.useFakeTimers()
    try {
      const onScan = vi.fn().mockResolvedValue(wynik())
      const { unmount } = render(<ScanPanel line={linia} lp={3} onScan={onScan} onClose={() => {}} />)
      fireEvent.change(screen.getByTestId('pole-skanu'), { target: { value: 'U|aaaaaaaaaaaaaaaaaaaa' } })
      unmount()
      await act(async () => { vi.advanceTimersByTime(5000) })
      expect(onScan).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
