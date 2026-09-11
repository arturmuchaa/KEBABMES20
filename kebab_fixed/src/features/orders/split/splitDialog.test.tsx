// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

const podglad   = vi.hoisted(() => ({ fn: vi.fn() }))
const zapisz    = vi.hoisted(() => ({ fn: vi.fn(() => Promise.resolve({})) }))
const dokumenty = vi.hoisted(() => ({ fn: vi.fn(() => Promise.resolve({})) }))
const anuluj    = vi.hoisted(() => ({ fn: vi.fn(() => Promise.resolve({})) }))
const wczytaj   = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('@/lib/api', () => ({
  // Ten sam odczyt kodu HTTP co w prawdziwym module — okno odróżnia po nim
  // „zamówienie bez pozycji" (404) od awarii odczytu.
  errStatus: (e: any) => e?.status ?? 0,
  orderSplitApi: {
    saved: wczytaj.fn,
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
const BRAK_PODZIALU = {
  istnieje: false, kompletny: false, cel_kg: null, lines: [],
  kg_calosc: 13005, kg_fv: 0, kg_wz: 0, trafiono: null, odchylka: null,
}

// Zapisany podział z RĘCZNĄ korektą: cel 400 kg, ale w bazie leży 490 kg,
// bo biuro poprawiło pierwszą pozycję z 5 na 8 sztuk. Algorytm sam nigdy by
// tych liczb nie dał — po to są, żeby było widać, że wracają Z BAZY.
const ZAPISANY = {
  istnieje: true, kompletny: true, cel_kg: 400,
  kg_calosc: 800, kg_fv: 490, kg_wz: 310, trafiono: false, odchylka: 90,
  lines: [
    { id: 'l1', recipe_name: 'KIRMIZI', kg_per_unit: 30, qty: 10, qty_invoice: 8, qty_wz: 2 },
    { id: 'l2', recipe_name: 'BEYAZ AFIYET', kg_per_unit: 25, qty: 20, qty_invoice: 10, qty_wz: 10 },
  ],
}

/** Odpowiedź „zapisany podział" opisująca to, co właśnie zapisano — od rundy 4
 *  okno czyta bazę jeszcze raz tuż przed wystawieniem kompletu, więc test,
 *  który zapisuje podział i wystawia dokumenty, musi mieć czym odpowiedzieć na
 *  to sprawdzenie. Rozjazd tu = odmowa, i o to chodzi. */
const zapisanyJak = (celKg: number, lines: any[] = ODPOWIEDZ.lines) => ({
  istnieje: true, kompletny: true, cel_kg: celKg,
  kg_calosc: ODPOWIEDZ.kg_calosc, kg_fv: ODPOWIEDZ.kg_fv, kg_wz: ODPOWIEDZ.kg_wz,
  trafiono: true, odchylka: 0, lines,
})

// `vi.clearAllMocks()` nie zdejmuje `mockResolvedValue`, więc domyślną
// odpowiedź „brak podziału" uzbrajamy PRZED każdym testem — inaczej podział
// ustawiony w jednym teście wyciekałby do kolejnych.
beforeEach(() => {
  wczytaj.fn.mockResolvedValue(BRAK_PODZIALU)
})

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
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, { l1: 10, l2: 25 }))
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
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, { l1: 9, l2: 25 }))
    wczytaj.fn.mockResolvedValue(zapisanyJak(8000))     // baza zgodna z ekranem
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
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, { l1: 9, l2: 25 }))
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
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, { l1: 9, l2: 25 }))
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
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, { l1: 0, l2: 25 }))
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
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, { l1: 9, l2: 25 }))
    wczytaj.fn.mockResolvedValue(zapisanyJak(8000))     // baza zgodna z ekranem
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
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, { l1: 9, l2: 25 }))
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
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, { l1: 9, l2: 25 }))
    const nowy = { ...ODPOWIEDZ, kg_fv: 8995, kg_wz: 4010 }
    podglad.fn.mockResolvedValue(nowy)
    zapisz.fn.mockResolvedValue(nowy)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '9000' } })
    await waitFor(() => expect(screen.getByText('8995')).toBeTruthy())
    // Zapis dogania ekran — i dopiero wtedy komplet wolno wystawić.
    fireEvent.click(screen.getByRole('button', { name: /zapisz podział/i }))
    await waitFor(() => expect(zapisz.fn).toHaveBeenLastCalledWith('o1', 9000, { l1: 9, l2: 25 }))
    wczytaj.fn.mockResolvedValue(zapisanyJak(9000))     // baza zgodna z ekranem
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

  // ── Okno wczytuje podział ZAPISANY w bazie ──────────────────────────

  it('otwarte na zamowieniu z zapisanym podzialem pokazuje go i pozwala wystawic BEZ zapisu', async () => {
    // Sedno: dokumenty powstają z bazy, więc gdy okno wie, co w bazie leży,
    // nie ma powodu kazać biuru zapisywać podziału jeszcze raz — a ten
    // ponowny zapis kasował ręczną korektę z poprzedniej sesji.
    wczytaj.fn.mockResolvedValue(ZAPISANY)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    // Ręczna korekta z poprzedniej sesji (8 szt., algorytm dałby 5) WIDOCZNA.
    await waitFor(() => expect(screen.getByDisplayValue('8')).toBeTruthy())
    expect((screen.getByLabelText(/na fakturę/i) as HTMLInputElement).value).toBe('400')
    // 490 kg na fakturę = zapisany podział, nie propozycja algorytmu na 400 kg.
    // (Liczba pada dwa razy: w ostrzeżeniu o nietrafieniu i w sumach stopki.)
    expect(screen.getAllByText('490').length).toBeGreaterThan(0)
    expect(screen.getByText('310')).toBeTruthy()
    const przycisk = screen.getByRole('button', { name: /wystaw komplet dokumentów/i }) as HTMLButtonElement
    expect(przycisk.disabled).toBe(false)
    fireEvent.click(przycisk)
    await waitFor(() => expect(dokumenty.fn).toHaveBeenCalledWith('o1', false))
    // Po drodze NIE było żadnego zapisu — czyli nie było czego nadpisać.
    expect(zapisz.fn).not.toHaveBeenCalled()
  })

  it('otwarte na zamowieniu bez zapisanego podzialu zachowuje sie jak dotad', async () => {
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    await act(async () => {})
    expect((screen.getByLabelText(/na fakturę/i) as HTMLInputElement).value).toBe('')
    expect(screen.getAllByText(/wpisz kilogramy na fakturę/i).length).toBeGreaterThan(0)
    const przycisk = screen.getByRole('button', { name: /wystaw komplet dokumentów/i }) as HTMLButtonElement
    expect(przycisk.disabled).toBe(true)
    fireEvent.click(przycisk)
    expect(dokumenty.fn).not.toHaveBeenCalled()
  })

  it('niepelny zapisany podzial pokazuje zapisane sztuki i przenosi je do zapisu', async () => {
    // Pozycja dopisana PO zapisie ma puste sztuki na fakturę. Komplet jest
    // wtedy odmawiany przez backend, więc biuro MUSI zapisać podział jeszcze
    // raz — i właśnie wtedy wcześniejsza ręczna korekta ginęła, bo okno
    // wysyłało sam cel i pozwalało algorytmowi przeliczyć wszystko od nowa.
    wczytaj.fn.mockResolvedValue({
      istnieje: true, kompletny: false, cel_kg: 400,
      kg_calosc: 840, kg_fv: 490, kg_wz: 310, trafiono: null, odchylka: null,
      lines: [
        ...ZAPISANY.lines,
        { id: 'l3', recipe_name: 'NOWA POZYCJA', kg_per_unit: 10, qty: 4,
          qty_invoice: null, qty_wz: null },
      ],
    })
    zapisz.fn.mockResolvedValue(ZAPISANY)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByDisplayValue('8')).toBeTruthy())
    expect(screen.getByText(/nie obejmuje wszystkich pozycji/i)).toBeTruthy()
    // Pozycja bez podziału nie udaje zera — pole puste, „Na WZ" bez liczby.
    expect((screen.getByLabelText('na FV — NOWA POZYCJA') as HTMLInputElement).value).toBe('')
    // Wystawić się nie da: backend i tak odmówi przy pustych sztukach.
    const przycisk = screen.getByRole('button', { name: /wystaw komplet dokumentów/i }) as HTMLButtonElement
    fireEvent.click(przycisk)
    await act(async () => {})
    expect(dokumenty.fn).not.toHaveBeenCalled()
    expect(przycisk.disabled).toBe(true)
    // Zapis przenosi ZAPISANE sztuki pozycji, których nikt nie ruszał —
    // inaczej algorytm przeliczyłby l1 z 8 z powrotem na 5.
    fireEvent.click(screen.getByRole('button', { name: /zapisz podział/i }))
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 400, { l1: 8, l2: 10 }))
  })

  // ── Runda 4: odczyt bazy nie ma prawa udawać pustki ─────────────────

  it('blad odczytu zapisanego podzialu NIE udaje zamowienia bez podzialu', async () => {
    // Puste pole i pusta tabela po nieudanym odczycie wyglądają dokładnie jak
    // zamówienie bez podziału. Biuro wpisuje wtedy kilogramy, zapisuje — i
    // ręczna korekta, której nigdy nie zobaczyło, ginie bez pytania. Ten sam
    // scenariusz co przy wyszarzonym przycisku, tylko wywołany awarią odczytu.
    wczytaj.fn.mockRejectedValue(new Error('HTTP 500: Internal Server Error'))
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/nie udało się sprawdzić/i)).toBeTruthy())
    // Wyjście jest tu, na miejscu: ponowna próba odczytu.
    wczytaj.fn.mockResolvedValue(ZAPISANY)
    fireEvent.click(screen.getByRole('button', { name: /spróbuj ponownie/i }))
    await waitFor(() => expect(screen.getByDisplayValue('8')).toBeTruthy())
    expect(screen.queryByText(/nie udało się sprawdzić/i)).toBeNull()
  })

  it('spozniony odczyt bazy nie podmienia tabeli, ale nadal zasila bramke', async () => {
    // Operator zdążył stuknąć w pole celu, zanim wrócił odczyt bazy. Tabela
    // ma zostać jego, ALE `savedSplit` opisuje bazę, nie ekran — odrzucenie
    // całej odpowiedzi zostawiało okno w stanie „nic nie wiem o bazie".
    let odpowiedz: (v: unknown) => void = () => {}
    wczytaj.fn.mockImplementation(() => new Promise(res => { odpowiedz = res }))
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('7995')).toBeTruthy())
    await act(async () => { odpowiedz(ZAPISANY) })
    // Tabela i pole celu zostają takie, jakie operator sobie ustawił.
    expect(screen.getByText('7995')).toBeTruthy()
    expect((screen.getByLabelText(/na fakturę/i) as HTMLInputElement).value).toBe('8000')
    // A okno JEDNAK wie, co w bazie: gdy operator wróci do zapisanego celu i
    // zobaczy te same sztuki, komplet wolno wystawić bez ponownego zapisu.
    podglad.fn.mockResolvedValue({ ...ZAPISANY, istnieje: undefined, kompletny: undefined })
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '400' } })
    await waitFor(() => expect(screen.getByDisplayValue('8')).toBeTruthy())
    wczytaj.fn.mockResolvedValue(ZAPISANY)
    fireEvent.click(screen.getByRole('button', { name: /wystaw komplet dokumentów/i }))
    await waitFor(() => expect(dokumenty.fn).toHaveBeenCalledWith('o1', false))
    expect(zapisz.fn).not.toHaveBeenCalled()
  })

  it('ulamek w polu pozycji blokuje wystawienie kompletu', async () => {
    // `parseInt` obcinał „8,5" do 8: komórka pokazywała 8,5, bramka widziała
    // 8 (tyle, co w bazie) i komplet powstawał z 8. Ostatnia droga do
    // „dokumenty z innej liczby niż na ekranie" w jednej sesji.
    wczytaj.fn.mockResolvedValue(ZAPISANY)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByDisplayValue('8')).toBeTruthy())
    const przycisk = screen.getByRole('button', { name: /wystaw komplet dokumentów/i }) as HTMLButtonElement
    expect(przycisk.disabled).toBe(false)
    fireEvent.change(screen.getByDisplayValue('8'), { target: { value: '8.5' } })
    fireEvent.click(przycisk)
    await act(async () => {})
    expect(dokumenty.fn).not.toHaveBeenCalled()
    expect(przycisk.disabled).toBe(true)
  })

  it('wczytany zapis z odchylka nie klamie, ze algorytm nie trafil w cel', async () => {
    // ZAPISANY: cel 400 kg, w bazie 490 kg — bo ktoś poprawił pozycję ręcznie.
    // Algorytm trafia w 400 co do kilograma, więc „nie da się trafić całymi
    // sztukami" byłoby nieprawdą o PRZYCZYNIE, choć odchyłka jest prawdziwa.
    wczytaj.fn.mockResolvedValue(ZAPISANY)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByDisplayValue('8')).toBeTruthy())
    expect(screen.queryByText(/nie da się trafić/i)).toBeNull()
    expect(screen.getByText(/jest o \+90 kg od celu/i)).toBeTruthy()
  })

  it('wystawienie sprawdza baze tuz przed wypaleniem numerow', async () => {
    // Druga osoba zapisała inny podział, gdy to okno stało otwarte. Komplet
    // powstaje z BAZY, więc powstałby z jej liczb, a biuro patrzyłoby na swoje.
    const INNY = {
      ...ZAPISANY, cel_kg: 300, kg_fv: 300, kg_wz: 500, trafiono: true, odchylka: 0,
      lines: [
        { ...ZAPISANY.lines[0], qty_invoice: 6, qty_wz: 4 },
        { ...ZAPISANY.lines[1], qty_invoice: 12, qty_wz: 8 },
      ],
    }
    wczytaj.fn.mockResolvedValueOnce(ZAPISANY).mockResolvedValueOnce(INNY)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByDisplayValue('8')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /wystaw komplet dokumentów/i }))
    await waitFor(() => expect(screen.getByText(/ktoś zmienił podział/i)).toBeTruthy())
    expect(dokumenty.fn).not.toHaveBeenCalled()
    // Okno pokazuje TERAZ to, co naprawdę leży w bazie — nie zostawia biura
    // przy tabeli, o której właśnie powiedziało, że jest nieaktualna.
    expect(screen.getByDisplayValue('6')).toBeTruthy()
    expect((screen.getByLabelText(/na fakturę/i) as HTMLInputElement).value).toBe('300')
  })
})
