// @vitest-environment jsdom
/**
 * Elementy ramy kiosku magazynu.
 *
 * Kafel, alarm i pas skanowania mają test komponentu, bo to jedyne miejsca,
 * przez które magazynier rozmawia z systemem — a reguła repo mówi, że każdy
 * ekran przyjmujący dane operatora dostaje test na to, CO WIDZI człowiek.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Kafel } from './Kafel'
import { Alarm } from './Alarm'
import { PasSkanowania } from './PasSkanowania'

afterEach(cleanup)

describe('Kafel czynności', () => {
  it('pokazuje rzeczownik, czynność i żywy stan', () => {
    render(<Kafel nazwa="WYDANIE" czynnosc="Załaduj auto" glif="⇥"
                  licznik="3" jednostka="zamówienia" stan="na dziś · 1 840 kg"
                  onClick={() => {}} />)
    expect(screen.getByText('WYDANIE')).toBeTruthy()
    expect(screen.getByText('Załaduj auto')).toBeTruthy()
    expect(screen.getByText(/1 840 kg/)).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('wariant jest widoczny w DOM, nie tylko w kolorze', () => {
    const { container } = render(
      <Kafel nazwa="KARTONY" czynnosc="Spakuj" glif="▣" licznik="0"
             stan="zaległe z 18.09" wariant="pilne" onClick={() => {}} />)
    expect(container.querySelector('[data-wariant="pilne"]')).toBeTruthy()
  })

  it('kafel wyłączony nie woła onClick i mówi, dlaczego', () => {
    const fn = vi.fn()
    render(<Kafel nazwa="PRZYJĘCIE" czynnosc="Przyjmij dostawę" glif="⤓"
                  licznik="—" stan="w kolejnym wydaniu" disabled onClick={fn} />)
    fireEvent.click(screen.getByRole('button'))
    expect(fn).not.toHaveBeenCalled()
    expect(screen.getByText('w kolejnym wydaniu')).toBeTruthy()
  })

  it('dotknięcie woła onClick', () => {
    const fn = vi.fn()
    render(<Kafel nazwa="MROŹNIA" czynnosc="Wstaw lub wyjmij" glif="❄"
                  licznik="0" stan="—" onClick={fn} />)
    fireEvent.click(screen.getByRole('button'))
    expect(fn).toHaveBeenCalledOnce()
  })
})

describe('Alarm', () => {
  it('nie renderuje nic, gdy nie ma błędu', () => {
    const { container } = render(<Alarm alarm={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('nazywa skaner, bo przy dwóch trzeba wiedzieć czyj to błąd', () => {
    render(<Alarm alarm={{ skaner: 'L', naglowek: 'NIE MA GDZIE',
      szczegol: 'BULLI · KIRMIZI 10 kg', ton: 'blad', ts: 1 }} />)
    expect(screen.getByText(/SKANER L/)).toBeTruthy()
    expect(screen.getByText('NIE MA GDZIE')).toBeTruthy()
  })

  it('podpowiada, gdzie sztuka należy — błąd ma instruować', () => {
    render(<Alarm alarm={{ skaner: 'L', naglowek: 'JUŻ SPAKOWANA',
      szczegol: "DEM`S · YAPRAK 25 kg", gdzie: 'KARTON 000320',
      ton: 'blad', ts: 2 }} />)
    expect(screen.getByText('KARTON 000320')).toBeTruthy()
  })

  it('ton uwaga jest bursztynowy, nie czerwony', () => {
    const { container } = render(<Alarm alarm={{ skaner: 'L',
      naglowek: 'POZA KOLEJNOŚCIĄ', szczegol: 'POLAT ma 2 z 3',
      ton: 'uwaga', ts: 3 }} />)
    expect(container.querySelector('[data-ton="uwaga"]')).toBeTruthy()
  })
})

describe('Pas skanowania', () => {
  it('Enter wysyła kod i czyści pole', async () => {
    const fn = vi.fn()
    render(<PasSkanowania placeholder="Skanuj kod…" onSkan={fn} />)
    const pole = screen.getByPlaceholderText('Skanuj kod…') as HTMLInputElement
    fireEvent.change(pole, { target: { value: 'PAL|o1|1' } })
    fireEvent.keyDown(pole, { key: 'Enter' })
    await waitFor(() => expect(fn).toHaveBeenCalledWith('PAL|o1|1'))
    expect(pole.value).toBe('')
  })

  it('puste pole nic nie wysyła', () => {
    const fn = vi.fn()
    render(<PasSkanowania placeholder="Skanuj kod…" onSkan={fn} />)
    fireEvent.keyDown(screen.getByPlaceholderText('Skanuj kod…'), { key: 'Enter' })
    expect(fn).not.toHaveBeenCalled()
  })
})
