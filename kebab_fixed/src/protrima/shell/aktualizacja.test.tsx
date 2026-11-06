// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import React from 'react'

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), jest: true }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }))
vi.mock('../okno', async orig => ({ ...(await orig() as object), jestTauri: () => tauri.jest }))
import { useAktualizacja } from './aktualizacja'

function Proba({ auto }: { auto?: boolean }) {
  const a = useAktualizacja({ auto })
  return <div>
    <span data-testid="wersja">{a.wersja ?? '—'}</span>
    <span data-testid="stan">{a.instaluje ? 'instaluje' : a.blad ?? 'gotowe'}</span>
    <button onClick={() => void a.instaluj()}>instaluj</button>
  </div>
}
const wersja = () => screen.getByTestId('wersja').textContent
afterEach(cleanup)
beforeEach(() => { tauri.invoke.mockReset(); tauri.jest = true })

describe('aktualizacja PROTRIMA', () => {
  it('w przeglądarce (nie Tauri) nic nie sprawdza', async () => {
    tauri.jest = false
    render(<Proba />)
    await new Promise(r => setTimeout(r, 10))
    expect(tauri.invoke).not.toHaveBeenCalled()
    expect(wersja()).toBe('—')
  })

  it('w trakcie pracy: nowa wersja widoczna, instaluje dopiero na żądanie', async () => {
    tauri.invoke.mockImplementation(async (cmd: string) => (cmd === 'protrima_aktualizacja' ? '0.7.1' : 'ok'))
    render(<Proba />)
    await waitFor(() => expect(wersja()).toBe('0.7.1'))
    expect(tauri.invoke).not.toHaveBeenCalledWith('protrima_zainstaluj')
    await act(async () => { screen.getByRole('button', { name: 'instaluj' }).click() })
    expect(tauri.invoke).toHaveBeenCalledWith('protrima_zainstaluj')
  })

  it('na ekranie logowania (auto): instaluje od razu, bez pytania', async () => {
    tauri.invoke.mockImplementation(async (cmd: string) => (cmd === 'protrima_aktualizacja' ? '0.7.1' : new Promise(() => {})))
    render(<Proba auto />)
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('protrima_zainstaluj'))
    expect(screen.getByTestId('stan').textContent).toBe('instaluje')
  })

  it('brak serwera przy sprawdzaniu — cicho (praca bez przeszkód); błąd instalacji — widoczny', async () => {
    tauri.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'protrima_aktualizacja') throw new Error('error sending request')
      throw new Error('podpis niezgodny')
    })
    render(<Proba />)
    await new Promise(r => setTimeout(r, 10))
    expect(wersja()).toBe('—')
    expect(screen.getByTestId('stan').textContent).toBe('gotowe')
    await act(async () => { screen.getByRole('button', { name: 'instaluj' }).click() })
    await waitFor(() => expect(screen.getByTestId('stan').textContent).toContain('podpis niezgodny'))
  })
})
