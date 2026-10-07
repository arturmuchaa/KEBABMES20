// @vitest-environment jsdom
/**
 * „Nowy karton magazynowy" — karton można założyć „Na magazyn — bez klienta".
 * Klienta i zamówienie biuro przypisuje później z widoku zamówienia, więc pusty
 * clientId to poprawny wybór, a payload nie może udawać klienta znacznikiem z UI.
 *
 * Prawdziwy useApi i komponent; Radix Select/Dialog podmienione na natywne
 * elementy (jsdom nie obsługuje pointer events Radixa), API zamockowane.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@/lib/api', () => ({
  clientsApi: { list: () => Promise.resolve([{ id: 'c1', name: 'DÖNER GMBH' }]) },
  recipesApi: { list: () => Promise.resolve([{ id: 'r1', name: 'KIRMIZI' }]) },
  productTypesApi: { list: () => Promise.resolve([{ id: 'pt1', name: 'KEBAB UDO 100%' }]) },
  packagingApi: { list: () => Promise.resolve([{ id: 't1', name: 'TULEJA 30' }]) },
  finishedGoodsApi: { list: () => Promise.resolve([]) },
  stockCartonsApi: { create: api.create },
}))
vi.mock('@/lib/otworzDokument', () => ({ useOtworzDokument: () => vi.fn() }))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select value={value} onChange={e => onValueChange(e.target.value)}>
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

import { StockCartonModal } from './StockCartonModal'

beforeEach(() => {
  api.create.mockReset()
  api.create.mockResolvedValue({ id: 'sc1' })
})
afterEach(cleanup)

async function otworzIWypelnij() {
  const onCreated = vi.fn()
  render(<StockCartonModal onCreated={onCreated} />)
  fireEvent.click(screen.getByRole('button', { name: /Karton magazynowy/ }))
  // Czekamy, aż słowniki dojdą (opcje w selectach).
  await screen.findByRole('option', { name: 'DÖNER GMBH' })
  await screen.findByRole('option', { name: 'KIRMIZI' })
  await screen.findByRole('option', { name: 'KEBAB UDO 100%' })
  const [klient, receptura, rodzaj, tuleja] = screen.getAllByRole('combobox') as HTMLSelectElement[]
  fireEvent.change(receptura, { target: { value: 'r1' } })
  fireEvent.change(rodzaj, { target: { value: 'pt1' } })
  fireEvent.change(tuleja, { target: { value: 't1' } })
  fireEvent.change(screen.getByPlaceholderText('Ilość (szt)'), { target: { value: '4' } })
  fireEvent.change(screen.getByPlaceholderText('Waga sztuki (kg)'), { target: { value: '20' } })
  return { klient, onCreated }
}

describe('StockCartonModal — klient opcjonalny', () => {
  it('pokazuje jawną opcję „Na magazyn — bez klienta” (domyślną) i opis przypisania później', async () => {
    const { klient } = await otworzIWypelnij()
    expect(screen.getByRole('option', { name: 'Na magazyn — bez klienta' })).toBeTruthy()
    expect(klient.value).toBe('__bez_klienta__')
    expect(document.body.textContent).toMatch(/Klienta i zamówienie można przypisać później/)
  })

  it('zapis bez klienta: payload z pustym clientId i clientName, bez znacznika z UI', async () => {
    const { onCreated } = await otworzIWypelnij()
    const zapisz = screen.getByRole('button', { name: 'Dodaj karton' }) as HTMLButtonElement
    expect(zapisz.disabled).toBe(false)
    fireEvent.click(zapisz)
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1))
    const dto = api.create.mock.calls[0][0]
    expect(dto.clientId).toBe('')
    expect(dto.clientName).toBe('')
    expect(JSON.stringify(dto)).not.toMatch(/bez_klienta/)
    expect(dto.lines).toEqual([{
      recipeId: 'r1', recipeName: 'KIRMIZI', productTypeId: 'pt1', productTypeName: 'KEBAB UDO 100%',
      packagingId: 't1', packagingName: 'TULEJA 30', kgPerUnit: 20, qty: 4,
    }])
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('sc1'))
  })

  it('wybór klienta, a potem powrót do „bez klienta”, daje pusty clientId', async () => {
    const { klient } = await otworzIWypelnij()
    fireEvent.change(klient, { target: { value: 'c1' } })
    fireEvent.change(klient, { target: { value: '__bez_klienta__' } })
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj karton' }))
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1))
    expect(api.create.mock.calls[0][0].clientId).toBe('')
  })

  it('stara ścieżka z klientem działa: clientId i nazwa klienta w payloadzie', async () => {
    const { klient } = await otworzIWypelnij()
    fireEvent.change(klient, { target: { value: 'c1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj karton' }))
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1))
    const dto = api.create.mock.calls[0][0]
    expect(dto.clientId).toBe('c1')
    expect(dto.clientName).toBe('DÖNER GMBH')
  })

  it('bez kompletnej pozycji zapis nadal jest zablokowany', async () => {
    render(<StockCartonModal />)
    fireEvent.click(screen.getByRole('button', { name: /Karton magazynowy/ }))
    await screen.findByRole('option', { name: 'DÖNER GMBH' })
    expect((screen.getByRole('button', { name: 'Dodaj karton' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
