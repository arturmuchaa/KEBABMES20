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
    // Brak odpowiedzi serwera: wynik niepewny — NIE „nie weszła" (03.10.2026).
    expect(await screen.findByText('Błąd połączenia — wynik niepewny')).toBeTruthy()
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

  // Kod sztuki ma stałą długość i wychodzi od razu; na ciszę czekają tylko
  // kody zmiennej długości (kartka palety, obcy kod) — i te po zamknięciu
  // okna przepadają.
  it('kod czekający na ciszę NIE idzie po zamknięciu okna', async () => {
    vi.useFakeTimers()
    try {
      const onScan = vi.fn().mockResolvedValue(wynik())
      const { unmount } = render(<ScanPanel line={linia} lp={3} onScan={onScan} onClose={() => {}} />)
      fireEvent.change(screen.getByTestId('pole-skanu'), { target: { value: 'PAL|Zam1|12' } })
      unmount()
      await act(async () => { vi.advanceTimersByTime(5000) })
      expect(onScan).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

/** Znaki po kolei, jak z klawiatury: każdy dopisany do tego, co JEST w polu. */
const wystukaj = (tekst: string) => {
  const pole = screen.getByTestId('pole-skanu') as HTMLInputElement
  for (const ch of tekst) fireEvent.change(pole, { target: { value: pole.value + ch } })
}
const hex = (n: number) => n.toString(16).padStart(20, '0')
const U = (n: number) => `U|${hex(n)}`

// Hala 02.10.2026: dwie szybko zeskanowane etykiety sklejały się w jeden kod.
describe('ScanPanel — seria bez Entera się nie skleja', () => {
  it('dwie i trzy sztuki znak po znaku, bez przerwy — osobne skany, od razu, bez zegara', () => {
    vi.useFakeTimers()
    try {
      const onScan = vi.fn(() => new Promise<any>(() => {}))
      naPozycji(onScan)
      wystukaj(U(1) + U(2) + U(3))
      // Pierwszy poszedł od razu (zero ms zegara), dwa czekają w kolejce.
      expect(onScan).toHaveBeenCalledTimes(1)
      expect(onScan).toHaveBeenCalledWith(U(1), 'l1')
      expect(screen.getByTestId('kolejka-skanow').textContent).toMatch(/zapisuję 3/)
      expect((screen.getByTestId('pole-skanu') as HTMLInputElement).value).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('jedna zmiana pola z dwoma sklejonymi kodami — dwa skany w kolejności', async () => {
    const onScan = vi.fn().mockResolvedValue(wynik())
    naPozycji(onScan)
    fireEvent.change(screen.getByTestId('pole-skanu'), { target: { value: U(1) + U(2) } })
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2))
    expect(onScan.mock.calls.map(c => c[0])).toEqual([U(1), U(2)])
  })

  it('ogon następnego skanu zostaje w polu i dokańcza się', async () => {
    const onScan = vi.fn().mockResolvedValue(wynik())
    naPozycji(onScan)
    const pole = screen.getByTestId('pole-skanu') as HTMLInputElement
    fireEvent.change(pole, { target: { value: U(1) + 'U|0000' } })
    expect(pole.value).toBe('U|0000')
    wystukaj('0000000000000002')
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2))
    expect(onScan.mock.calls[1][0]).toBe(U(2))
    expect(pole.value).toBe('')
  })

  it('500 różnych kodów przy wstrzymanej pierwszej odpowiedzi: jeden zapis naraz, pełne FIFO', async () => {
    let wLocie = 0
    let maks = 0
    let wywolan = 0
    let puść!: () => void
    const wstrzymana = new Promise<void>(r => { puść = r })
    const onScan = vi.fn(async (kod: string) => {
      wLocie++; maks = Math.max(maks, wLocie)
      if (++wywolan === 1) await wstrzymana
      wLocie--
      return wynik({ unitId: kod })
    })
    naPozycji(onScan)
    const oczekiwane = Array.from({ length: 500 }, (_, i) => U(i + 1))
    const pole = screen.getByTestId('pole-skanu') as HTMLInputElement
    // Po 22 znaki na zdarzenie — tak szybko, że pole nie ma kiedy się wyrenderować.
    for (const k of oczekiwane) fireEvent.change(pole, { target: { value: pole.value + k } })
    expect(onScan).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('kolejka-skanow').textContent).toMatch(/zapisuję 500/)
    puść()
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(500), { timeout: 5000 })
    await waitFor(() => expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('500'))
    expect(onScan.mock.calls.map(c => c[0])).toEqual(oczekiwane)
    expect(maks).toBe(1)
  }, 30_000)

  it('Enter, Tab i CRLF po samoczynnie wysłanej sztuce nie robią pustego ani drugiego skanu', async () => {
    const onScan = vi.fn().mockResolvedValue(wynik())
    naPozycji(onScan)
    const pole = screen.getByTestId('pole-skanu') as HTMLInputElement
    wystukaj(U(1))
    fireEvent.keyDown(pole, { key: 'Enter' })
    const tab = fireEvent.keyDown(pole, { key: 'Tab' })
    expect(tab).toBe(false)                              // spóźniony sufiks połknięty — fokus zostaje
    expect(document.activeElement).toBe(pole)
    fireEvent.paste(pole, { clipboardData: { getData: () => '\r\n' } })
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(1))
    await new Promise(r => setTimeout(r, 50))
    expect(onScan).toHaveBeenCalledTimes(1)
  })

  it('Tab jako sufiks kończy kod zmiennej długości od razu', async () => {
    const onScan = vi.fn().mockResolvedValue(wynik())
    naPozycji(onScan)
    const pole = screen.getByTestId('pole-skanu') as HTMLInputElement
    wystukaj('PAL|Zam1|12')
    expect(onScan).not.toHaveBeenCalled()                // „1" nie wyszło przed „12"
    expect(fireEvent.keyDown(pole, { key: 'Tab' })).toBe(false)
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('PAL|Zam1|12', 'l1'))
  })

  it('wklejony tekst z CRLF i Tabem — każdy kod osobno', async () => {
    const onScan = vi.fn().mockResolvedValue(wynik())
    naPozycji(onScan)
    const pole = screen.getByTestId('pole-skanu')
    fireEvent.paste(pole, { clipboardData: { getData: () => `${U(1)}\r\nKEBAB-7\tPAL|Zam1|3\r\n` } })
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(3))
    expect(onScan.mock.calls.map(c => c[0])).toEqual([U(1), 'KEBAB-7', 'PAL|Zam1|3'])
  })

  it('AIM, CapsLock i inny separator — kod idzie od razu, bez prefiksu AIM', async () => {
    const onScan = vi.fn().mockResolvedValue(wynik())
    naPozycji(onScan)
    wystukaj(`]Q1U<${hex(7).toUpperCase()}`)
    await waitFor(() => expect(onScan).toHaveBeenCalledWith(`U<${hex(7).toUpperCase()}`, 'l1'))
  })

  it('powtórny fizyczny skan tej samej sztuki idzie na serwer i wraca jako dubel', async () => {
    const onScan = vi.fn()
      .mockResolvedValueOnce(wynik())
      .mockRejectedValueOnce(Object.assign(new Error('409: duplikat'), { status: 409 }))
    naPozycji(onScan)
    wystukaj(U(1) + U(1))
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/już zeskanowana/i)).toBeTruthy()
    expect((screen.getByTestId('pole-skanu') as HTMLInputElement).value).toBe('')
  })
})

describe('ScanPanel — błąd w środku serii', () => {
  it('błąd nie zatrzymuje kolejki, nie znika po następnym sukcesie i nie liczy się jako sukces', async () => {
    const onScan = vi.fn()
      .mockResolvedValueOnce(wynik({ done: 5 }))
      .mockRejectedValueOnce(new Error('brak łączności'))
      .mockResolvedValueOnce(wynik({ done: 6 }))
    naPozycji(onScan)
    wystukaj(U(1) + U(2) + U(3))
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('2'))
    // Ostatni wynik to sukces — a błąd środkowego skanu wciąż widać, z kodem.
    expect(await screen.findByText('Na magazynie')).toBeTruthy()
    expect(screen.getByTestId('bledy-licznik').textContent).toBe('1')
    expect(screen.getByTestId('blad-skanu').textContent).toContain(U(2))
    expect(screen.getByTestId('blad-skanu').textContent).toContain('brak łączności')
    expect(beepOk).toHaveBeenCalledTimes(2)
    expect(beepErr).toHaveBeenCalledTimes(1)
  })

  it('ponowienie tego samego kodu od razu po błędzie nie jest blokowane', async () => {
    const onScan = vi.fn()
      .mockRejectedValueOnce(new Error('brak łączności'))
      .mockResolvedValueOnce(wynik())
    naPozycji(onScan)
    wystukaj(U(9))
    await screen.findByText(/brak łączności/i)
    wystukaj(U(9))
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Na magazynie')).toBeTruthy()
  })

  it('ucięta sztuka po ciszy: błąd na liście, nic nie poszło na serwer', async () => {
    vi.useFakeTimers()
    try {
      const onScan = vi.fn().mockResolvedValue(wynik())
      naPozycji(onScan)
      wystukaj('U|ac82b8f61e2545')
      await act(async () => { vi.advanceTimersByTime(500) })
      expect(screen.queryByTestId('bledy-sesji')).toBeNull()     // pauza 500 ms nie tnie kodu
      await act(async () => { vi.advanceTimersByTime(1000) })
      expect(onScan).not.toHaveBeenCalled()
      expect(screen.getByTestId('bledy-licznik').textContent).toBe('1')
      expect(screen.getByTestId('ostatni-skan').textContent).toMatch(/Niepełny odczyt „U\|ac82b8f61e2545"/)
      expect(beepErr).toHaveBeenCalledTimes(1)
      expect((screen.getByTestId('pole-skanu') as HTMLInputElement).value).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('pauza 500 ms w środku kodu sztuki — jeden pełny skan', async () => {
    vi.useFakeTimers()
    try {
      const onScan = vi.fn().mockResolvedValue(wynik())
      naPozycji(onScan)
      wystukaj('U|ac82b8f61e')
      await act(async () => { vi.advanceTimersByTime(550) })
      wystukaj('2545a4867b')
      expect(onScan).toHaveBeenCalledTimes(1)
      expect(onScan).toHaveBeenCalledWith('U|ac82b8f61e2545a4867b', 'l1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('zamknięcie okna czeka na całą kolejkę — także na skany z błędem', async () => {
    let puść!: () => void
    const onClose = vi.fn()
    const onScan = vi.fn()
      .mockImplementationOnce(() => new Promise((_, rej) => { puść = () => rej(new Error('brak łączności')) }))
      .mockResolvedValueOnce(wynik())
    naPozycji(onScan, { onClose })
    wystukaj(U(1) + U(2))
    fireEvent.click(screen.getByTestId('zamknij-skan'))
    expect(onClose).not.toHaveBeenCalled()
    puść()
    await waitFor(() => expect((screen.getByTestId('zamknij-skan') as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('1')
    expect(screen.getByTestId('bledy-licznik').textContent).toBe('1')
    fireEvent.click(screen.getByTestId('zamknij-skan'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ScanPanel — lista błędów sesji', () => {
  const zly = (n: number) => Object.assign(new Error(`Nieznany kod ${n}`), { status: 400 })

  it('7 błędów przeplatanych sukcesami — KAŻDY z kodem i komunikatem, nic nie ukryte', async () => {
    const bledne = new Set([1, 2, 4, 5, 7, 8, 9])
    const onScan = vi.fn(async (kod: string) => {
      const n = parseInt(kod.slice(2), 16)
      if (bledne.has(n)) throw zly(n)
      return wynik()
    })
    naPozycji(onScan)
    wystukaj(Array.from({ length: 10 }, (_, i) => U(i + 1)).join(''))
    await waitFor(() => expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('3'))
    await waitFor(() => expect(screen.queryByTestId('kolejka-skanow')).toBeNull())
    expect(screen.getByTestId('bledy-licznik').textContent).toBe('7')
    const pozycje = screen.getAllByTestId('blad-skanu')
    expect(pozycje).toHaveLength(7)
    for (const n of bledne) {
      const li = pozycje.find(p => p.textContent!.includes(U(n)))
      expect(li, `brak błędu ${U(n)}`).toBeTruthy()
      expect(li!.textContent).toContain(`Nieznany kod ${n}`)
      expect(li!.textContent).toContain('Nie weszła')
    }
    // Zwięźle: lista się przewija zamiast rosnąć bez końca.
    expect(screen.getByTestId('bledy-lista').className).toMatch(/overflow-y-auto/)
    expect(screen.getByTestId('bledy-lista').style.maxHeight).toBeTruthy()
    // Neutralna instrukcja — bez ogólnego „zeskanuj ponownie".
    expect(screen.getByTestId('bledy-sesji').textContent).toMatch(/sprawdź błędy poniżej/i)
    expect(screen.getByTestId('bledy-sesji').textContent).not.toMatch(/zeskanuj je ponownie/i)
    expect(beepErr).toHaveBeenCalledTimes(7)
    expect(beepOk).toHaveBeenCalledTimes(3)
  })

  it('bieżący błąd pokazuje KOD w dużym polu; wcześniejsze są na liście', async () => {
    const onScan = vi.fn()
      .mockRejectedValueOnce(zly(1))
      .mockRejectedValueOnce(zly(2))
    naPozycji(onScan)
    wystukaj(U(1) + U(2))
    await waitFor(() => expect(screen.getByTestId('bledy-licznik').textContent).toBe('2'))
    expect(screen.getByTestId('ostatni-kod').textContent).toContain(U(2))
    expect(screen.getByTestId('ostatni-skan').textContent).toContain('Nieznany kod 2')
    expect(screen.getAllByTestId('blad-skanu').map(li => li.textContent)).toEqual([
      expect.stringContaining(U(1)),
    ])
    expect(screen.getByTestId('bledy-instrukcja').textContent).toMatch(/ostatni powyżej, wcześniejsze poniżej/)
  })

  it('błąd połączenia: wynik niepewny, bez twierdzenia, że nic nie zapisano', async () => {
    naPozycji(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    wystukaj(U(1))
    expect(await screen.findByText('Błąd połączenia — wynik niepewny')).toBeTruthy()
    const tekst = screen.getByTestId('ostatni-skan').textContent ?? ''
    expect(tekst).toContain('Failed to fetch')
    expect(tekst).not.toMatch(/nic nie zapisano|nie weszła/i)
    expect(screen.getByTestId('ostatni-kod').textContent).toContain(U(1))
  })

  it('„Przeczytane" od razu oddaje fokus polu — kolejne skany są odbierane', async () => {
    const onScan = vi.fn()
      .mockRejectedValueOnce(zly(1))
      .mockResolvedValue(wynik())
    naPozycji(onScan)
    const pole = screen.getByTestId('pole-skanu') as HTMLInputElement
    wystukaj(U(1))
    await screen.findByTestId('bledy-sesji')
    const przycisk = screen.getByTestId('bledy-wyczysc')
    przycisk.focus()
    fireEvent.click(przycisk)
    expect(document.activeElement).toBe(pole)
    expect(screen.queryByTestId('bledy-sesji')).toBeNull()
    wystukaj(U(2))
    await waitFor(() => expect(onScan).toHaveBeenCalledWith(U(2), 'l1'))
  })

  it('Shift+Tab z pola dalej przechodzi do przycisków, także przy liście błędów', async () => {
    naPozycji(vi.fn().mockRejectedValue(zly(1)))
    wystukaj(U(1))
    await screen.findByTestId('bledy-sesji')
    const pole = screen.getByTestId('pole-skanu')
    pole.focus()
    fireEvent.keyDown(pole, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).not.toBe(pole)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })
})

describe('ScanPanel — IME i modyfikatory', () => {
  it('tekst kompozycji nie jest skanem; po compositionend wchodzi RAZ', async () => {
    const onScan = vi.fn().mockResolvedValue(wynik())
    naPozycji(onScan)
    const pole = screen.getByTestId('pole-skanu') as HTMLInputElement
    fireEvent.compositionStart(pole)
    fireEvent.change(pole, { target: { value: U(1) } })     // tymczasowy tekst IME
    expect(fireEvent.keyDown(pole, { key: 'Enter', isComposing: true })).toBe(true)  // Enter należy do IME
    expect(onScan).not.toHaveBeenCalled()
    fireEvent.compositionEnd(pole)
    fireEvent.change(pole, { target: { value: pole.value } })   // końcowy input po kompozycji
    fireEvent.keyDown(pole, { key: 'Enter' })
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(1))
    await new Promise(r => setTimeout(r, 30))
    expect(onScan).toHaveBeenCalledTimes(1)
    expect(onScan).toHaveBeenCalledWith(U(1), 'l1')
  })

  it('Ctrl/Meta/Alt+Enter nie kończy ramki; zwykły Enter kończy', async () => {
    const onScan = vi.fn().mockResolvedValue(wynik())
    naPozycji(onScan)
    const pole = screen.getByTestId('pole-skanu') as HTMLInputElement
    wystukaj('KEBAB-7')
    fireEvent.keyDown(pole, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(pole, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(pole, { key: 'Enter', altKey: true })
    await new Promise(r => setTimeout(r, 30))
    expect(onScan).not.toHaveBeenCalled()
    expect(pole.value).toBe('KEBAB-7')
    fireEvent.keyDown(pole, { key: 'Enter' })
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('KEBAB-7', 'l1'))
    expect(onScan).toHaveBeenCalledTimes(1)
  })
})

describe('ScanPanel — StrictMode i seria', () => {
  it('w StrictMode trzy sklejone kody to trzy skany, bez podwójnych handlerów', async () => {
    const onScan = vi.fn().mockResolvedValue(wynik())
    render(<StrictMode><ScanPanel line={linia} lp={3} onScan={onScan} onClose={() => {}} /></StrictMode>)
    wystukaj(U(1) + U(2) + U(3))
    await waitFor(() => expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('3'))
    expect(onScan.mock.calls.map(c => c[0])).toEqual([U(1), U(2), U(3)])
    expect(beepOk).toHaveBeenCalledTimes(3)
  })
})
