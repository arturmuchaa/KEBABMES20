// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const auth = vi.hoisted(() => ({ loginOffice: vi.fn(), logout: vi.fn(), user: null }))
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => auth }))
const akt = vi.hoisted(() => ({ stan: { wersja: null as string | null, instaluje: false, blad: null as string | null, instaluj: async () => {} }, opcje: [] as unknown[] }))
vi.mock('./aktualizacja', () => ({ useAktualizacja: (o: unknown) => { akt.opcje.push(o); return akt.stan } }))
import { Logowanie } from './Logowanie'
import { ETAPY_ZAKLADU } from './etapy'

afterEach(cleanup)
beforeEach(() => { auth.loginOffice.mockReset(); auth.logout.mockReset(); akt.stan = { wersja: null, instaluje: false, blad: null, instaluj: async () => {} }; akt.opcje = [] })
const haslo = () => screen.getByLabelText('Hasło') as HTMLInputElement

describe('ekran logowania', () => {
  it('włączony Caps Lock w polu hasła → ostrzeżenie; wyłączony → znika', () => {
    render(<Logowanie />)
    fireEvent.keyUp(haslo(), { key: 'A', modifierCapsLock: true })
    expect(screen.getByText('Włączony Caps Lock')).toBeTruthy()
    fireEvent.keyUp(haslo(), { key: 'a', modifierCapsLock: false })
    expect(screen.queryByText('Włączony Caps Lock')).toBeNull()
  })

  it('„Pokaż hasło” odsłania i zasłania wpisane hasło', () => {
    render(<Logowanie />)
    const b = screen.getByRole('button', { name: 'Pokaż hasło' })
    fireEvent.click(b)
    expect(haslo().type).toBe('text')
    expect(b.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(b)
    expect(haslo().type).toBe('password')
  })

  it('złe hasło: komunikat po ludzku zamiast tekstu serwera', async () => {
    auth.loginOffice.mockRejectedValue(new Error('Nieprawidłowe dane logowania'))
    render(<Logowanie />)
    fireEvent.change(screen.getByLabelText('Login'), { target: { value: 'anna' } })
    fireEvent.change(haslo(), { target: { value: 'zle' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zaloguj' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Zły login lub hasło. Sprawdź, czy nie jest włączony Caps Lock.'))
  })

  it('szyna marki ma te same etapy co „Przebieg dnia” na Pulpicie', () => {
    const { container } = render(<Logowanie />)
    expect([...container.querySelectorAll('.ls-rail li')].map(li => li.textContent)).toEqual(ETAPY_ZAKLADU.map(e => e.name))
  })

  it('nowa wersja na ekranie logowania instaluje się sama (nic jeszcze nie wpisano) — z komunikatem', () => {
    akt.stan = { ...akt.stan, wersja: '0.7.1', instaluje: true }
    render(<Logowanie />)
    expect(akt.opcje[0]).toEqual({ auto: true })
    expect(screen.getByText(/Instaluję nową wersję PROTRIMA 0\.7\.1/)).toBeTruthy()
  })

  it('nieudana instalacja — widać powód, logowanie dalej działa', () => {
    akt.stan = { ...akt.stan, wersja: '0.7.1', blad: 'podpis niezgodny' }
    render(<Logowanie />)
    expect(screen.getByText(/Nie udało się zainstalować wersji 0\.7\.1: podpis niezgodny/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Zaloguj' })).toBeTruthy()
  })
})
