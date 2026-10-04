// @vitest-environment jsdom
/**
 * Pas skanowania magazynu przy szybkiej serii (hala 02.10.2026: dwie szybko
 * zeskanowane etykiety sklejały się w jeden niepoprawny kod).
 *
 * Wspólne pole pakowania, załadunku, wydania sztuk i mroźni: kody mają
 * wychodzić osobno, od razu, po kolei — jeden zapis naraz, bez czekania
 * pola na odpowiedź serwera.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { StrictMode, createRef } from 'react'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

vi.mock('../dzwiek', () => ({ grajBlad: vi.fn(), grajInny: vi.fn() }))

import { PasSkanowania, type PasSkanowaniaUchwyt } from './PasSkanowania'
import { grajBlad } from '../dzwiek'

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers() })

const hex = (n: number) => n.toString(16).padStart(20, '0')
const U = (n: number) => `U|${hex(n)}`
const pole = () => screen.getByLabelText('Pole skanowania') as HTMLInputElement
/** Znaki po kolei, każdy dopisany do tego, co JEST w polu — jak z klawiatury. */
const wystukaj = (tekst: string) => {
  for (const ch of tekst) fireEvent.change(pole(), { target: { value: pole().value + ch } })
}

describe('Pas skanowania — seria bez Entera', () => {
  it('trzy sztuki znak po znaku, bez przerwy — trzy osobne skany w kolejności, pole puste od razu', async () => {
    const onSkan = vi.fn()
    render(<PasSkanowania placeholder="Skanuj…" onSkan={onSkan} />)
    wystukaj(U(1) + U(2) + U(3))
    expect(pole().value).toBe('')                  // nic nie czeka na ciszę
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(3))
    expect(onSkan.mock.calls.map(c => c[0])).toEqual([U(1), U(2), U(3)])
  })

  it('jedna zmiana pola z dwoma sklejonymi kodami — dwa skany', async () => {
    const onSkan = vi.fn()
    render(<PasSkanowania placeholder="Skanuj…" onSkan={onSkan} />)
    fireEvent.change(pole(), { target: { value: `SCARTON|${hex(5)}${U(1)}` } })
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(2))
    expect(onSkan.mock.calls.map(c => c[0])).toEqual([`SCARTON|${hex(5)}`, U(1)])
  })

  it('kody idą bez zegara — sztuka nie czeka 150 ms', async () => {
    vi.useFakeTimers()
    const onSkan = vi.fn()
    render(<PasSkanowania placeholder="Skanuj…" onSkan={onSkan} />)
    wystukaj(U(1) + U(2))
    expect(screen.getByTestId('skany-oczekujace').textContent).toMatch(/odebrano 2/)
    // Zegar stoi (fałszywe timery) — kody wychodzą na samych mikrozadaniach.
    await vi.waitFor(() => expect(onSkan.mock.calls.map(c => c[0])).toEqual([U(1), U(2)]))
  })

  it('500 kodów przy wstrzymanej pierwszej odpowiedzi: jeden zapis naraz, pełne FIFO, licznik oczekujących', async () => {
    let wLocie = 0
    let maks = 0
    let wywolan = 0
    let puść!: () => void
    const wstrzymana = new Promise<void>(r => { puść = r })
    const onSkan = vi.fn(async () => {
      wLocie++; maks = Math.max(maks, wLocie)
      if (++wywolan === 1) await wstrzymana
      wLocie--
    })
    const onPending = vi.fn()
    render(<PasSkanowania placeholder="Skanuj…" onSkan={onSkan} onPendingChange={onPending} />)
    const oczekiwane = Array.from({ length: 500 }, (_, i) => U(i + 1))
    for (const k of oczekiwane) fireEvent.change(pole(), { target: { value: pole().value + k } })
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(1))
    // Odebrane, ale NIE zapisane — licznik to nie potwierdzenie.
    expect(screen.getByTestId('skany-oczekujace').textContent).toMatch(/odebrano 500/)
    expect(pole().disabled).toBe(false)            // pole nie jest blokowane zwykłym zapisem
    puść()
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(500), { timeout: 10_000 })
    expect(onSkan.mock.calls.map(c => (c as unknown[])[0])).toEqual(oczekiwane)
    expect(maks).toBe(1)
    await waitFor(() => expect(screen.queryByTestId('skany-oczekujace')).toBeNull())
    expect(onPending).toHaveBeenLastCalledWith(false)
  }, 30_000)

  it('błąd w środku kolejki nie zatrzymuje dalszych skanów', async () => {
    const onSkan = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('brak sieci'))
      .mockResolvedValueOnce(undefined)
    render(<PasSkanowania placeholder="Skanuj…" onSkan={onSkan} />)
    wystukaj(U(1) + U(2) + U(3))
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(3))
    expect(onSkan.mock.calls.map(c => c[0])).toEqual([U(1), U(2), U(3)])
  })

  it('odrzucony onSkan w środku serii: trwały błąd z kodem i dźwięk, następny skan idzie', async () => {
    const onSkan = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('brak sieci'))
      .mockResolvedValueOnce(undefined)
    const onPending = vi.fn()
    render(<PasSkanowania placeholder="Skanuj…" onSkan={onSkan} onPendingChange={onPending} />)
    wystukaj(U(1) + U(2) + U(3))
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(3))
    const bledy = await screen.findAllByTestId('blad-obslugi')
    expect(bledy).toHaveLength(1)
    expect(bledy[0].textContent).toContain(U(2))
    expect(bledy[0].textContent).toContain('brak sieci')
    expect(bledy[0].textContent).not.toMatch(/nic nie zapisano/i)
    expect(grajBlad).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByTestId('skany-oczekujace')).toBeNull())
    expect(onPending).toHaveBeenLastCalledWith(false)
    // Trwały: kolejny sukces go nie zdejmuje, tylko „Przeczytane".
    wystukaj(U(4))
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(4))
    expect(screen.getAllByTestId('blad-obslugi')).toHaveLength(1)
  })

  it('ręczne ponowienie tej samej sztuki od razu po odrzuceniu — idzie, bez automatycznego retry', async () => {
    const onSkan = vi.fn()
      .mockRejectedValueOnce(new Error('brak sieci'))
      .mockResolvedValueOnce(undefined)
    render(<PasSkanowania placeholder="Skanuj…" onSkan={onSkan} />)
    wystukaj(U(9))
    await screen.findByTestId('blad-obslugi')
    await new Promise(r => setTimeout(r, 30))
    expect(onSkan).toHaveBeenCalledTimes(1)                  // nic nie ponawia samo
    wystukaj(U(9))
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(2))
    expect(onSkan.mock.calls.map(c => c[0])).toEqual([U(9), U(9)])
  })

  it('„Przeczytane" zdejmuje błąd i oddaje fokus polu', async () => {
    const onSkan = vi.fn().mockRejectedValueOnce(new Error('brak sieci'))
    render(<PasSkanowania placeholder="Skanuj…" onSkan={onSkan} />)
    wystukaj(U(1))
    await screen.findByTestId('blad-obslugi')
    const przycisk = screen.getByRole('button', { name: 'Przeczytane' })
    przycisk.focus()
    fireEvent.click(przycisk)
    expect(screen.queryByTestId('blad-obslugi')).toBeNull()
    expect(document.activeElement).toBe(pole())
  })

  it('kartka palety: „1" nie wychodzi przed „12"; Tab kończy kod od razu', async () => {
    const onSkan = vi.fn()
    render(<PasSkanowania placeholder="Skanuj…" onSkan={onSkan} />)
    wystukaj('PAL|Zam1|12')
    await new Promise(r => setTimeout(r, 30))
    expect(onSkan).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(pole(), { key: 'Tab' })).toBe(false)
    await waitFor(() => expect(onSkan).toHaveBeenCalledWith('PAL|Zam1|12', expect.anything()))
  })

  it('paleta + sztuka bez separatora; spóźniony Enter nie robi dodatkowego skanu', async () => {
    const onSkan = vi.fn()
    render(<PasSkanowania placeholder="Skanuj…" onSkan={onSkan} />)
    wystukaj(`PAL|Zam1|3${U(4)}`)
    fireEvent.keyDown(pole(), { key: 'Enter' })
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(2))
    await new Promise(r => setTimeout(r, 30))
    expect(onSkan.mock.calls.map(c => c[0])).toEqual(['PAL|Zam1|3', U(4)])
  })

  it('wklejony tekst z CRLF — każdy kod osobno', async () => {
    const onSkan = vi.fn()
    render(<PasSkanowania placeholder="Skanuj…" onSkan={onSkan} />)
    fireEvent.paste(pole(), { clipboardData: { getData: () => `PAL|o1|1\r\nPAL|o1|2\r\n${U(3)}` } })
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(3))
    expect(onSkan.mock.calls.map(c => c[0])).toEqual(['PAL|o1|1', 'PAL|o1|2', U(3)])
  })

  it('ucięta sztuka po ciszy: czytelny błąd i dźwięk, nic nie poszło do kolejki', async () => {
    vi.useFakeTimers()
    const onSkan = vi.fn()
    render(<PasSkanowania placeholder="Skanuj…" onSkan={onSkan} />)
    wystukaj('U|ac82b8f61e')
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(screen.queryByTestId('blad-odczytu')).toBeNull()       // pauza Bluetooth nie tnie kodu
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.getByTestId('blad-odczytu').textContent).toMatch(/Niepełny odczyt/)
    expect(grajBlad).toHaveBeenCalled()
    expect(onSkan).not.toHaveBeenCalled()
    expect(pole().value).toBe('')
  })

  it('blokada (dialog) kasuje ogon — po odblokowaniu nie wychodzi do nowego kontekstu', async () => {
    vi.useFakeTimers()
    const onSkan = vi.fn()
    const pas = (disabled: boolean) => <PasSkanowania placeholder="Skanuj…" onSkan={onSkan} disabled={disabled} />
    const { rerender } = render(pas(false))
    wystukaj('PAL|Zam1|7')
    rerender(pas(true))
    rerender(pas(false))
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(onSkan).not.toHaveBeenCalled()
    expect(pole().value).toBe('')
  })

  it('odmontowanie kasuje timer — kod czekający na ciszę nie wychodzi', async () => {
    vi.useFakeTimers()
    const onSkan = vi.fn()
    const { unmount } = render(<PasSkanowania placeholder="Skanuj…" onSkan={onSkan} />)
    wystukaj('PAL|Zam1|7')
    unmount()
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(onSkan).not.toHaveBeenCalled()
  })

  it('StrictMode: trzy sklejone kody to trzy skany, bez dublowania', async () => {
    const onSkan = vi.fn()
    render(<StrictMode><PasSkanowania placeholder="Skanuj…" onSkan={onSkan} /></StrictMode>)
    wystukaj(U(1) + U(2) + U(3))
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(3))
    await new Promise(r => setTimeout(r, 30))
    expect(onSkan).toHaveBeenCalledTimes(3)
  })

  it('kartka palety z obcym ogonem („12SPAM") — błąd odczytu, NIC nie idzie do kolejki', async () => {
    const onSkan = vi.fn()
    render(<PasSkanowania placeholder="Skanuj…" onSkan={onSkan} />)
    wystukaj('PAL|Zam1|12SPAM')
    fireEvent.keyDown(pole(), { key: 'Enter' })
    expect(screen.getByTestId('blad-odczytu').textContent).toMatch(/PAL\|Zam1\|12SPAM/)
    await new Promise(r => setTimeout(r, 30))
    expect(onSkan).not.toHaveBeenCalled()
  })

  it('nieaktywne pole (blokada) nie przyjmuje zmiany, wklejenia ani Entera', async () => {
    const onSkan = vi.fn()
    render(<PasSkanowania placeholder="Skanuj…" onSkan={onSkan} disabled />)
    fireEvent.change(pole(), { target: { value: U(1) } })
    fireEvent.paste(pole(), { clipboardData: { getData: () => `${U(2)}\r\n` } })
    fireEvent.keyDown(pole(), { key: 'Enter' })
    await new Promise(r => setTimeout(r, 30))
    expect(onSkan).not.toHaveBeenCalled()
    expect(pole().value).toBe('')
  })

  it('IME: tekst kompozycji nie jest skanem, po compositionend wchodzi raz', async () => {
    const onSkan = vi.fn()
    render(<PasSkanowania placeholder="Skanuj…" onSkan={onSkan} />)
    fireEvent.compositionStart(pole())
    fireEvent.change(pole(), { target: { value: `SCARTON|${hex(5)}` } })
    expect(fireEvent.keyDown(pole(), { key: 'Enter', isComposing: true })).toBe(true)
    await new Promise(r => setTimeout(r, 30))
    expect(onSkan).not.toHaveBeenCalled()
    fireEvent.compositionEnd(pole())
    fireEvent.keyDown(pole(), { key: 'Enter' })
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(1))
    await new Promise(r => setTimeout(r, 30))
    expect(onSkan.mock.calls.map(c => c[0])).toEqual([`SCARTON|${hex(5)}`])
  })

  it('blokada w trakcie kompozycji: tymczasowy tekst i timer przepadają', async () => {
    vi.useFakeTimers()
    const onSkan = vi.fn()
    const pas = (disabled: boolean) => <PasSkanowania placeholder="Skanuj…" onSkan={onSkan} disabled={disabled} />
    const { rerender } = render(pas(false))
    wystukaj('PAL|Zam1|8')
    fireEvent.compositionStart(pole())
    rerender(pas(true))
    rerender(pas(false))
    fireEvent.compositionEnd(pole())
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(onSkan).not.toHaveBeenCalled()
  })

  it('kod z menu (ref.dodaj) i seria z pola — jedna kolejka, w kolejności przyjęcia', async () => {
    let puść!: () => void
    const onSkan = vi.fn((k: string) => (k === 'SCARTON|menu' ? new Promise<void>(r => { puść = r }) : undefined))
    const ref = createRef<PasSkanowaniaUchwyt>()
    render(<PasSkanowania ref={ref} placeholder="Skanuj…" onSkan={onSkan} />)
    act(() => ref.current!.dodaj('SCARTON|menu'))
    wystukaj(U(1) + U(2))
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(1))
    puść()
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(3))
    expect(onSkan.mock.calls.map(c => c[0])).toEqual(['SCARTON|menu', U(1), U(2)])
  })
})
