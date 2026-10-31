// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

/** Ustawienia drukarki: stan jednym spojrzeniem, rzadkie sprawy pod ręką, milimetry schowane. */
const d = vi.hoisted(() => ({ stanDrukarki: vi.fn(), zmienRolke: vi.fn(), drukujTest: vi.fn(), ustawOdrywanie: vi.fn(), wybierzDrukarke: vi.fn(), opisBledu: vi.fn() }))
vi.mock('./drukarka', () => d)
import { PanelDrukarki } from './PanelDrukarki'

const GOTOWA = { nazwa: 'ZDesigner GC420t', uid: 'u1', model: 'GC420t', gotowa: true, problemy: [], rolka: '80 × 100 mm — przyjęcie', skokMm: 102.3, inne: [{ uid: 'u1', nazwa: 'ZDesigner GC420t' }] }
afterEach(cleanup)
beforeEach(() => {
  Object.values(d).forEach(f => f.mockReset()); localStorage.clear()
  d.stanDrukarki.mockResolvedValue(GOTOWA); d.zmienRolke.mockResolvedValue('Drukarka zmierzyła etykietę: 102,6 mm. Gotowa do druku.'); d.ustawOdrywanie.mockResolvedValue(undefined)
})

describe('PanelDrukarki', () => {
  it('gotowa drukarka: nazwa, rolka i skok w jednej linii; wybór drukarki tylko, gdy jest z czego; milimetry zwinięte', async () => {
    render(<PanelDrukarki />)
    expect(await screen.findByText('ZDesigner GC420t · GC420t')).toBeTruthy()
    expect(screen.getByText('Gotowa · rolka 80 × 100 mm · skok 102,3 mm')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByText('Punkt odrywania')).toBeNull()
  })

  it('problem i brak drukarki opisane słowami', async () => {
    d.stanDrukarki.mockResolvedValueOnce({ ...GOTOWA, gotowa: false, problemy: ['Drukarka zgłasza brak papieru.'] })
    render(<PanelDrukarki />)
    expect(await screen.findByText('Drukarka zgłasza brak papieru.')).toBeTruthy()
    d.stanDrukarki.mockResolvedValueOnce({ ...GOTOWA, nazwa: null, uid: null, inne: [], powod: 'Nie widzę drukarki etykiet — sprawdź USB.' })
    fireEvent.click(screen.getByRole('button', { name: /Sprawdź/ }))
    expect(await screen.findByText('Nie widzę drukarki')).toBeTruthy()
    expect(screen.getByText(/sprawdź USB/)).toBeTruthy()
  })

  it('„Zmieniam rolkę” mierzy etykietę; punkt odrywania idzie na drukarkę od razu, przesunięcia tylko do nastawy', async () => {
    render(<PanelDrukarki />)
    await screen.findByText('ZDesigner GC420t · GC420t')
    fireEvent.click(screen.getByRole('button', { name: 'Zmieniam rolkę' }))
    expect(await screen.findByText(/zmierzyła etykietę: 102,6 mm/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Precyzyjne ustawienia/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Przesunięcie w poziomie: więcej' }))
    expect(d.ustawOdrywanie).not.toHaveBeenCalled()
    expect(screen.getByText('+0,5 mm')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Punkt odrywania: mniej' }))
    await waitFor(() => expect(d.ustawOdrywanie).toHaveBeenCalledWith(-0.5))
    expect(JSON.parse(localStorage.getItem('kebab.biuro.zawieszki.kalibracja')!)).toMatchObject({ offsetXMm: 0.5, tearOffMm: -0.5 })
  })

  it('kilka drukarek: wybór zapamiętany na stanowisku', async () => {
    d.stanDrukarki.mockResolvedValue({ ...GOTOWA, inne: [{ uid: 'u1', nazwa: 'ZDesigner GC420t' }, { uid: 'u2', nazwa: 'ZDesigner ZD220' }] })
    render(<PanelDrukarki />)
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'u2' } })
    expect(d.wybierzDrukarke).toHaveBeenCalledWith('u2')
  })
})
