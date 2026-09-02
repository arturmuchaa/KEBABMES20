// @vitest-environment jsdom
/** Sekcja kontroli HACCP w podglądzie dostawy — ekran z TEMPERATURAMI,
 *  więc obowiązuje ta sama zasada co ekrany z kilogramami: test komponentu,
 *  nie tylko czystej funkcji. */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
const save = vi.fn()
const forDoc = vi.fn()
vi.mock('@/lib/apiClient', () => ({
  receptionChecksApi: { get: (...a: any[]) => get(...a), save: (...a: any[]) => save(...a) },
  // Sloty podpisu doszły w fazie 2 — komponent czyta stąd kolumny l/m.
  signaturesApi: { forDoc: (...a: any[]) => forDoc(...a), eligible: vi.fn(), sign: vi.fn() },
}))

import { ReceptionCheckCard } from './components/ReceptionCheckCard'

const pusty = {
  receptionId: 'r1', visual: null, tempChamber: null, tempMeat: null,
  kgMatch: null, notes: '', verdict: null,
  ncDescription: '', ncAction: '', ncAt: null, status: 'brak', required: true,
}

beforeEach(() => {
  cleanup()
  get.mockReset(); save.mockReset(); forDoc.mockReset()
  forDoc.mockResolvedValue([])
  get.mockResolvedValue(pusty)
  save.mockImplementation((_id: string, dto: any) => Promise.resolve({ ...pusty, ...dto }))
})

describe('ReceptionCheckCard', () => {
  it('dostawa bez wpisu prosi o uzupełnienie', async () => {
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText(/Uzupełnij kontrolę HACCP/i)).toBeTruthy()
  })

  it('temperatura ponad progiem pokazuje uwagę, ale nie blokuje zapisu', async () => {
    get.mockResolvedValue({ ...pusty, visual: 'bz', kgMatch: 'bz', verdict: 'K',
                            tempChamber: 2, tempMeat: 9, status: 'komplet' })
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText(/przekracza próg/i)).toBeTruthy()
    const zapisz = screen.getByRole('button', { name: /Zapisz/i })
    expect(zapisz.hasAttribute('disabled')).toBe(false)
  })

  it('zapis wysyła wpisane wartości, przecinek dziesiętny działa jak kropka', async () => {
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    await screen.findByText(/Uzupełnij kontrolę HACCP/i)
    fireEvent.change(screen.getByLabelText(/Temperatura komory/i), { target: { value: '2,5' } })
    fireEvent.click(screen.getByRole('button', { name: /Zapisz/i }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][1].tempChamber).toBe(2.5)
  })

  it('ocena N żąda opisania działania korygującego', async () => {
    get.mockResolvedValue({ ...pusty, visual: 'N', kgMatch: 'bz', verdict: 'N',
                            tempChamber: 2, tempMeat: 3, status: 'komplet' })
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    // Dwa trafienia są poprawne: nagłówek bloku i etykieta pola.
    expect((await screen.findAllByText(/działanie korygujące/i)).length).toBeGreaterThan(0)
    expect(screen.getByLabelText(/Opis niezgodności/i)).toBeTruthy()
  })

  it('odmowa przyjęcia pyta o zdjęcie surowca ze stanu', async () => {
    get.mockResolvedValue({ ...pusty, visual: 'bz', kgMatch: 'bz', verdict: 'N',
                            tempChamber: 2, tempMeat: 3, status: 'komplet' })
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText(/anulować przyjęcie/i)).toBeTruthy()
  })
})

describe('ReceptionCheckCard — sloty podpisu', () => {
  it('bez podpisów pokazuje przyciski dla obu ról', async () => {
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText(/Wykonał \(l\)/)).toBeTruthy()
    expect(screen.getByText(/Sprawdził \(m\)/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Podpisz$/ })).toHaveLength(2)
  })

  it('złożony podpis pokazuje nazwisko zamiast przycisku', async () => {
    forDoc.mockResolvedValue([{
      role: 'wykonal', workerId: 'w-1', signerName: 'Jan K.',
      png: 'data:image/png;base64,AA', signedAt: '2026-08-14T07:14:00Z',
    }])
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText('Jan K.')).toBeTruthy()
    // Została JEDNA rola do podpisania, więc jeden przycisk.
    expect(screen.getAllByRole('button', { name: /^Podpisz$/ })).toHaveLength(1)
  })

  it('po zapisie wpisu odświeża podpisy — zapis mógł je unieważnić', async () => {
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    await screen.findByText(/Wykonał \(l\)/)
    forDoc.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /Zapisz kontrolę/i }))
    await waitFor(() => expect(forDoc).toHaveBeenCalled())
  })
})

describe('ReceptionCheckCard — próg obowiązywania', () => {
  it('dostawa sprzed wdrożenia nie jest poganiana', async () => {
    // Właściciel: „wstecz już nie będę uzupełniał, bo mam wersję papierową".
    get.mockResolvedValue({ ...pusty, required: false })
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText(/kontrola prowadzona na papierze/i)).toBeTruthy()
    expect(screen.queryByText(/Uzupełnij kontrolę HACCP/i)).toBeNull()
    expect(screen.queryByText(/brak danych/i)).toBeNull()
  })

  it('mimo to da się ją uzupełnić, gdyby biuro chciało', async () => {
    get.mockResolvedValue({ ...pusty, required: false })
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    await screen.findByText(/kontrola prowadzona na papierze/i)
    expect(screen.getByRole('button', { name: /Zapisz kontrolę/i })).toBeTruthy()
    expect(screen.getByLabelText(/Temperatura komory/i)).toBeTruthy()
  })

  it('nowa dostawa nadal prosi o uzupełnienie', async () => {
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText(/Uzupełnij kontrolę HACCP/i)).toBeTruthy()
  })
})

// ── Temperatura po przecinku ────────────────────────────────────────
// BŁĄD Z PRODUKCJI (02.09.2026): „nie da się dać po przecinku, a musi być,
// bo część rond jest 2,3 stopnia". Pole było sterowane liczbą: wpisany
// przecinek znikał w tej samej chwili (Number("2,") → 2 → z powrotem "2"),
// więc kolejna cyfra dopisywała się do CAŁOŚCI i z 2,3 robiło się 23.
describe('ReceptionCheckCard — temperatura ułamkowa', () => {
  const wpisz = async (id: string, tekst: string) => {
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    const pole = await screen.findByLabelText(new RegExp(id, 'i')) as HTMLInputElement
    // Znak po znaku — tak jak pisze człowiek, bo błąd był właśnie w tym.
    let dotad = ''
    for (const znak of tekst) {
      dotad += znak
      fireEvent.change(pole, { target: { value: dotad } })
      dotad = pole.value
    }
    return pole
  }

  it('przecinek NIE znika w trakcie pisania', async () => {
    const pole = await wpisz('Temperatura mięsa', '2,3')
    expect(pole.value).toBe('2,3')
  })

  it('2,3 zapisuje się jako 2.3, a NIE jako 23', async () => {
    await wpisz('Temperatura mięsa', '2,3')
    fireEvent.click(screen.getByRole('button', { name: /Zapisz/i }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][1].tempMeat).toBe(2.3)
  })

  it('kropka działa tak samo jak przecinek', async () => {
    await wpisz('Temperatura komory', '2.3')
    fireEvent.click(screen.getByRole('button', { name: /Zapisz/i }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][1].tempChamber).toBe(2.3)
  })

  it('temperatura ujemna po przecinku — mrożonka bywa -18,5', async () => {
    const pole = await wpisz('Temperatura mięsa', '-18,5')
    expect(pole.value).toBe('-18,5')
    fireEvent.click(screen.getByRole('button', { name: /Zapisz/i }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][1].tempMeat).toBe(-18.5)
  })

  it('sam minus w trakcie pisania nie jest jeszcze pomiarem', async () => {
    const pole = await wpisz('Temperatura mięsa', '-')
    expect(pole.value).toBe('-')
    fireEvent.click(screen.getByRole('button', { name: /Zapisz/i }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][1].tempMeat).toBeNull()
  })

  it('wyczyszczenie pola to BRAK pomiaru, nie zero', async () => {
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    const pole = await screen.findByLabelText(/Temperatura mięsa/i) as HTMLInputElement
    fireEvent.change(pole, { target: { value: '2,3' } })
    fireEvent.change(pole, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Zapisz/i }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][1].tempMeat).toBeNull()
  })

  it('wartość z bazy pokazuje się po polsku', async () => {
    get.mockResolvedValue({ ...pusty, tempMeat: 2.3 })
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    const pole = await screen.findByLabelText(/Temperatura mięsa/i) as HTMLInputElement
    expect(pole.value).toBe('2,3')
  })
})

// ── Ślad po unieważnionym podpisie ──────────────────────────────────
// BŁĄD Z PRODUKCJI (02.09.2026): „podpisałem wszystkie ok, ale nie ma
// podpisów na karcie". Poprawka danych po podpisaniu unieważniła oba
// podpisy, a kratka wróciła do gołego przycisku — bez słowa wyjaśnienia.
describe('ReceptionCheckCard — podpis unieważniony', () => {
  const uniewazniony = {
    role: 'wykonal', workerId: 'w-1', signerName: 'Jan K.',
    png: null, active: false, signedAt: '2026-09-02T19:32:00Z',
  }

  it('pokazuje, KTO podpisał, mimo unieważnienia', async () => {
    forDoc.mockResolvedValue([uniewazniony])
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText('Jan K.')).toBeTruthy()
  })

  it('mówi wprost, że podpis stracił ważność przez zmianę danych', async () => {
    forDoc.mockResolvedValue([uniewazniony])
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText(/unieważnion/i)).toBeTruthy()
  })

  it('pozwala podpisać ponownie', async () => {
    forDoc.mockResolvedValue([uniewazniony])
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByRole('button', { name: /Podpisz ponownie/i })).toBeTruthy()
  })

  it('NIE rysuje obrazka nieważnego podpisu', async () => {
    forDoc.mockResolvedValue([{ ...uniewazniony, png: 'data:image/png;base64,AAAA' }])
    const { container } = render(
      <ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    await screen.findByText('Jan K.')
    expect(container.querySelectorAll('img').length).toBe(0)
  })

  it('ważny podpis nadal pokazuje obrazek i nie krzyczy o unieważnieniu', async () => {
    forDoc.mockResolvedValue([{ ...uniewazniony, active: true, png: 'data:image/png;base64,AAAA' }])
    const { container } = render(
      <ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    await screen.findByText('Jan K.')
    expect(container.querySelectorAll('img').length).toBe(1)
    expect(screen.queryByText(/unieważnion/i)).toBeNull()
  })

  it('pusta kratka nadal zaprasza do podpisu', async () => {
    forDoc.mockResolvedValue([])
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    const przyciski = await screen.findAllByRole('button', { name: /^Podpisz$/i })
    expect(przyciski.length).toBe(2)
  })
})

// ── Podpis a niezapisane zmiany ─────────────────────────────────────
// BŁĄD Z PRODUKCJI (02.09.2026, druga odsłona): biuro wpisało 2,3/2,2,
// NIE zapisało, podpisało obie kolumny, a potem kliknęło „Zapisz".
// Podpis objął treść SPRZED poprawki (2,0/2,0 — to, co stało w bazie),
// więc zapis natychmiast go unieważnił. Dowód: podpisy 20:11:42 i
// 20:12:07 z hashem 11aaaca4, unieważnione 20:12:09.
//
// Dwie osobne zasady: nie wolno podpisać treści, której nie ma w bazie,
// i nie wolno po cichu skasować ważnego podpisu zapisem.
describe('ReceptionCheckCard — podpis a niezapisane zmiany', () => {
  const zmien = async () => {
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    const pole = await screen.findByLabelText(/Temperatura mięsa/i)
    fireEvent.change(pole, { target: { value: '2,3' } })
  }

  it('niezapisana zmiana BLOKUJE podpis', async () => {
    await zmien()
    const podpisz = screen.getAllByRole('button', { name: /^Podpisz$/i })
    expect(podpisz.every(b => b.hasAttribute('disabled'))).toBe(true)
  })

  it('mówi, dlaczego nie da się podpisać', async () => {
    await zmien()
    expect(screen.getByText(/zapisz.*przed podpisaniem/i)).toBeTruthy()
  })

  it('po zapisaniu podpis znów jest możliwy', async () => {
    await zmien()
    fireEvent.click(screen.getByRole('button', { name: /Zapisz/i }))
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^Podpisz$/i })[0].hasAttribute('disabled'))
        .toBe(false))
  })

  it('bez zmian podpis jest dostępny od razu', async () => {
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    const podpisz = await screen.findAllByRole('button', { name: /^Podpisz$/i })
    expect(podpisz.every(b => b.hasAttribute('disabled'))).toBe(false)
  })
})

describe('ReceptionCheckCard — zapis kasujący ważny podpis', () => {
  const wazny = {
    role: 'wykonal', workerId: 'w-1', signerName: 'Jan K.',
    png: 'data:image/png;base64,AAAA', active: true, signedAt: '2026-09-02T19:32:00Z',
  }
  const zmienIZapisz = async () => {
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    const pole = await screen.findByLabelText(/Temperatura mięsa/i)
    fireEvent.change(pole, { target: { value: '2,3' } })
    fireEvent.click(screen.getByRole('button', { name: /Zapisz/i }))
  }

  it('pyta, zanim unieważni ważny podpis', async () => {
    forDoc.mockResolvedValue([wazny])
    const pytanie = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await zmienIZapisz()
    await waitFor(() => expect(pytanie).toHaveBeenCalled())
    expect(pytanie.mock.calls[0][0]).toMatch(/unieważni/i)
    pytanie.mockRestore()
  })

  it('odmowa NIE zapisuje — dane zostają, podpis też', async () => {
    forDoc.mockResolvedValue([wazny])
    const pytanie = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await zmienIZapisz()
    await waitFor(() => expect(pytanie).toHaveBeenCalled())
    expect(save).not.toHaveBeenCalled()
    pytanie.mockRestore()
  })

  it('zgoda zapisuje', async () => {
    forDoc.mockResolvedValue([wazny])
    const pytanie = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await zmienIZapisz()
    await waitFor(() => expect(save).toHaveBeenCalled())
    pytanie.mockRestore()
  })

  it('wymienia z nazwiska, czyj podpis padnie', async () => {
    forDoc.mockResolvedValue([wazny])
    const pytanie = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await zmienIZapisz()
    await waitFor(() => expect(pytanie).toHaveBeenCalled())
    expect(pytanie.mock.calls[0][0]).toMatch(/Jan K\./)
    pytanie.mockRestore()
  })

  it('bez ważnych podpisów zapisuje BEZ pytania', async () => {
    forDoc.mockResolvedValue([])
    const pytanie = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await zmienIZapisz()
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(pytanie).not.toHaveBeenCalled()
    pytanie.mockRestore()
  })

  it('sam unieważniony podpis nie wywołuje pytania — nie ma czego stracić', async () => {
    forDoc.mockResolvedValue([{ ...wazny, active: false, png: null }])
    const pytanie = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await zmienIZapisz()
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(pytanie).not.toHaveBeenCalled()
    pytanie.mockRestore()
  })
})
