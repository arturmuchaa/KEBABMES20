// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

const podglad   = vi.hoisted(() => ({ fn: vi.fn() }))
const zapisz    = vi.hoisted(() => ({ fn: vi.fn(() => Promise.resolve({})) }))
const dokumenty = vi.hoisted(() => ({ fn: vi.fn(() => Promise.resolve({})) }))
const anuluj    = vi.hoisted(() => ({ fn: vi.fn(() => Promise.resolve({})) }))
vi.mock('@/lib/api', () => ({
  orderSplitApi: {
    preview: podglad.fn,
    save: zapisz.fn,
    documents: dokumenty.fn,
    cancelDocuments: anuluj.fn,
  },
}))

import { SplitDialog } from './SplitDialog'

const ODPOWIEDZ = {
  kg_calosc: 13005, kg_fv: 7995, kg_wz: 5010, odchylka: -5,
  lines: [
    { id: 'l1', recipe_name: 'KIRMIZI', kg_per_unit: 50, qty: 15, qty_invoice: 9, qty_wz: 6 },
    { id: 'l2', recipe_name: 'BEYAZ AFIYET', kg_per_unit: 40, qty: 40, qty_invoice: 25, qty_wz: 15 },
  ],
}

// `vitest.config.ts` nie ma `restoreMocks`/`clearMocks` — bez jawnego
// przywrócenia `vi.spyOn(window, 'confirm')` i `mockRejectedValue` ustawione
// w jednym teście zostawały aktywne w KOLEJNYCH (dopisanych PO nim), które
// nie wiedziały, dlaczego nagle dostają odmowę (review, runda 3, minor 3).
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('SplitDialog', () => {
  it('pokazuje podzial po wpisaniu kilogramow', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('7995')).toBeTruthy())
    expect(screen.getByText('5010')).toBeTruthy()
  })

  it('pokazuje odchylke od celu', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText(/-5 kg/)).toBeTruthy())
  })

  it('przycisk 50/50 wpisuje polowe calosci', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    render(<SplitDialog orderId="o1" onClose={() => {}} kgCalosc={13005} />)
    fireEvent.click(screen.getByRole('button', { name: /50\/50/ }))
    await waitFor(() => expect(podglad.fn).toHaveBeenCalledWith('o1', 6502.5))
  })

  it('kazda pozycja pokazuje ile na FV i ile na WZ', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('KIRMIZI')).toBeTruthy())
    expect(screen.getByDisplayValue('9')).toBeTruthy()
  })

  // ── Testy dopisane ponad brief ──────────────────────────────────────

  it('gdy nie da sie trafic w cel calymi sztukami, mowi to wprost obok odchylki', async () => {
    podglad.fn.mockResolvedValue({ ...ODPOWIEDZ, trafiono: false })
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText(/nie da się trafić/i)).toBeTruthy())
    // Odchylka widoczna OBOK (w ostrzeżeniu i w stopce) — nie trzeba jej szukać osobno.
    expect(screen.getAllByText(/-5 kg/).length).toBeGreaterThan(0)
  })

  it('gdy podzial trafia dokladnie w cel, nie straszy odchylka', async () => {
    podglad.fn.mockResolvedValue({ ...ODPOWIEDZ, trafiono: true, odchylka: 0 })
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '7995' } })
    await waitFor(() => expect(screen.getByText('7995')).toBeTruthy())
    expect(screen.queryByText(/nie da się trafić/i)).toBeNull()
  })

  it('reczna korekta pojedynczej linii idzie do zapisu przez per_line', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    zapisz.fn.mockResolvedValue({ ...ODPOWIEDZ, kg_fv: 8050, kg_wz: 4955 })
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('KIRMIZI')).toBeTruthy())
    // Biuro poprawia RĘCZNIE jedną pozycję — z 9 na 10 sztuk na fakturę.
    fireEvent.change(screen.getByDisplayValue('9'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: /zapisz podział/i }))
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, { l1: 10 }))
    // Po udanym zapisie korekta jest utrwalona — ostrzeżenie o starych sumach znika.
    expect(screen.queryByText(/sprzed tej korekty/i)).toBeNull()
  })

  it('niezapisana reczna korekta oznacza sumy w stopce jako nieaktualne', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('KIRMIZI')).toBeTruthy())
    // Zanim biuro cokolwiek poprawi, sumy w stopce są aktualne — bez ostrzeżenia.
    expect(screen.queryByText(/sprzed tej korekty/i)).toBeNull()
    // Wiersz pokazuje nową liczbę, ale stopka jeszcze liczy z POPRZEDNIEJ
    // odpowiedzi API (backend nie ma trasy „podgląd z per_line") — musi być
    // widoczne, że te sumy jeszcze nie opisują tego, co na ekranie.
    fireEvent.change(screen.getByDisplayValue('9'), { target: { value: '10' } })
    expect(screen.getByText(/sprzed tej korekty/i)).toBeTruthy()
  })

  it('wystawia komplet dokumentow z checkboxem HDI do faktury i pokazuje numery', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    dokumenty.fn.mockResolvedValue({
      order_id: 'o1',
      wm: { id: 'wm1', number: 'WM/1/09/2026' },
      wz: { id: 'wz1', number: 'WZ/2/09/2026' },
      cmr: [{ id: 'c1', number: 'CMR/1' }, { id: 'c2', number: 'CMR/2' }],
      hdi_calosc: { id: 'h1', number: 'HDI/1' },
      hdi_fv: { id: 'h2', number: 'HDI/2' },
    })
    zapisz.fn.mockResolvedValue(ODPOWIEDZ)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    // Przycisk jest zablokowany, dopóki biuro nie zobaczyło podglądu ORAZ
    // dopóki to, co na ekranie, nie jest tym, co zapisane w bazie.
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('KIRMIZI')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /zapisz podział/i }))
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, undefined))
    fireEvent.click(screen.getByLabelText(/także HDI do faktury/i))
    fireEvent.click(screen.getByRole('button', { name: /wystaw komplet dokumentów/i }))
    await waitFor(() => expect(dokumenty.fn).toHaveBeenCalledWith('o1', true))
    expect(screen.getByText('WM/1/09/2026')).toBeTruthy()
    // Important 2: akcja wycofania stoi obok numerów od razu — bez żadnej
    // wcześniejszej odmowy, bo tu WIADOMO na pewno, że dokumenty istnieją.
    expect(screen.getByRole('button', { name: /anuluj dokumenty podziału/i })).toBeTruthy()
  })

  it('wystawienie kompletu pyta o potwierdzenie zdjecia stanu i nic nie robi po odmowie', async () => {
    // Important 1a: przycisk ZDEJMUJE STAN MAGAZYNU — jedno kliknięcie bez
    // słowa o konsekwencji było dziurą, nie skrótem.
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    zapisz.fn.mockResolvedValue(ODPOWIEDZ)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('KIRMIZI')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /zapisz podział/i }))
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, undefined))
    fireEvent.click(screen.getByRole('button', { name: /wystaw komplet dokumentów/i }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(dokumenty.fn).not.toHaveBeenCalled()
  })

  it('wystawienie kompletu jest zablokowane przy niezapisanej recznej korekcie', async () => {
    // Dokumenty powstałyby z podziału ZAPISANEGO w bazie (sprzed korekty),
    // a tabela na ekranie już pokazuje nowe liczby. Zapis PRZED korektą, żeby
    // test mierzył właśnie korektę, a nie „nic jeszcze nie zapisano".
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    zapisz.fn.mockResolvedValue(ODPOWIEDZ)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('KIRMIZI')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /zapisz podział/i }))
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, undefined))
    fireEvent.change(screen.getByDisplayValue('9'), { target: { value: '10' } })
    const przycisk = screen.getByRole('button', { name: /wystaw komplet dokumentów/i }) as HTMLButtonElement
    expect(przycisk.disabled).toBe(true)
    fireEvent.click(przycisk)
    expect(dokumenty.fn).not.toHaveBeenCalled()
  })

  it('wystawienie kompletu jest zablokowane, dopoki biuro nie zobaczylo podgladu', () => {
    // Important 1c: okno otwarte z listy i od razu kliknięty największy,
    // ciemny przycisk nie ma wystawić kompletu dla podziału, którego biuro
    // nigdy nie widziało.
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    const przycisk = screen.getByRole('button', { name: /wystaw komplet dokumentów/i }) as HTMLButtonElement
    expect(przycisk.disabled).toBe(true)
    fireEvent.click(przycisk)
    expect(dokumenty.fn).not.toHaveBeenCalled()
  })

  it('wyczyszczenie pola na FV wysyla jawne zero, nie zostawia po staremu', async () => {
    // Minor 1: pusty input to ODJĘCIE pozycji z faktury (jawne zero), nie
    // „zostaw jak wyliczył backend" — inaczej operator kasuje liczbę, a
    // ekran i tak wysyła starą.
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    zapisz.fn.mockResolvedValue({ ...ODPOWIEDZ, kg_fv: 6750, kg_wz: 6255 })
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('KIRMIZI')).toBeTruthy())
    fireEvent.change(screen.getByDisplayValue('9'), { target: { value: '' } })
    // Cała ilość l1 (15 szt zamówione) natychmiast pokazuje się w kolumnie
    // „Na WZ" TEJ SAMEJ pozycji — widoczna informacja zwrotna, nie cichy
    // powrót do starej wartości. Komórka po indeksie, bo „15" jest też
    // w kolumnie „Zamówiono" tego samego wiersza.
    const wiersz = screen.getByLabelText('na FV — KIRMIZI').closest('tr') as HTMLElement
    const komorki = within(wiersz).getAllByRole('cell')
    expect(komorki[komorki.length - 1].textContent).toBe('15')
    fireEvent.click(screen.getByRole('button', { name: /zapisz podział/i }))
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, { l1: 0 }))
  })

  it('gdy zapis odmawia bo dokumenty juz wystawione, oferuje anulowanie ich na miejscu', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    zapisz.fn.mockRejectedValue(new Error(
      'Zamówienie ma już wystawione dokumenty z podziału (WM/1/09/2026) — zmiana podziału ' +
      'rozjechałaby je między sobą. Żeby zmienić podział, najpierw anuluj dokumenty podziału ' +
      '(przycisk „Anuluj podział” na zamówieniu).'))
    anuluj.fn.mockResolvedValue({ order_id: 'o1', documents: [], returned_qty: 42 })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('KIRMIZI')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /zapisz podział/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /anuluj dokumenty podziału/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /anuluj dokumenty podziału/i }))
    await waitFor(() => expect(anuluj.fn).toHaveBeenCalledWith('o1'))
    expect(screen.getByText(/42/)).toBeTruthy()
  })

  it('gdy wystawienie kompletu odmawia bo brak zapisanego podzialu, nie proponuje anulowania', async () => {
    // Zapis się udał, ale zamówienie dostało POTEM nową pozycję bez podziału
    // — backend odmawia dopiero na wystawieniu i to okno musi to pokazać.
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    zapisz.fn.mockResolvedValue(ODPOWIEDZ)
    dokumenty.fn.mockRejectedValue(new Error(
      'Zamówienie nie ma podziału na fakturę i WZ — najpierw zapisz podział.'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('KIRMIZI')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /zapisz podział/i }))
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, undefined))
    fireEvent.click(screen.getByRole('button', { name: /wystaw komplet dokumentów/i }))
    await waitFor(() => expect(screen.getByText(/najpierw zapisz podział/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /anuluj dokumenty podziału/i })).toBeNull()
  })

  it('zmiana celu po zapisie blokuje wystawienie kompletu', async () => {
    // Dziura, którą to zamyka: `documents` wysyła SAMO `{hdi_fv}` — żadnego
    // celu, żadnego per_line. Dokumenty powstają więc z podziału ZAPISANEGO
    // w bazie. Ciąg „zapisz 8000 → wpisz 9000 → wystaw komplet" dawał komplet
    // na 8000, podczas gdy biuro patrzyło na ekran z 9000. Żadna z wcześniejszych
    // bramek tego nie łapała: podgląd JEST, `overrides` PUSTE, potwierdzenie klikniete.
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    zapisz.fn.mockResolvedValue(ODPOWIEDZ)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('KIRMIZI')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /zapisz podział/i }))
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, undefined))
    // Nowy cel: NOWY, niezapisany podgląd — bez dotykania ręcznych korekt.
    podglad.fn.mockResolvedValue({ ...ODPOWIEDZ, kg_fv: 8995, kg_wz: 4010 })
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '9000' } })
    await waitFor(() => expect(screen.getByText('8995')).toBeTruthy())
    // Liczy się to, że dokumenty NIE POWSTAJĄ — sam atrybut `disabled` to za
    // mało, bo zostałby zielony, gdyby ktoś kiedyś wywołał handler inaczej.
    const przycisk = screen.getByRole('button', { name: /wystaw komplet dokumentów/i }) as HTMLButtonElement
    fireEvent.click(przycisk)
    await act(async () => {})
    expect(dokumenty.fn).not.toHaveBeenCalled()
    expect(przycisk.disabled).toBe(true)
    expect(screen.getByText(/z tego, co zapisane w bazie/i)).toBeTruthy()
  })

  it('po zapisaniu nowego celu wystawienie kompletu znowu dziala', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    zapisz.fn.mockResolvedValue(ODPOWIEDZ)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('KIRMIZI')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /zapisz podział/i }))
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, undefined))
    const nowy = { ...ODPOWIEDZ, kg_fv: 8995, kg_wz: 4010 }
    podglad.fn.mockResolvedValue(nowy)
    zapisz.fn.mockResolvedValue(nowy)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '9000' } })
    await waitFor(() => expect(screen.getByText('8995')).toBeTruthy())
    // Zapis dogania ekran — i dopiero wtedy komplet wolno wystawić.
    fireEvent.click(screen.getByRole('button', { name: /zapisz podział/i }))
    await waitFor(() => expect(zapisz.fn).toHaveBeenLastCalledWith('o1', 9000, undefined))
    fireEvent.click(screen.getByRole('button', { name: /wystaw komplet dokumentów/i }))
    await waitFor(() => expect(dokumenty.fn).toHaveBeenCalledWith('o1', false))
  })

  it('spozniona odpowiedz podgladu nie wskrzesza tabeli po wyczyszczeniu pola', async () => {
    // Wyczyszczenie pola musi UNIEWAŻNIĆ żądanie w locie. Inaczej jego
    // spóźniona odpowiedź przechodzi kontrolę kolejności i pokazuje podział
    // dla celu, którego w polu już nie ma.
    let odpowiedz: (v: unknown) => void = () => {}
    podglad.fn.mockImplementation(() => new Promise(res => { odpowiedz = res }))
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    const pole = screen.getByLabelText(/na fakturę/i)
    fireEvent.change(pole, { target: { value: '8000' } })
    fireEvent.change(pole, { target: { value: '' } })
    await act(async () => { odpowiedz(ODPOWIEDZ) })
    expect(screen.queryByText('KIRMIZI')).toBeNull()
    // …i nie zostawia wiecznego „Liczę…" zamiast podpowiedzi, co wpisać.
    expect(screen.queryByText(/Liczę/)).toBeNull()
  })
})
