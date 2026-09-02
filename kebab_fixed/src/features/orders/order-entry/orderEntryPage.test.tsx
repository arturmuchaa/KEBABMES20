// @vitest-environment jsdom
/**
 * Terminal zamówień — zachowanie w prawdziwym DOM.
 *
 * Czysta logika (model.test.ts) mówi tylko, że carryOver zwraca właściwy
 * obiekt. Tutaj sprawdzamy to, co czuje operator: że po ⏎ rodzaj/receptura/
 * tuleja ZOSTAJĄ na ekranie, kursor stoi już w „Sztuk", a kolejną pozycję
 * wbija się dwiema liczbami. Dokładnie na styku stanu i efektów pękał kiedyś
 * formularz przyjęcia — dlatego ten test istnieje.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// vi.mock jest podnoszone na górę pliku — atrapy muszą powstać wcześniej.
const { create, update } = vi.hoisted(() => ({
  create: vi.fn(async (_dto: any) => ({ id: 'zam1' })),
  update: vi.fn(async (_id: string, _dto: any) => ({ id: 'zam1' })),
}))

vi.mock('@/lib/apiClient', () => ({
  clientsApi:   { list: async () => [
    { id: 'c1', code: 'K1', name: 'Piekarnia Kowalski sp. z o.o.', displayName: '', city: 'Kraków', nip: '1234567890' },
    { id: 'c2', code: 'K2', name: 'Hurt Mięsny Nowak',             displayName: '', city: 'Gdańsk', nip: '9876543210' },
  ] },
  packagingApi: { list: async () => [
    { id: 'tul65', name: 'Tuleja 65 cm', kgAvailable: 400, unit: 'szt' },
    { id: 'tul80', name: 'Tuleja 80 cm', kgAvailable: 120, unit: 'szt' },
  ] },
}))

vi.mock('@/lib/api', () => ({
  clientOrdersApi: { list: async () => [], byId: async () => null, create, update },
}))

// Panel zapotrzebowania strzela do backendu — tu nas nie interesuje.
vi.mock('../order-form/MaterialRequirementsPanel', () => ({
  MaterialRequirementsPanel: () => null,
}))

vi.mock('@/features/products/hooks', () => ({
  useProductTypes: () => ({ productTypes: [
    { id: 'pt1', name: 'Kebab drobiowy' },
    { id: 'pt2', name: 'Kebab wołowy' },
  ] }),
}))

vi.mock('@/features/ingredients/hooks', () => ({
  useRecipes: () => ({ recipes: [
    { id: 'r1', name: 'Drobiowy standard', productTypeId: 'pt1' },
    { id: 'r2', name: 'Drobiowy ostry',    productTypeId: 'pt1' },
    { id: 'r3', name: 'Wołowy standard',   productTypeId: 'pt2' },
  ] }),
}))

import { OrderEntryPage } from './OrderEntryPage'

function pokazTerminal() {
  render(
    <MemoryRouter initialEntries={['/office/zamowienia/nowe']}>
      <Routes>
        <Route path="/office/zamowienia/nowe" element={<OrderEntryPage />} />
        <Route path="/office/zamowienia" element={<div>lista zamówień</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const pole = (nazwa: string) => screen.getByLabelText(nazwa) as HTMLInputElement

/** Wybór z listy: wpisz fragment i zatwierdź — tak jak robi to operator. */
function wybierz(nazwa: string, fragment: string) {
  const el = pole(nazwa)
  fireEvent.focus(el)
  fireEvent.change(el, { target: { value: fragment } })
  fireEvent.keyDown(el, { key: 'Enter' })
}

function wpisz(nazwa: string, wartosc: string) {
  const el = pole(nazwa)
  fireEvent.change(el, { target: { value: wartosc } })
  fireEvent.keyDown(el, { key: 'Enter' })
}

async function wybierzKlienta(nazwa = 'Kowalski') {
  const szukaj = await screen.findByPlaceholderText(/Wpisz nazwę, miasto lub NIP/i)
  fireEvent.change(szukaj, { target: { value: nazwa } })
  fireEvent.keyDown(szukaj, { key: 'Enter' })
  await screen.findByLabelText('Rodzaj')
}

/** Pierwsza pozycja — pełny komplet pól. */
async function wbijPierwszaPozycje() {
  wybierz('Rodzaj', 'Kebab drobiowy')
  wybierz('Receptura', 'ostry')
  wybierz('Tuleja', '65')
  wpisz('Sztuk', '40')
  wpisz('Waga sztuki', '8,5')
}

// jsdom nie zna scrollIntoView, a listy wyboru trzymają nim kursor w widoku.
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn() })
beforeEach(() => { create.mockClear(); update.mockClear() })
afterEach(cleanup)

describe('krok 1 — klient', () => {
  it('zaczyna od wyboru klienta, nie od pozycji', async () => {
    pokazTerminal()
    expect(await screen.findByText('Klient')).toBeTruthy()
    expect(screen.queryByLabelText('Rodzaj')).toBeNull()
  })

  it('po wyborze klient wisi na listwie i nie wraca przy pozycjach', async () => {
    pokazTerminal()
    await wybierzKlienta()
    expect(screen.getByText('Piekarnia Kowalski sp. z o.o.')).toBeTruthy()
    expect(screen.queryByPlaceholderText(/Wpisz nazwę, miasto lub NIP/i)).toBeNull()
  })
})

describe('krok 2 — dziedziczenie pozycji', () => {
  it('⏎ na wadze dopisuje pozycję na paragon', async () => {
    pokazTerminal()
    await wybierzKlienta()
    await wbijPierwszaPozycje()
    await waitFor(() => expect(screen.getAllByTestId('oe-line')).toHaveLength(1))
  })

  it('rodzaj, receptura i tuleja ZOSTAJĄ w polach po zatwierdzeniu', async () => {
    pokazTerminal()
    await wybierzKlienta()
    await wbijPierwszaPozycje()
    await waitFor(() => expect(screen.getAllByTestId('oe-line')).toHaveLength(1))

    expect(pole('Rodzaj').value).toBe('Kebab drobiowy')
    expect(pole('Receptura').value).toBe('Drobiowy ostry')
    expect(pole('Tuleja').value).toBe('Tuleja 65 cm')
  })

  it('czyszczą się WYŁĄCZNIE sztuki i waga', async () => {
    pokazTerminal()
    await wybierzKlienta()
    await wbijPierwszaPozycje()
    await waitFor(() => expect(screen.getAllByTestId('oe-line')).toHaveLength(1))

    expect(pole('Sztuk').value).toBe('')
    expect(pole('Waga sztuki').value).toBe('')
  })

  it('kursor ląduje od razu w „Sztuk"', async () => {
    pokazTerminal()
    await wybierzKlienta()
    await wbijPierwszaPozycje()
    await waitFor(() => expect(document.activeElement).toBe(pole('Sztuk')))
  })

  it('kolejną pozycję wbija się dwiema liczbami', async () => {
    pokazTerminal()
    await wybierzKlienta()
    await wbijPierwszaPozycje()
    await waitFor(() => expect(screen.getAllByTestId('oe-line')).toHaveLength(1))

    wpisz('Sztuk', '10')
    wpisz('Waga sztuki', '12')

    await waitFor(() => expect(screen.getAllByTestId('oe-line')).toHaveLength(2))
    const druga = screen.getAllByTestId('oe-line')[1]
    expect(druga.textContent).toContain('Kebab drobiowy')
    expect(druga.textContent).toContain('Drobiowy ostry')
    expect(druga.textContent).toContain('Tuleja 65 cm')
  })
})

describe('kursor i pomijanie pól', () => {
  it('⏎ w „Sztuk" przechodzi do wagi, nie zatwierdza pozycji', async () => {
    pokazTerminal()
    await wybierzKlienta()
    wybierz('Rodzaj', 'wołowy')
    wpisz('Sztuk', '5')
    await waitFor(() => expect(document.activeElement).toBe(pole('Waga sztuki')))
    expect(screen.queryAllByTestId('oe-line')).toHaveLength(0)
  })

  it('jedyna pasująca receptura wskakuje sama — bez klikania', async () => {
    pokazTerminal()
    await wybierzKlienta()
    wybierz('Rodzaj', 'wołowy')            // pt2 ma tylko r3
    await waitFor(() => expect(pole('Receptura').value).toBe('Wołowy standard'))
    expect(document.activeElement).toBe(pole('Tuleja'))
  })
})

describe('skróty globalne', () => {
  it('F2 wraca do wyboru klienta', async () => {
    pokazTerminal()
    await wybierzKlienta()
    fireEvent.keyDown(window, { key: 'F2' })
    expect(await screen.findByPlaceholderText(/Wpisz nazwę, miasto lub NIP/i)).toBeTruthy()
  })

  it('Ctrl+⏎ zapisuje zamówienie bez sięgania po mysz', async () => {
    pokazTerminal()
    await wybierzKlienta()
    await wbijPierwszaPozycje()
    await waitFor(() => expect(screen.getAllByTestId('oe-line')).toHaveLength(1))

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  })
})

describe('wyjście bez zapisu', () => {
  it('pierwszy „Anuluj" tylko ostrzega, dopiero drugi wychodzi', async () => {
    pokazTerminal()
    await wybierzKlienta()
    await wbijPierwszaPozycje()
    await waitFor(() => expect(screen.getAllByTestId('oe-line')).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: /^Anuluj$/ }))
    const ostrzega = await screen.findByRole('button', { name: /Porzucić\? Kliknij raz jeszcze/ })
    expect(screen.queryByText('lista zamówień')).toBeNull()

    fireEvent.click(ostrzega)
    expect(await screen.findByText('lista zamówień')).toBeTruthy()
  })

  it('pusty terminal wychodzi od razu', async () => {
    pokazTerminal()
    await wybierzKlienta()
    fireEvent.click(screen.getByRole('button', { name: /^Anuluj$/ }))
    expect(await screen.findByText('lista zamówień')).toBeTruthy()
  })
})

describe('zapis', () => {
  it('wysyła jedno zamówienie z klientem i wszystkimi pozycjami', async () => {
    pokazTerminal()
    await wybierzKlienta()
    await wbijPierwszaPozycje()
    await waitFor(() => expect(screen.getAllByTestId('oe-line')).toHaveLength(1))
    wpisz('Sztuk', '10')
    wpisz('Waga sztuki', '12')
    await waitFor(() => expect(screen.getAllByTestId('oe-line')).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: /Zapisz zamówienie/i }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const dto = create.mock.calls[0][0] as any
    expect(dto.clientId).toBe('c1')
    expect(dto.lines).toHaveLength(2)
    // Zapis idzie w kolejności DOKUMENTU, nie wpisywania: w obrębie jednej
    // receptury wagi malejąco, więc 12 kg stoi przed 8,5 kg, choć operator
    // wbił je odwrotnie (reguła kolejności, 2026-09-02).
    expect(dto.lines[0]).toMatchObject({
      qty: 10, kgPerUnit: 12, productTypeId: 'pt1', recipeId: 'r2', packagingId: 'tul65',
      productTypeName: 'Kebab drobiowy', recipeName: 'Drobiowy ostry', packagingName: 'Tuleja 65 cm',
    })
    expect(dto.lines[1]).toMatchObject({ qty: 40, kgPerUnit: 8.5, recipeId: 'r2' })
  })

  it('pozycja dopisana przy edycji wchodzi do swojej grupy, nie na koniec', async () => {
    // Zgłoszenie z biura (zamówienie YALCIN): dopisana pozycja lądowała za
    // wszystkimi pozycjami drugiej receptury i dokument robił się nieczytelny.
    pokazTerminal()
    await wybierzKlienta()
    await wbijPierwszaPozycje()                       // r2, 8,5 kg
    await waitFor(() => expect(screen.getAllByTestId('oe-line')).toHaveLength(1))
    wpisz('Sztuk', '10'); wpisz('Waga sztuki', '3')   // r2, 3 kg — na koniec grupy
    await waitFor(() => expect(screen.getAllByTestId('oe-line')).toHaveLength(2))
    wpisz('Sztuk', '5');  wpisz('Waga sztuki', '20')  // r2, 20 kg — na czoło grupy
    await waitFor(() => expect(screen.getAllByTestId('oe-line')).toHaveLength(3))

    fireEvent.click(screen.getByRole('button', { name: /Zapisz zamówienie/i }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const dto = create.mock.calls[0][0] as any
    expect(dto.lines.map((l: any) => l.kgPerUnit)).toEqual([20, 8.5, 3])
  })

  it('nie gubi wypełnionego, ale niezatwierdzonego wsadu', async () => {
    pokazTerminal()
    await wybierzKlienta()
    wybierz('Rodzaj', 'Kebab drobiowy')
    wybierz('Receptura', 'standard')
    wybierz('Tuleja', 'bez tulei')
    fireEvent.change(pole('Sztuk'), { target: { value: '7' } })
    fireEvent.change(pole('Waga sztuki'), { target: { value: '9' } })

    fireEvent.click(screen.getByRole('button', { name: /Zapisz zamówienie/i }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const dto = create.mock.calls[0][0] as any
    expect(dto.lines).toHaveLength(1)
    expect(dto.lines[0]).toMatchObject({ qty: 7, kgPerUnit: 9 })
  })

  it('bez pozycji nie da się zapisać', async () => {
    pokazTerminal()
    await wybierzKlienta()
    const zapisz = screen.getByRole('button', { name: /Zapisz zamówienie/i }) as HTMLButtonElement
    expect(zapisz.disabled).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })
})

/**
 * Lista pozycji czytała się jako jeden urwany napis „Kebab drobiowy / Drobiowy
 * ostry · Tuleja 65 cm" — przy kilku pozycjach nie dawało się rzucić okiem,
 * co jest czym, a tuleja znikała bez śladu, gdy jej nie było.
 */
describe('pozycje — rodzaj, receptura i tuleja w osobnych kolumnach', () => {
  it('lista ma nagłówek kolumn', async () => {
    pokazTerminal()
    await wybierzKlienta()
    await wbijPierwszaPozycje()
    const naglowek = screen.getByTestId('oe-line-head')
    expect(within(naglowek).getByText('Rodzaj')).toBeTruthy()
    expect(within(naglowek).getByText('Receptura')).toBeTruthy()
    expect(within(naglowek).getByText('Tuleja')).toBeTruthy()
  })

  it('każda z trzech wartości stoi w swojej kolumnie', async () => {
    pokazTerminal()
    await wybierzKlienta()
    await wbijPierwszaPozycje()
    const wiersz = screen.getByTestId('oe-line')
    expect(within(wiersz).getByTestId('oe-col-rodzaj').textContent).toBe('Kebab drobiowy')
    expect(within(wiersz).getByTestId('oe-col-receptura').textContent).toBe('Drobiowy ostry')
    expect(within(wiersz).getByTestId('oe-col-tuleja').textContent).toBe('Tuleja 65 cm')
  })

  it('pozycja bez tulei ma w kolumnie myślnik, a nie pustkę', async () => {
    pokazTerminal()
    await wybierzKlienta()
    wybierz('Rodzaj', 'Kebab drobiowy')
    wybierz('Receptura', 'ostry')
    wybierz('Tuleja', 'bez tulei')
    wpisz('Sztuk', '40')
    wpisz('Waga sztuki', '8,5')
    const wiersz = screen.getByTestId('oe-line')
    expect(within(wiersz).getByTestId('oe-col-tuleja').textContent).toBe('—')
  })
})
