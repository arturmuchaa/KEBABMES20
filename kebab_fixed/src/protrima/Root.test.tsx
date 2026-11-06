// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'

const auth = vi.hoisted(() => ({ stan: { user: null as null | Record<string, unknown>, loading: false } }))
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ ...auth.stan, refresh: vi.fn(), logout: vi.fn(), loginOffice: vi.fn() }) }))
vi.mock('./App', () => ({ App: () => <div>PROGRAM</div> }))
vi.mock('./data/store', () => ({ OrdersProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('./shell/aktualizacja', () => ({ useAktualizacja: () => ({ wersja: null, instaluje: false, blad: null, instaluj: async () => {} }) }))
import { ProtrimaRoot } from './Root'

afterEach(cleanup)
const konto = (o: Record<string, unknown>) => ({ id: 'u1', name: 'Anna', kind: 'office', role: 'office', must_change_password: false, departments: [], ...o })

describe('bramka PROTRIMA', () => {
  it('konto z wymuszoną zmianą hasła widzi zmianę hasła, nie program (jak stary MES)', () => {
    auth.stan = { user: konto({ must_change_password: true }), loading: false }
    render(<ProtrimaRoot />)
    expect(screen.getByRole('heading', { name: 'Ustaw nowe hasło' })).toBeTruthy()
    expect(screen.queryByText('PROGRAM')).toBeNull()
  })

  it('zwykłe konto biura — program', () => {
    auth.stan = { user: konto({}), loading: false }
    render(<ProtrimaRoot />)
    expect(screen.getByText('PROGRAM')).toBeTruthy()
  })
})
