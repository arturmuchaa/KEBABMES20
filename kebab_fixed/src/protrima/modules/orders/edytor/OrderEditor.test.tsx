// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi, type Cmd } from '../../../shell/context'

/**
 * Edytor zamówienia: ilości, które operator wpisuje, idą do ewidencji —
 * test na zamontowanym komponencie z danymi w kształcie API (syntetycznymi).
 */
const api = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), updateStatus: vi.fn(), byId: vi.fn(),
}))
vi.mock('@/lib/api', () => ({
  clientsApi: { list: () => Promise.resolve([{ id: 'c1', name: 'TEST SP. Z O.O.', displayName: 'TEST', city: 'NYSA' }]) },
  productTypesApi: { list: () => Promise.resolve([{ id: 'pt', name: 'KEBAB UDO 100%' }, { id: 'pm', name: 'KEBAB MIX 70/30' }]) },
  recipesApi: { list: () => Promise.resolve([{ id: 'r1', name: 'BEYAZ', productTypeId: 'pt' }, { id: 'r2', name: 'KIRMIZI', productTypeId: 'pt' }, { id: 'r3', name: 'MIX OSTRY', productTypeId: 'pm' }]) },
  packagingApi: { list: () => Promise.resolve([{ id: 'pk', name: 'METAL 65CM' }]) },
  clientOrdersApi: api,
  materialRequirementsApi: { preview: () => Promise.resolve({ lines: [], totalsByRaw: [], yieldPct: 70 }) },
}))
const refresh = vi.fn(() => Promise.resolve())
vi.mock('../../../data/store', () => ({ useOrders: () => ({ refresh }) }))
import { OrderEditor } from './OrderEditor'
import { dzisIso, najblizszeDni, poDniach } from './model'

afterEach(cleanup)
const toast = vi.fn()
beforeEach(() => { Object.values(api).forEach(f => f.mockReset()); refresh.mockClear(); toast.mockClear() })
const app = { toast, setPanel: vi.fn(), prosty: true, panel: 'dol', appRef: { current: null }, scale: 1 } as unknown as AppApi
let cmds: Cmd[] = []
const mount = (p: Partial<React.ComponentProps<typeof OrderEditor>> = {}) => {
  const onDone = vi.fn()
  render(<AppCtx.Provider value={app}><OrderEditor tabId="t" active setCmds={c => { cmds = c }} onDone={onDone} {...p} /></AppCtx.Provider>)
  return { onDone }
}
const run = (id: string) => cmds.find(c => c.id === id)!.run!()
const cmd = (id: string) => cmds.find(c => c.id === id)
/** Przycisk na pasku poleceń edytora (CommandBar renderuje się w karcie). */
const naPasku = (name: string) => within(screen.getByRole('toolbar')).getByRole('button', { name })
const typ = (label: string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } })
const pole = (label: string) => screen.getByLabelText(label) as HTMLInputElement
/** Jak biuro: kilka liter w polu wyboru i Enter (czeka, aż kartoteki dojdą i pozycja się pokaże). */
async function wybierz(label: string, tekst: string, pozycja: RegExp) {
  await new Promise(r => requestAnimationFrame(r)) // poprzedni wybór przenosi kursor w następnej klatce
  const el = pole(label)
  el.focus()
  fireEvent.change(el, { target: { value: tekst } })
  await screen.findByRole('option', { name: pozycja })
  fireEvent.keyDown(el, { key: 'Enter' })
}

describe('OrderEditor', () => {
  it('nowe zamówienie: wybór przenosi kursor, Enter w ilości — następna pozycja z rodzajem, recepturą i tuleją; zapis szkicu wysyła DTO', async () => {
    api.create.mockResolvedValue({ id: 'new1', orderNo: 'TEST/Z/1/10/26', status: 'draft' })
    const { onDone } = mount()
    await wybierz('Klient', 'tes', /TEST/)
    await waitFor(() => expect(document.activeElement?.id).toBe('t-termin'))
    await wybierz('Rodzaj, pozycja 1', 'udo', /KEBAB UDO/)
    await waitFor(() => expect(document.activeElement).toBe(pole('Receptura, pozycja 1')))
    await wybierz('Receptura, pozycja 1', 'bey', /BEYAZ/)
    await wybierz('Tuleja, pozycja 1', 'met', /METAL 65CM/)
    await waitFor(() => expect(document.activeElement).toBe(pole('Gramatura kg, pozycja 1')))
    expect(screen.queryByLabelText('Rodzaj, pozycja 2')).toBeNull() // następna pozycja dopiero pod kompletną
    typ('Gramatura kg, pozycja 1', '7,5'); typ('Ilość sztuk, pozycja 1', '100')
    expect(pole('Rodzaj, pozycja 2').value).toBe('KEBAB UDO 100%')
    expect(pole('Receptura, pozycja 2').value).toBe('BEYAZ')
    expect(pole('Tuleja, pozycja 2').value).toBe('METAL 65CM')
    expect(pole('Gramatura kg, pozycja 2').value).toBe('')
    fireEvent.keyDown(pole('Ilość sztuk, pozycja 1'), { key: 'Enter' })
    await waitFor(() => expect(document.activeElement).toBe(pole('Gramatura kg, pozycja 2')))
    typ('Gramatura kg, pozycja 2', '10')
    fireEvent.keyDown(pole('Gramatura kg, pozycja 2'), { key: 'Enter' })
    await waitFor(() => expect(document.activeElement).toBe(pole('Ilość sztuk, pozycja 2')))
    typ('Ilość sztuk, pozycja 2', '40')
    fireEvent.keyDown(pole('Ilość sztuk, pozycja 2'), { key: 'Enter' }) // trzeci wiersz czeka pusty — nie jest pozycją
    expect(pole('Receptura, pozycja 3').value).toBe('BEYAZ')
    run('save')
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1))
    const dto = api.create.mock.calls[0][0]
    expect(dto.clientId).toBe('c1')
    expect(dto.lines.map((l: { qty: number; kgPerUnit: number; recipeName: string; packagingName?: string; id?: string }) => [l.qty, l.kgPerUnit, l.recipeName, l.packagingName, l.id]))
      .toEqual([[100, 7.5, 'BEYAZ', 'METAL 65CM', undefined], [40, 10, 'BEYAZ', 'METAL 65CM', undefined]])
    expect(api.updateStatus).not.toHaveBeenCalled()
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('new1'))
    expect(refresh).toHaveBeenCalled()
    // Szkic nie trafia do planowania — ostrzeżenie, nie zwykłe „zapisano”.
    // Numer w tytule (pełny rozmiar), miary w opisie.
    expect(toast).toHaveBeenCalledWith({ kind: 'warn', title: 'Szkic TEST/Z/1/10/26 — nie trafi do planowania',
      detail: '2 poz. · 140 szt. · 1\u00a0150 kg. Potwierdź je w panelu zamówienia.' })
  })

  it('Enter w ilości niekompletnej pozycji wraca do brakującego pola', async () => {
    mount()
    await wybierz('Rodzaj, pozycja 1', 'udo', /KEBAB UDO/)
    typ('Gramatura kg, pozycja 1', '20'); typ('Ilość sztuk, pozycja 1', '5')
    fireEvent.keyDown(pole('Ilość sztuk, pozycja 1'), { key: 'Enter' })
    await waitFor(() => expect(document.activeElement).toBe(pole('Receptura, pozycja 1')))
    expect(screen.queryByLabelText('Rodzaj, pozycja 2')).toBeNull()
  })

  it('zmiana rodzaju kasuje recepturę z innego rodzaju', async () => {
    mount()
    await wybierz('Rodzaj, pozycja 1', 'udo', /KEBAB UDO/)
    await wybierz('Receptura, pozycja 1', 'kir', /KIRMIZI/)
    await wybierz('Rodzaj, pozycja 1', 'mix', /KEBAB MIX/)
    expect(pole('Receptura, pozycja 1').value).toBe('')
  })

  it('błędna ilość blokuje zapis i jest pokazana przy pozycji', async () => {
    mount()
    await wybierz('Klient', 'tes', /TEST/); await wybierz('Rodzaj, pozycja 1', 'udo', /KEBAB UDO/); await wybierz('Receptura, pozycja 1', 'bey', /BEYAZ/)
    typ('Gramatura kg, pozycja 1', '20'); typ('Ilość sztuk, pozycja 1', '2,5')
    run('save')
    expect(await screen.findByText(/liczba całkowita sztuk/)).toBeTruthy()
    expect(api.create).not.toHaveBeenCalled()
  })

  it('„Zapisz i potwierdź” — tworzy i potwierdza', async () => {
    api.create.mockResolvedValue({ id: 'n2', orderNo: 'X', status: 'draft' })
    mount()
    await wybierz('Klient', 'nysa', /TEST/); await wybierz('Rodzaj, pozycja 1', 'udo', /KEBAB UDO/); await wybierz('Receptura, pozycja 1', 'kir', /KIRMIZI/)
    typ('Gramatura kg, pozycja 1', '25'); typ('Ilość sztuk, pozycja 1', '8')
    run('save-confirm')
    await waitFor(() => expect(api.updateStatus).toHaveBeenCalledWith('n2', 'confirmed'))
  })

  it('edycja: formularz z zamówienia, zmiana ilości, zapis z id pozycji (palety zostają przypięte)', async () => {
    api.byId.mockResolvedValue({ id: 'o1', orderNo: 'TEST/Z/2/10/26', clientId: 'c1', orderDate: '2026-10-28', deliveryDate: '2026-11-02', status: 'confirmed', notes: '',
      lines: [{ id: 'L1', qty: 20, kgPerUnit: 25, productTypeId: 'pt', recipeId: 'r1', packagingId: 'pk', notes: '' }] })
    api.update.mockResolvedValue({ id: 'o1', orderNo: 'TEST/Z/2/10/26', status: 'confirmed' })
    mount({ orderId: 'o1' })
    await waitFor(() => expect((screen.getByLabelText('Ilość sztuk, pozycja 1') as HTMLInputElement).value).toBe('20'))
    await waitFor(() => expect(pole('Klient').value).toBe('TEST'))
    expect(pole('Receptura, pozycja 1').value).toBe('BEYAZ')
    typ('Ilość sztuk, pozycja 1', '24')
    run('save')
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1))
    expect(api.update.mock.calls[0][0]).toBe('o1')
    expect(api.update.mock.calls[0][1].lines[0]).toMatchObject({ id: 'L1', qty: 24, kgPerUnit: 25 })
    expect(cmds.some(c => c.id === 'save-confirm')).toBe(false)
  })

  it('odmowa serwera pokazana jego słowami', async () => {
    api.byId.mockResolvedValue({ id: 'o1', orderNo: 'Z', clientId: 'c1', orderDate: '2026-10-28', status: 'confirmed', lines: [{ id: 'L1', qty: 20, kgPerUnit: 25, productTypeId: 'pt', recipeId: 'r1' }] })
    api.update.mockRejectedValue(new Error('Zamówienie ma wystawiony WM — najpierw anuluj dokument'))
    mount({ orderId: 'o1' })
    await waitFor(() => expect((screen.getByLabelText('Ilość sztuk, pozycja 1') as HTMLInputElement).value).toBe('20'))
    run('save')
    expect(await screen.findByText(/wystawiony WM/)).toBeTruthy()
  })

  it('zamówienie zrealizowane: edycja zablokowana', async () => {
    api.byId.mockResolvedValue({ id: 'o1', orderNo: 'Z', clientId: 'c1', orderDate: '2026-10-28', status: 'done', lines: [{ id: 'L1', qty: 20, kgPerUnit: 25, productTypeId: 'pt', recipeId: 'r1' }] })
    mount({ orderId: 'o1' })
    expect(await screen.findByText(/tylko zamówienie w statusie Szkic lub Potwierdzone/)).toBeTruthy()
    expect((screen.getByLabelText('Ilość sztuk, pozycja 1') as HTMLInputElement).disabled).toBe(true)
  })
  /** Klient + jedna kompletna pozycja (jak biuro z klawiatury). */
  const wypelnij = async () => {
    await wybierz('Klient', 'tes', /TEST/); await wybierz('Rodzaj, pozycja 1', 'udo', /KEBAB UDO/); await wybierz('Receptura, pozycja 1', 'bey', /BEYAZ/)
    typ('Gramatura kg, pozycja 1', '25'); typ('Ilość sztuk, pozycja 1', '8')
  }

  it('Ctrl+Enter = „Zapisz i potwierdź” (jak „Przyjmij dostawę” w przyjęciu); skróty widać na przyciskach paska', async () => {
    api.create.mockResolvedValue({ id: 'n3', orderNo: 'X/3', status: 'draft' })
    mount()
    await wypelnij()
    expect(naPasku('Zapisz i potwierdź').textContent).toContain('Ctrl+Enter')
    expect(naPasku('Zapisz szkic').textContent).toContain('Ctrl+S')
    expect(screen.getByText(/Ctrl\+Enter — zapisz i potwierdź · Ctrl\+S — zapisz szkic/)).toBeTruthy()
    fireEvent.keyDown(pole('Ilość sztuk, pozycja 1'), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(api.updateStatus).toHaveBeenCalledWith('n3', 'confirmed'))
    expect(api.create).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok', title: 'Utworzono X/3' })))
  })

  it('Ctrl+S = „Zapisz szkic” — bez potwierdzenia, z ostrzeżeniem', async () => {
    api.create.mockResolvedValue({ id: 'n4', orderNo: 'X/4', status: 'draft' })
    mount()
    await wypelnij()
    fireEvent.keyDown(pole('Ilość sztuk, pozycja 1'), { key: 's', ctrlKey: true })
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'warn', title: expect.stringMatching(/^Szkic .* — nie trafi do planowania$/) })))
    expect(api.updateStatus).not.toHaveBeenCalled()
  })

  it('AltGr (Ctrl+Alt) to polska litera, nie skrót — nic się nie zapisuje', async () => {
    mount()
    await wypelnij()
    fireEvent.keyDown(pole('Ilość sztuk, pozycja 1'), { key: 's', ctrlKey: true, altKey: true })
    fireEvent.keyDown(pole('Ilość sztuk, pozycja 1'), { key: 'Enter', ctrlKey: true, altKey: true })
    await new Promise(r => setTimeout(r, 30))
    expect(api.create).not.toHaveBeenCalled()
  })

  it('potwierdzone: Ctrl+Enter i Ctrl+S = „Zapisz zmiany” (nie ma „Zapisz szkic”), bez zmiany statusu', async () => {
    api.byId.mockResolvedValue({ id: 'o1', orderNo: 'TEST/Z/2/10/26', clientId: 'c1', orderDate: '2026-10-28', deliveryDate: '2026-11-02', status: 'confirmed', notes: '',
      lines: [{ id: 'L1', qty: 20, kgPerUnit: 25, productTypeId: 'pt', recipeId: 'r1', packagingId: 'pk', notes: '' }] })
    api.update.mockResolvedValue({ id: 'o1', orderNo: 'TEST/Z/2/10/26', status: 'confirmed' })
    mount({ orderId: 'o1' })
    await waitFor(() => expect(pole('Ilość sztuk, pozycja 1').value).toBe('20'))
    expect(cmd('save')).toMatchObject({ label: 'Zapisz zmiany', kbd: 'Ctrl+Enter', primary: true })
    expect(screen.getByText(/Ctrl\+Enter albo Ctrl\+S — zapisz zmiany/)).toBeTruthy()
    typ('Ilość sztuk, pozycja 1', '24')
    fireEvent.keyDown(pole('Ilość sztuk, pozycja 1'), { key: 's', ctrlKey: true })
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1))
    expect(api.updateStatus).not.toHaveBeenCalled()
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok', title: 'Zapisano TEST/Z/2/10/26' })))
  })

  it('paleta poleceń (Ctrl+K) albo okno nad edytorem: Ctrl+S i Ctrl+Enter nie zapisują w tle', async () => {
    api.byId.mockResolvedValue({ id: 'o1', orderNo: 'TEST/Z/2/10/26', clientId: 'c1', orderDate: '2026-10-28', deliveryDate: '2026-11-02', status: 'confirmed', notes: '',
      lines: [{ id: 'L1', qty: 20, kgPerUnit: 25, productTypeId: 'pt', recipeId: 'r1', packagingId: 'pk', notes: '' }] })
    mount({ orderId: 'o1' })
    await waitFor(() => expect(pole('Ilość sztuk, pozycja 1').value).toBe('20'))
    typ('Ilość sztuk, pozycja 1', '24')
    const paleta = document.createElement('div'); paleta.className = 'overlay'; paleta.textContent = 'paleta'
    document.body.appendChild(paleta)
    paleta.getClientRects = () => ({ length: 1 }) as unknown as DOMRectList
    fireEvent.keyDown(pole('Ilość sztuk, pozycja 1'), { key: 's', ctrlKey: true })
    fireEvent.keyDown(pole('Ilość sztuk, pozycja 1'), { key: 'Enter', ctrlKey: true })
    await new Promise(r => setTimeout(r, 30))
    expect(api.update).not.toHaveBeenCalled()
    paleta.remove()
  })

  it('zapis zablokowany, dopóki czegoś brakuje: powód w dymku tym tonem co w przyjęciu, klik w przycisk przenosi kursor do braku', async () => {
    mount()
    await waitFor(() => expect(cmd('save-confirm')?.tip).toBe('wybierz klienta (i jeszcze 1 brak)'))
    expect(cmd('save-confirm')?.disabled).toBe(true)
    expect(cmd('save')?.disabled).toBe(true)
    const b = naPasku('Zapisz i potwierdź')
    expect(b.getAttribute('aria-disabled')).toBe('true')
    expect(b.getAttribute('data-tip')).toBe('Zapisz i potwierdź: wybierz klienta (i jeszcze 1 brak)')
    pole('Rodzaj, pozycja 1').focus()
    fireEvent.click(b)
    await waitFor(() => expect(document.activeElement).toBe(pole('Klient')))
    expect(screen.getByText('Wybierz klienta.')).toBeTruthy()
    expect(api.create).not.toHaveBeenCalled()
    await wybierz('Klient', 'tes', /TEST/)
    await waitFor(() => expect(cmd('save-confirm')?.tip).toBe('wpisz pierwszą pozycję'))
    // Skrót przy brakach też prowadzi do braku (w przyjęciu milczał).
    fireEvent.keyDown(pole('Termin wyjazdu'), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(document.activeElement).toBe(pole('Rodzaj, pozycja 1')))
    await wybierz('Rodzaj, pozycja 1', 'udo', /KEBAB UDO/); await wybierz('Receptura, pozycja 1', 'bey', /BEYAZ/)
    typ('Gramatura kg, pozycja 1', '25')
    await waitFor(() => expect(cmd('save-confirm')?.tip).toBe('poz. 1 — wpisz ilość'))
    typ('Ilość sztuk, pozycja 1', '8')
    await waitFor(() => expect(cmd('save-confirm')?.disabled).toBe(false))
    expect(naPasku('Zapisz i potwierdź').getAttribute('data-tip')).toBeNull()
  })

  it('termin wyjazdu: Dziś / Jutro / Pojutrze, litera w polu daty i najbliższy dzień tygodnia z listy', async () => {
    mount()
    await screen.findByRole('group', { name: 'Szybki wybór terminu wyjazdu' })
    const termin = pole('Termin wyjazdu')
    expect(screen.getByText(/Bez terminu zamówienie trafi na Pulpicie/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Jutro' }))
    expect(termin.value).toBe(poDniach(dzisIso(), 1))
    expect(screen.getByRole('button', { name: 'Jutro' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(/^jutro · /)).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(pole('Rodzaj, pozycja 1'))) // wybrany termin — dalej do pozycji
    fireEvent.keyDown(termin, { key: 'p' })
    expect(termin.value).toBe(poDniach(dzisIso(), 2))
    expect(screen.getByRole('button', { name: 'Pojutrze' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Dzień tygodnia' }))
    const dzien = najblizszeDni(dzisIso())[4]
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: new RegExp(`${dzien.dzien} ${dzien.dzienMies}`) }))
    expect(termin.value).toBe(dzien.iso)
    expect(screen.getByRole('button', { name: `Dzień tygodnia: ${dzien.dzien} ${dzien.dzienMies}` }).getAttribute('aria-pressed')).toBe('true')
  })

  it('„Zamknij bez zapisu” (nie „Odrzuć”) — przy zmianach okno pyta tym samym słowem', async () => {
    const { onDone } = mount()
    await wybierz('Klient', 'tes', /TEST/)
    expect(screen.queryByRole('button', { name: /Odrzuć/ })).toBeNull()
    fireEvent.click(naPasku('Zamknij bez zapisu'))
    const okno = await screen.findByRole('dialog', { name: 'Zamknąć bez zapisu?' })
    fireEvent.click(within(okno).getByRole('button', { name: 'Zamknij bez zapisu' }))
    expect(onDone).toHaveBeenCalledWith()
  })
})
