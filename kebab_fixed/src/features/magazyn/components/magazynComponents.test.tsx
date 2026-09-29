// @vitest-environment jsdom
/**
 * Elementy ramy kiosku magazynu.
 *
 * Kafel, alarm i pas skanowania mają test komponentu, bo to jedyne miejsca,
 * przez które magazynier rozmawia z systemem — a reguła repo mówi, że każdy
 * ekran przyjmujący dane operatora dostaje test na to, CO WIDZI człowiek.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { Kafel } from './Kafel'
import { Alarm } from './Alarm'
import { PasSkanowania, type PasSkanowaniaUchwyt, type SkanMeta } from './PasSkanowania'

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
    await waitFor(() => expect(fn).toHaveBeenCalledWith('PAL|o1|1', { ts: expect.any(Number) }))
    expect(pole.value).toBe('')
  })

  it('onSkan dostaje chwilę ODCZYTU, nie chwilę, gdy kolejka doszła do kodu', async () => {
    let teraz = 1_000_000
    const zegar = vi.spyOn(Date, 'now').mockImplementation(() => teraz)
    try {
      let zwolnij!: () => void
      const onSkan = vi.fn<(k: string, meta: SkanMeta) => Promise<void> | undefined>(
        k => (k === 'U|pierwsza' ? new Promise<void>(r => { zwolnij = r }) : undefined))
      const ref = createRef<PasSkanowaniaUchwyt>()
      render(<PasSkanowania ref={ref} placeholder="Skanuj kod…" onSkan={onSkan} onPominiety={vi.fn()} />)
      act(() => ref.current!.dodaj('U|pierwsza'))
      teraz += 300
      act(() => ref.current!.dodaj('U|druga'))
      act(() => ref.current!.dodaj('U|z-menu', 42))
      await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(1))
      teraz += 10_000                                       // wolna sieć
      zwolnij()
      await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(3))
      expect(onSkan.mock.calls.map(c => c[1].ts)).toEqual([1_000_000, 1_000_300, 42])
    } finally { zegar.mockRestore() }
  })

  it('bez onPominiety (załadunek, mroźnia) kolejka zachowuje dawne zachowanie: wysyła mimo blokady', async () => {
    let zwolnij!: () => void
    const onSkan = vi.fn((k: string) => (k === 'PAL|o1|1' ? new Promise<void>(r => { zwolnij = r }) : undefined))
    const ref = createRef<PasSkanowaniaUchwyt>()
    const { rerender } = render(<PasSkanowania ref={ref} placeholder="Skanuj kod…" onSkan={onSkan} />)
    act(() => { ref.current!.dodaj('PAL|o1|1'); ref.current!.dodaj('PAL|o1|2') })
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(1))
    rerender(<PasSkanowania ref={ref} placeholder="Skanuj kod…" onSkan={onSkan} disabled />)
    zwolnij()
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(2))
    expect(onSkan.mock.calls.map(c => c[0])).toEqual(['PAL|o1|1', 'PAL|o1|2'])
  })

  it('kod wstawiony przez ref.dodaj czeka w TEJ SAMEJ kolejce na skan z pola', async () => {
    const poKolei: string[] = []
    let zwolnij!: () => void
    const onSkan = vi.fn((k: string) => {
      poKolei.push(k)
      return k === 'PAL|o1|1' ? new Promise<void>(r => { zwolnij = r }) : undefined
    })
    const ref = createRef<PasSkanowaniaUchwyt>()
    render(<PasSkanowania ref={ref} placeholder="Skanuj kod…" onSkan={onSkan} />)
    const pole = screen.getByPlaceholderText('Skanuj kod…')
    fireEvent.change(pole, { target: { value: 'PAL|o1|1' } })
    fireEvent.keyDown(pole, { key: 'Enter' })
    await waitFor(() => expect(poKolei).toEqual(['PAL|o1|1']))
    act(() => ref.current!.dodaj('U|abc'))
    await new Promise(r => setTimeout(r, 20))
    expect(poKolei).toEqual(['PAL|o1|1'])
    zwolnij()
    await waitFor(() => expect(poKolei).toEqual(['PAL|o1|1', 'U|abc']))
  })

  it('po odmontowaniu skan czekający w kolejce NIE leci — ekran mówi, że trzeba powtórzyć', async () => {
    let zwolnij!: () => void
    const onSkan = vi.fn((k: string) => (k === 'U|pierwsza' ? new Promise<void>(r => { zwolnij = r }) : undefined))
    const onPominiety = vi.fn()
    const ref = createRef<PasSkanowaniaUchwyt>()
    const { unmount } = render(<PasSkanowania ref={ref} placeholder="Skanuj kod…" onSkan={onSkan} onPominiety={onPominiety} />)
    act(() => { ref.current!.dodaj('U|pierwsza'); ref.current!.dodaj('U|druga') })
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(1))
    unmount()
    zwolnij()                                               // wysłane żądanie kończy się normalnie
    await waitFor(() => expect(onPominiety).toHaveBeenCalledWith('U|druga'))
    expect(onSkan).toHaveBeenCalledTimes(1)
  })

  it('zablokowany (dialog) w chwili kolejki — skan pominięty, nie wysłany', async () => {
    let zwolnij!: () => void
    const onSkan = vi.fn((k: string) => (k === 'U|pierwsza' ? new Promise<void>(r => { zwolnij = r }) : undefined))
    const onPominiety = vi.fn()
    const ref = createRef<PasSkanowaniaUchwyt>()
    const { rerender } = render(<PasSkanowania ref={ref} placeholder="Skanuj kod…" onSkan={onSkan} onPominiety={onPominiety} />)
    act(() => { ref.current!.dodaj('U|pierwsza'); ref.current!.dodaj('U|druga') })
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(1))
    rerender(<PasSkanowania ref={ref} placeholder="Skanuj kod…" onSkan={onSkan} onPominiety={onPominiety} disabled />)
    zwolnij()
    await waitFor(() => expect(onPominiety).toHaveBeenCalledWith('U|druga'))
    expect(onSkan).toHaveBeenCalledTimes(1)
  })

  it('dialog otwarty i zamknięty, zanim wolny skan wrócił — czekający skan pominięty, następny działa', async () => {
    let zwolnij!: () => void
    const onSkan = vi.fn((k: string) => (k === 'U|A' ? new Promise<void>(r => { zwolnij = r }) : undefined))
    const onPominiety = vi.fn()
    const ref = createRef<PasSkanowaniaUchwyt>()
    const pas = (disabled: boolean) => (
      <PasSkanowania ref={ref} placeholder="Skanuj kod…" onSkan={onSkan} onPominiety={onPominiety} disabled={disabled} />)
    const { rerender } = render(pas(false))
    act(() => { ref.current!.dodaj('U|A'); ref.current!.dodaj('U|B') })
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(1))
    rerender(pas(true))                                     // menu serwisowe
    rerender(pas(false))                                    // zamknięte, zanim A wróciło
    await act(async () => { zwolnij() })
    await waitFor(() => expect(onPominiety).toHaveBeenCalledWith('U|B'))
    expect(onSkan.mock.calls.map(c => c[0])).toEqual(['U|A'])
    act(() => ref.current!.dodaj('U|C'))
    await waitFor(() => expect(onSkan).toHaveBeenCalledTimes(2))
    expect(onSkan.mock.calls.map(c => c[0])).toEqual(['U|A', 'U|C'])
    expect(onPominiety).toHaveBeenCalledTimes(1)
  })

  it('puste pole nic nie wysyła', () => {
    const fn = vi.fn()
    render(<PasSkanowania placeholder="Skanuj kod…" onSkan={fn} />)
    fireEvent.keyDown(screen.getByPlaceholderText('Skanuj kod…'), { key: 'Enter' })
    expect(fn).not.toHaveBeenCalled()
  })
})
