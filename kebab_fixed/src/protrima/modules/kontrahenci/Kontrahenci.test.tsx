// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'

/** Dział Kontrahenci — dane w kształcie kartoteki z prod (27.11.2026). */
const clients = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), deactivate: vi.fn() }))
const suppliers = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }))
const company = vi.hoisted(() => ({ gus: vi.fn(), vies: vi.fn() }))
const groups = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), rename: vi.fn(), setMembers: vi.fn(), remove: vi.fn() }))
const vatUe = vi.hoisted(() => ({ sprawdzKlienta: vi.fn(), sprawdzKurs: vi.fn(), historia: vi.fn() }))
const recipes = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), clientsApi: clients, suppliersApi: suppliers, companyApi: company,
  clientGroupsApi: groups, vatUeApi: vatUe, recipesApi: recipes, kontrahenciApi: { propozycjeAdresow: vi.fn(() => Promise.resolve([])), zastosujAdresy: vi.fn() } }))
import { KontrahenciModule } from './KontrahenciModule'

const KLIENCI = [
  { id: 'c1', code: 'K1', name: 'Emin Handels GmbH', displayName: 'YALCIN', nip: 'ATU12345675', country: 'AT', address: 'Hauptplatz 7', postalCode: '4490', city: 'St.Florian-Markt', active: true, createdAt: '', vatUeStatus: 'aktywny', vatUeCheckedAt: '2026-11-27T10:00:00+00:00', vatUeRequestId: 'WAPI1', groupId: null },
  { id: 'c2', code: 'K2', name: 'FUDI SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', displayName: 'FUDI', nip: '1112223334', country: 'PL', address: 'ZALESIE 41F', postalCode: '62-300', city: 'ZALESIE', active: true, createdAt: '', vatUeStatus: '', vatUeCheckedAt: null, vatUeRequestId: '' },
  { id: 'c3', code: 'K3', name: 'BULLI KEBAB, s. r. o.', displayName: 'BULLI', nip: 'SK1020304050', country: 'SK', address: 'Hlavná 1200/4', postalCode: '040 11', city: ' Košice', active: true, createdAt: '', vatUeStatus: 'nieaktywny', vatUeCheckedAt: '2026-11-26T10:00:00+00:00', vatUeRequestId: '' },
]
const DOSTAWCY = [
  { id: 's1', code: 'D1', name: 'KOKO SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', displayName: 'KOKO', nip: '3334445556', country: 'PL', address: 'Rynek 2A', postalCode: '', city: '', vetNumber: '12345678', supplyScope: 'mięso drobiowe', active: true },
]

let cmds: Array<{ id: string; run?: () => void; disabled?: boolean }> = []
const app = { toast: vi.fn(), panel: 'bok', setPanel: vi.fn() } as unknown as AppApi
const mount = () => render(<AppCtx.Provider value={app}><KontrahenciModule active setCtx={() => {}} setCmds={c => { cmds = c }} /></AppCtx.Provider>)
const run = (id: string) => { const c = cmds.find(x => x.id === id); if (!c?.run) throw new Error(`brak komendy ${id}`); c.run() }

afterEach(() => { cleanup(); sessionStorage.clear() })
beforeEach(() => {
  [clients, suppliers, company, groups, vatUe, recipes].forEach(o => Object.values(o).forEach(f => (f as ReturnType<typeof vi.fn>).mockReset()))
  clients.list.mockResolvedValue(KLIENCI); suppliers.list.mockResolvedValue(DOSTAWCY); groups.list.mockResolvedValue([])
  recipes.list.mockResolvedValue([]); vatUe.historia.mockResolvedValue([])
  clients.create.mockImplementation(async (dto: object) => ({ id: 'nowy', code: 'K9', active: true, createdAt: '', ...dto }))
  clients.update.mockImplementation(async (id: string, dto: object) => ({ id, active: true, createdAt: '', ...dto }))
})

describe('Kontrahenci — lista', () => {
  it('odbiorcy z krajem, VAT UE i miastem; przełącznik na dostawców', async () => {
    mount()
    const lista = await screen.findByRole('grid', { name: 'Lista kontrahentów' })
    expect(within(lista).getByText('YALCIN')).toBeTruthy()
    expect(within(lista).getByText('Emin Handels GmbH')).toBeTruthy()
    expect(within(lista).getByText('aktywny 27.11')).toBeTruthy()
    expect(within(lista).getByText('nieaktywny 26.11')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Dostawcy/ }))
    expect(await screen.findByText('KOKO')).toBeTruthy()
    expect(screen.queryByText('YALCIN')).toBeNull()
  })
  it('szukanie bez polskich znaków; filtr „VAT UE nieaktywny”', async () => {
    mount()
    await screen.findByText('YALCIN')
    fireEvent.change(screen.getByLabelText('Szukaj kontrahenta'), { target: { value: 'kosice' } })
    expect(screen.getByText('BULLI')).toBeTruthy()
    expect(screen.queryByText('YALCIN')).toBeNull()
    fireEvent.change(screen.getByLabelText('Szukaj kontrahenta'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /VAT UE nieaktywny/ }))
    expect(screen.getByText('BULLI')).toBeTruthy()
    expect(screen.queryByText('FUDI')).toBeNull()
  })
})

describe('Kontrahenci — dodanie z pobraniem danych', () => {
  it('NIP + Enter → porównanie → przejmij → Enter zapisuje z krajem', async () => {
    company.gus.mockResolvedValue({ nip: '2223334445', nazwa: 'GRASO SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', regon: '1', ulica: 'Jana Kilińskiego 17', kod_pocztowy: '40-001', miasto: 'Katowice', kraj: 'PL', adres: 'JANA KILIŃSKIEGO 17, 40-001 KATOWICE', zrodlo: 'MF' })
    mount()
    await screen.findByText('YALCIN')
    run('new')
    const nr = await screen.findByLabelText('NIP lub VAT UE')
    fireEvent.change(nr, { target: { value: '222-333-44-45' } })
    fireEvent.keyDown(nr, { key: 'Enter' })
    await waitFor(() => expect(company.gus).toHaveBeenCalledWith('2223334445'))
    expect(await screen.findByText(/JANA KILIŃSKIEGO 17, 40-001 KATOWICE/)).toBeTruthy()
    expect(screen.getByText(/wykaz VAT MF/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Przejmij zaznaczone/ }))
    expect((screen.getByLabelText('Ulica i numer') as HTMLInputElement).value).toBe('Jana Kilińskiego 17')
    expect((screen.getByLabelText('Kod pocztowy') as HTMLInputElement).value).toBe('40-001')
    expect((screen.getByLabelText('Miasto') as HTMLInputElement).value).toBe('Katowice')
    fireEvent.change(screen.getByLabelText('Nazwa wyświetlana'), { target: { value: 'GRASO' } })
    fireEvent.keyDown(screen.getByLabelText('Nazwa wyświetlana'), { key: 'Enter' })
    await waitFor(() => expect(clients.create).toHaveBeenCalledTimes(1))
    expect(clients.create.mock.calls[0][0]).toMatchObject({ name: 'GRASO SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', displayName: 'GRASO', nip: '2223334445', country: 'PL', address: 'Jana Kilińskiego 17', postalCode: '40-001', city: 'Katowice', language: 'pl' })
  })
  it('VAT UE z prefiksem → VIES; widać status w VIES', async () => {
    company.vies.mockResolvedValue({ vatNumber: 'DE111222333', countryCode: 'DE', traderName: 'Anka Döner&Foods GmbH', traderAddress: 'Hauptstr. 21\n50667 Köln', valid: true, ulica: 'Hauptstr. 21', kodPocztowy: '50667', miasto: 'Köln', kraj: 'DE', requestIdentifier: 'WAPI7' })
    mount()
    await screen.findByText('YALCIN')
    run('new')
    const nr = await screen.findByLabelText('NIP lub VAT UE')
    fireEvent.change(nr, { target: { value: 'DE111222333' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pobierz' }))
    await waitFor(() => expect(company.vies).toHaveBeenCalledWith('DE111222333'))
    expect(await screen.findByText(/VAT UE aktywny w VIES/)).toBeTruthy()
  })
  it('adres, którego serwer nie rozbił — widać surowy napis, pola puste nie są zaznaczone', async () => {
    company.gus.mockResolvedValue({ nip: '5556667778', nazwa: '"FARMEX" SPÓŁKA Z O.O.', ulica: '', kod_pocztowy: '', miasto: '', kraj: 'PL', adres: 'DZIWNY ADRES BEZ KODU', zrodlo: 'MF' })
    mount()
    await screen.findByText('YALCIN')
    run('new')
    const nr = await screen.findByLabelText('NIP lub VAT UE')
    fireEvent.change(nr, { target: { value: '5556667778' } })
    fireEvent.keyDown(nr, { key: 'Enter' })
    expect(await screen.findByText(/DZIWNY ADRES BEZ KODU/)).toBeTruthy()
    expect(screen.queryByLabelText('Przejmij: Ulica i numer')).toBeNull()
  })
  it('zły numer — komunikat przy polu, bez zapytania', async () => {
    mount()
    await screen.findByText('YALCIN')
    run('new')
    const nr = await screen.findByLabelText('NIP lub VAT UE')
    fireEvent.change(nr, { target: { value: '123' } })
    fireEvent.keyDown(nr, { key: 'Enter' })
    expect(await screen.findByText(/10 cyfr NIP albo numer VAT UE z kodem kraju/)).toBeTruthy()
    expect(company.gus).not.toHaveBeenCalled()
  })
  it('Esc zamyka okno bez zapisu', async () => {
    mount()
    await screen.findByText('YALCIN')
    run('new')
    await screen.findByLabelText('NIP lub VAT UE')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByLabelText('NIP lub VAT UE')).toBeNull())
    expect(clients.create).not.toHaveBeenCalled()
  })
  it('pusta nazwa — błąd przy polu, bez zapisu', async () => {
    mount()
    await screen.findByText('YALCIN')
    run('new')
    const nazwa = await screen.findByLabelText('Pełna nazwa')
    fireEvent.keyDown(nazwa, { key: 'Enter' })
    expect(await screen.findByText(/Wpisz pełną nazwę firmy/)).toBeTruthy()
    expect(clients.create).not.toHaveBeenCalled()
  })
})

describe('Kontrahenci — karta', () => {
  it('pobranie do istniejącej karty nie zaznacza wypełnionych pól', async () => {
    company.gus.mockResolvedValue({ nip: '1112223334', nazwa: 'FUDI SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', regon: '300', ulica: 'Zalesie 41F', kod_pocztowy: '62-300', miasto: 'Zalesie', kraj: 'PL', adres: 'ZALESIE 41F, 62-300 ZALESIE', zrodlo: 'MF' })
    mount()
    fireEvent.click(await screen.findByText('FUDI'))
    run('edit')
    const nr = await screen.findByLabelText('NIP lub VAT UE')
    expect((nr as HTMLInputElement).value).toBe('1112223334')
    fireEvent.keyDown(nr, { key: 'Enter' })
    const ulica = await screen.findByLabelText('Przejmij: Ulica i numer') as HTMLInputElement
    expect(ulica.checked).toBe(false)
    expect((screen.getByLabelText('Przejmij: REGON') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(ulica)
    fireEvent.click(screen.getByRole('button', { name: /Przejmij zaznaczone/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz zmiany' }))
    await waitFor(() => expect(clients.update).toHaveBeenCalledTimes(1))
    expect(clients.update.mock.calls[0][1]).toMatchObject({ regon: '300', address: 'Zalesie 41F', city: 'ZALESIE' })
  })
  it('karta odbiorcy z UE: status VAT UE, „Sprawdź teraz” i historia', async () => {
    vatUe.historia.mockResolvedValue([{ id: 'h1', vatNumber: 'ATU12345675', status: 'aktywny', requestId: 'WAPI1', error: '', context: 'kurs', loadingId: 'k1', orderId: null, wzId: null, operator: 'Biuro', checkedAt: '2026-11-27T10:00:00+00:00', orderNo: null, wzNumber: null, plate: 'KOL47267' }])
    vatUe.sprawdzKlienta.mockResolvedValue({ clientId: 'c1', vatNumber: 'ATU12345675', kraj: 'AT', status: 'aktywny', requestId: 'WAPI2', checkedAt: '2026-11-27T12:00:00+00:00', komunikat: '', ostatniPewny: null })
    mount()
    fireEvent.click(await screen.findByText('YALCIN'))
    fireEvent.click(await screen.findByRole('tab', { name: /VAT UE/ }))
    expect(await screen.findByText(/kurs KOL47267/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź teraz' }))
    await waitFor(() => expect(vatUe.sprawdzKlienta).toHaveBeenCalledWith('c1', { context: 'reczne' }))
    expect(await screen.findByText(/potw\. WAPI2/)).toBeTruthy()
  })
  it('karta dostawcy: WNI i zakres dostaw', async () => {
    mount()
    await screen.findByText('YALCIN')
    fireEvent.click(screen.getByRole('button', { name: /Dostawcy/ }))
    fireEvent.click(await screen.findByText('KOKO'))
    const karta = await screen.findByLabelText('Karta kontrahenta')
    expect(within(karta).getByText('12345678')).toBeTruthy()
    expect(within(karta).getByText('mięso drobiowe')).toBeTruthy()
  })
  it('wejście z innego modułu otwiera kartę wskazanego klienta', async () => {
    sessionStorage.setItem('protrima.kontrahenci.wybrany', 'c3')
    mount()
    const karta = await screen.findByLabelText('Karta kontrahenta')
    expect(within(karta).getByText('BULLI KEBAB, s. r. o.')).toBeTruthy()
    expect(sessionStorage.getItem('protrima.kontrahenci.wybrany')).toBeNull()
  })
})

describe('Kontrahenci — grupy i adresy', () => {
  it('komendy otwierają okna grup i poprawy adresów', async () => {
    mount()
    await screen.findByText('YALCIN')
    run('groups')
    expect(await screen.findByLabelText('Nazwa nowej grupy')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Zamknij' }))
    run('addresses')
    expect(await screen.findByText('Wszystkie adresy wyglądają dobrze')).toBeTruthy()
  })
})
