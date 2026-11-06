// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const auth = vi.hoisted(() => ({ refresh: vi.fn(), logout: vi.fn(), user: { name: 'Anna', must_change_password: true } }))
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => auth }))
const api = vi.hoisted(() => ({ zmienHaslo: vi.fn() }))
vi.mock('./hasloApi', () => api)
import { ZmianaHasla } from './ZmianaHasla'

afterEach(cleanup)
beforeEach(() => { auth.refresh.mockReset(); auth.logout.mockReset(); api.zmienHaslo.mockReset() })
const wpisz = (label: string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } })
const zapisz = () => fireEvent.click(screen.getByRole('button', { name: 'Zmień hasło' }))

describe('zmiana hasła PROTRIMA', () => {
  it('nowe hasło za krótkie albo różne w obu polach — komunikat, bez wysyłania', () => {
    render(<ZmianaHasla wymuszona />)
    wpisz('Obecne hasło', 'stare-haslo'); wpisz('Nowe hasło', 'krotkie'); wpisz('Powtórz nowe hasło', 'krotkie')
    zapisz()
    expect(screen.getByRole('alert').textContent).toBe('Nowe hasło musi mieć co najmniej 8 znaków.')
    wpisz('Nowe hasło', 'dlugie-haslo-1'); wpisz('Powtórz nowe hasło', 'dlugie-haslo-2')
    zapisz()
    expect(screen.getByRole('alert').textContent).toBe('Nowe hasło w obu polach musi być takie samo.')
    expect(api.zmienHaslo).not.toHaveBeenCalled()
  })

  it('złe obecne hasło — słowa serwera; poprawne — zapis i odświeżenie konta (wejście do programu)', async () => {
    api.zmienHaslo.mockRejectedValueOnce(new Error('Błędne aktualne hasło')).mockResolvedValueOnce(undefined)
    const onDone = vi.fn()
    render(<ZmianaHasla wymuszona onDone={onDone} />)
    wpisz('Obecne hasło', 'zle'); wpisz('Nowe hasło', 'nowe-haslo-123'); wpisz('Powtórz nowe hasło', 'nowe-haslo-123')
    zapisz()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Błędne aktualne hasło'))
    wpisz('Obecne hasło', 'dobre')
    zapisz()
    await waitFor(() => expect(auth.refresh).toHaveBeenCalled())
    expect(api.zmienHaslo).toHaveBeenLastCalledWith('dobre', 'nowe-haslo-123')
    expect(onDone).toHaveBeenCalled()
  })

  it('wymuszona: można się wylogować zamiast zmieniać (inne konto przy tym komputerze)', () => {
    render(<ZmianaHasla wymuszona />)
    fireEvent.click(screen.getByRole('button', { name: 'Wyloguj' }))
    expect(auth.logout).toHaveBeenCalled()
  })
})
