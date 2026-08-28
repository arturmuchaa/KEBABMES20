// @vitest-environment jsdom
/**
 * Grupy odbiorców — okno składu.
 *
 * Jeden kontrahent bywa kilkoma spółkami (YALCIN — dwie, odbiorca wrocławski —
 * pięć oddziałów). Ekran musi robić dwie rzeczy dobrze: wysłać PEŁNY skład
 * (lista jest zastępowana, nie dopisywana) i nie pozwolić wciągnąć spółki,
 * która siedzi już w innej grupie — bo wtedy ta sama sztuka pokrywałaby
 * zamówienia w dwóch pulach naraz.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

const stan = vi.hoisted(() => ({ grupy: [] as any[] }))
const wolania = vi.hoisted(() => ({ sklady: [] as any[], nowe: [] as string[] }))

vi.mock('@/lib/api', () => ({
  clientGroupsApi: {
    list: () => Promise.resolve(JSON.parse(JSON.stringify(stan.grupy))),
    create: (name: string) => { wolania.nowe.push(name); return Promise.resolve({ id: 'g9', name, members: [] }) },
    rename: () => Promise.resolve({}),
    setMembers: (id: string, clientIds: string[]) => {
      wolania.sklady.push({ id, clientIds })
      return Promise.resolve({ id, members: [] })
    },
    remove: () => Promise.resolve({ ok: true }),
  },
}))

import { ClientGroupsModal } from './ClientGroupsModal'

const klienci = [
  { id: 'c1', name: 'YBM Gastro GmbH', displayName: 'YALCIN' },
  { id: 'c2', name: 'Emin Handels GmbH', displayName: 'YALCIN' },
  { id: 'c3', name: 'Truva gastro s.r.o.', displayName: 'TRUVA' },
] as any[]

beforeEach(() => {
  stan.grupy = [{ id: 'g1', name: 'YALCIN', members: [{ id: 'c1', name: 'YBM Gastro GmbH' }] }]
  wolania.sklady = []; wolania.nowe = []
})
afterEach(cleanup)

const otworz = () => render(
  <ClientGroupsModal clients={klienci} onClose={() => {}} onChanged={() => {}} />
)

describe('ClientGroupsModal', () => {
  it('zapisuje PEŁNY skład grupy, nie sam dopisek', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('grupa-sklad-g1'))
    // c1 jest już w grupie, dokładamy c2
    fireEvent.click(screen.getByTestId('klient-c2'))
    fireEvent.click(screen.getByTestId('grupa-zapisz-g1'))

    await waitFor(() => expect(wolania.sklady).toHaveLength(1))
    expect(wolania.sklady[0].id).toBe('g1')
    expect([...wolania.sklady[0].clientIds].sort()).toEqual(['c1', 'c2'])
  })

  it('odznaczenie spółki wypisuje ją ze składu', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('grupa-sklad-g1'))
    fireEvent.click(screen.getByTestId('klient-c1'))       // było zaznaczone
    fireEvent.click(screen.getByTestId('grupa-zapisz-g1'))

    await waitFor(() => expect(wolania.sklady).toHaveLength(1))
    expect(wolania.sklady[0].clientIds).toEqual([])
  })

  it('spółka z innej grupy jest zablokowana i mówi, gdzie siedzi', async () => {
    stan.grupy = [
      { id: 'g1', name: 'YALCIN', members: [] },
      { id: 'g2', name: 'WROCŁAW', members: [{ id: 'c3', name: 'Truva gastro s.r.o.' }] },
    ]
    otworz()
    fireEvent.click(await screen.findByTestId('grupa-sklad-g1'))

    expect((screen.getByTestId('klient-c3') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/już w grupie WROCŁAW/)).toBeTruthy()
  })

  it('nowa grupa zakłada się pod wpisaną nazwą', async () => {
    otworz()
    fireEvent.change(await screen.findByTestId('grupa-nazwa'), { target: { value: '  WROCŁAW ' } })
    fireEvent.click(screen.getByTestId('grupa-dodaj'))

    await waitFor(() => expect(wolania.nowe).toEqual(['WROCŁAW']))
  })

  it('pokazuje spolki nalezace do grupy', async () => {
    otworz()
    const grupa = await screen.findByTestId('grupa-g1')
    expect(within(grupa).getByText('YBM Gastro GmbH')).toBeTruthy()
  })
})
