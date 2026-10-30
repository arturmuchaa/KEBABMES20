// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { SzkieletWierszy, SzkieletBloku } from './Szkielet'
import { Pusto } from './Pusto'

afterEach(cleanup)

describe('ładowanie i pusty widok', () => {
  it('szkielet tabeli: tyle wierszy i kolumn, ile podano, i jeden komunikat dla czytnika ekranu', () => {
    render(<table><tbody><SzkieletWierszy kolumny={5} wiersze={3} /></tbody></table>)
    expect(document.querySelectorAll('tr.sk-row')).toHaveLength(3)
    expect(document.querySelectorAll('tr.sk-row:first-child td')).toHaveLength(5)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status').textContent).toBe('Wczytywanie danych…')
  })
  it('szkielet bloku opisuje, co się wczytuje', () => {
    render(<SzkieletBloku linie={4} opis="Pobieranie kartotek…" />)
    expect(screen.getByRole('status', { name: 'Pobieranie kartotek…' }).querySelectorAll('.sk')).toHaveLength(4)
  })
  it('pusty widok: tytuł, wyjaśnienie i następny krok', () => {
    const akcja = vi.fn()
    render(<Pusto tytul="Brak zamówień w tym widoku" akcja={<button onClick={akcja}>Wyczyść filtry</button>}>Żadne zamówienie nie pasuje do filtrów.</Pusto>)
    expect(screen.getByRole('heading', { name: 'Brak zamówień w tym widoku' })).toBeTruthy()
    expect(screen.getByText('Żadne zamówienie nie pasuje do filtrów.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść filtry' }))
    expect(akcja).toHaveBeenCalled()
  })
})
