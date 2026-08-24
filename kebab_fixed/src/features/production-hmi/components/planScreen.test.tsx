// @vitest-environment jsdom
/**
 * Komponenty ekranu produkcyjnego — co operator widzi i czym steruje.
 *
 * Kolumny i ich kolejność są przeniesione z KARTY PRODUKCJI, którą hala zna
 * z wydruku. Licznik działa jak w tablecie produkcji: minus, liczba, plus,
 * jeden zapis — BEZ KLAWIATURY (w rękawicy trafia się w duży przycisk).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'

import { PlanList } from './PlanList'
import { LineCounter } from './LineCounter'
import { PlanChangedBanner } from './PlanChangedBanner'
import { BreakOverlay } from './BreakOverlay'
import { DaySummary } from './DaySummary'
import { ShiftStats } from './ShiftStats'
import { WrappingModal } from './WrappingModal'
import type { PlanLineView } from './PlanList'

afterEach(cleanup)

const linia = (over: Partial<PlanLineView> = {}): PlanLineView => ({
  id: 'l1', qty: 20, kgPerUnit: 35, totalKg: 700,
  recipeName: 'WROCŁAW', packagingName: 'Tuleja 120', clientName: 'Bulli sp. z o.o.',
  qtyDone: 12, workerEntries: [], ...over,
})

describe('PlanList', () => {
  it('pokazuje kolumny w kolejności karty produkcji', () => {
    render(<PlanList lines={[linia()]} onPick={() => {}} />)
    const naglowki = screen.getAllByRole('columnheader').map(h => h.textContent?.trim())
    expect(naglowki).toEqual(['Lp', 'Ilość szt.', 'Waga', 'Rodzaj', 'Tuleje', 'Klient', 'Razem', 'Postęp', 'Stan'])
  })

  it('wiersz niesie to, co operator musi wiedzieć', () => {
    render(<PlanList lines={[linia()]} onPick={() => {}} />)
    const w = screen.getAllByRole('row')[1]
    expect(within(w).getByText('20 szt.')).toBeTruthy()
    expect(within(w).getByText('35 kg')).toBeTruthy()
    expect(within(w).getByText('WROCŁAW')).toBeTruthy()
    expect(within(w).getByText('Tuleja 120')).toBeTruthy()
    expect(within(w).getByText('Bulli sp. z o.o.')).toBeTruthy()
    expect(within(w).getByText('700 kg')).toBeTruthy()
  })

  it('postęp pozycji podaje sztuki I procent', () => {
    render(<PlanList lines={[linia()]} onPick={() => {}} />)
    expect(screen.getByText('12 / 20')).toBeTruthy()
    expect(screen.getByText('60%')).toBeTruthy()
  })

  it('pozycja bez klienta to produkcja na magazyn', () => {
    render(<PlanList lines={[linia({ clientName: '' })]} onPick={() => {}} />)
    expect(screen.getByText('— na magazyn —')).toBeTruthy()
  })

  it('gotowa pozycja jest wyróżniona', () => {
    render(<PlanList lines={[linia({ qtyDone: 20 })]} onPick={() => {}} />)
    expect(screen.getByText('Gotowe')).toBeTruthy()
  })

  it('dotknięcie wiersza oddaje jego id', () => {
    const pick = vi.fn()
    render(<PlanList lines={[linia(), linia({ id: 'l2', recipeName: 'BULLI' })]} onPick={pick} />)
    fireEvent.click(screen.getAllByRole('row')[2])
    expect(pick).toHaveBeenCalledWith('l2')
  })

  it('pusty plan mówi wprost, że biuro nic nie zaplanowało', () => {
    render(<PlanList lines={[]} onPick={() => {}} />)
    expect(screen.getByText(/Biuro nie zaplanowało/i)).toBeTruthy()
  })
})

describe('LineCounter', () => {
  const props = () => ({
    line: linia(),
    workers: [{ id: 'w1', name: 'DAWID NOWAK' }, { id: 'w2', name: 'DENYS KOVAL' }],
    selectedWorkerId: 'w1',
    onSelectWorker: vi.fn(),
    onSave: vi.fn(),
    onBack: vi.fn(),
    canSave: true,
  })

  it('NIE ma pola do wpisywania liczby — tylko minus i plus', () => {
    render(<LineCounter {...props()} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.getByRole('button', { name: 'więcej' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'mniej' })).toBeTruthy()
  })

  it('plus podnosi liczbę i przelicza na kilogramy', () => {
    render(<LineCounter {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'więcej' }))
    fireEvent.click(screen.getByRole('button', { name: 'więcej' }))
    expect(screen.getByTestId('licznik').textContent).toBe('3')
    expect(screen.getByText('= 105 kg')).toBeTruthy()
  })

  it('minus nie schodzi poniżej jednej sztuki', () => {
    render(<LineCounter {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'mniej' }))
    expect(screen.getByTestId('licznik').textContent).toBe('1')
  })

  it('plus gaśnie na granicy tego, co zostało do zrobienia', () => {
    render(<LineCounter {...props()} />)  // 12 z 20 → zostało 8
    const plus = screen.getByRole('button', { name: 'więcej' })
    for (let i = 0; i < 20; i++) fireEvent.click(plus)
    expect(screen.getByTestId('licznik').textContent).toBe('8')
    expect((plus as HTMLButtonElement).disabled).toBe(true)
  })


  it('zapis oddaje liczbę sztuk', () => {
    const p = props()
    render(<LineCounter {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'więcej' }))
    fireEvent.click(screen.getByTestId('zapisz'))
    expect(p.onSave).toHaveBeenCalledWith(2)
  })

  it('nazwisko pracownika stoi na przycisku zapisu', () => {
    render(<LineCounter {...props()} />)
    expect(screen.getByTestId('zapisz').textContent).toContain('DAWID')
  })

  it('W TRAKCIE PRZERWY zapis jest zablokowany', () => {
    const p = { ...props(), canSave: false }
    render(<LineCounter {...p} />)
    fireEvent.click(screen.getByTestId('zapisz'))
    expect(p.onSave).not.toHaveBeenCalled()
  })

  it('pokazuje, ile jeszcze zostało', () => {
    render(<LineCounter {...props()} />)
    expect(screen.getByText(/pozostało/i).textContent).toContain('8')
  })

  it('rozlicza, kto ile zrobił z tej pozycji', () => {
    const p = { ...props(), line: linia({ workerEntries: [
      { workerId: 'w1', workerName: 'DAWID', pieces: 8, addedAt: '' },
      { workerId: 'w2', workerName: 'DENYS', pieces: 4, addedAt: '' },
    ] }) }
    render(<LineCounter {...p} />)
    expect(screen.getByText('DAWID — 8 szt.')).toBeTruthy()
    expect(screen.getByText('DENYS — 4 szt.')).toBeTruthy()
  })
})

describe('PlanChangedBanner', () => {
  const zmiany = [
    { kind: 'added' as const, line: { id: 'l2', qty: 10, kgPerUnit: 40, recipeName: 'KIRMIZI', packagingName: '', clientName: '' } },
  ]

  it('nazywa konkret, a nie „plan się zmienił"', () => {
    render(<PlanChangedBanner changes={zmiany} onAck={() => {}} />)
    expect(screen.getByText('doszła KIRMIZI 10×40 kg')).toBeTruthy()
  })

  it('NIE znika sam — trzeba potwierdzić', () => {
    const ack = vi.fn()
    render(<PlanChangedBanner changes={zmiany} onAck={ack} />)
    fireEvent.click(screen.getByRole('button', { name: /Rozumiem/i }))
    expect(ack).toHaveBeenCalled()
  })

  it('bez zmian nie renderuje niczego', () => {
    const { container } = render(<PlanChangedBanner changes={[]} onAck={() => {}} />)
    expect(container.textContent).toBe('')
  })
})

describe('BreakOverlay', () => {
  it('mówi wprost, że liczenie stoi', () => {
    render(<BreakOverlay startedAt="2026-08-25T09:00:00" now="2026-08-25T09:14:00" onEnd={() => {}} />)
    expect(screen.getByText('14 min')).toBeTruthy()
    expect(screen.getByText(/nie zapisze sztuk/i)).toBeTruthy()
  })

  it('wyłącza się przyciskiem operatora', () => {
    const end = vi.fn()
    render(<BreakOverlay startedAt="2026-08-25T09:00:00" now="2026-08-25T09:14:00" onEnd={end} />)
    fireEvent.click(screen.getByRole('button', { name: /Wracam do pracy/i }))
    expect(end).toHaveBeenCalled()
  })
})

describe('DaySummary', () => {
  const stats = {
    perWorker: [], total: { kg: 7190, pieces: 213, kgPerHour: 982, workers: 3, workedMs: 26_400_000 },
  }
  const totals = { kgPlan: 11900, kgDone: 7190, pct: 60, sztPlan: 340, sztDone: 213 }
  const folia = {
    packagingId: 'p1', name: 'Folia stretch', unit: 'rolek', pobrane: 60, zwrocone: 0, zuzyte: 60, moves: [],
  }
  const props = (over: any = {}) => ({
    date: 'wtorek 25.08.2026', totals, stats, material: folia, pausedMs: 3_300_000,
    onFinish: vi.fn(), onClose: vi.fn(), ...over,
  })

  it('podaje liczby w kolejności: kilogramy, sztuki, tempo', () => {
    const { container } = render(<DaySummary {...props()} />)
    const etykiety = [...container.querySelectorAll('span')]
      .map(s => s.textContent?.trim())
      .filter(t => t === 'Wyprodukowano' || t === 'Sztuk' || t === 'Tempo')
    expect(etykiety).toEqual(['Wyprodukowano', 'Sztuk', 'Tempo'])
  })

  it('kilogramy są liczbą główną', () => {
    render(<DaySummary {...props()} />)
    expect(screen.getByText('7190 kg')).toBeTruthy()
    expect(screen.getByText('213 szt.')).toBeTruthy()
    expect(screen.getByText('982 kg/godz.')).toBeTruthy()
  })

  it('zużycie to pobrane minus zwrócone, liczone na żywo', () => {
    render(<DaySummary {...props()} />)
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: 'więcej rolek' }))
    expect(screen.getByTestId('zwrot').textContent).toBe('5')
    expect(screen.getByText('55 rolek')).toBeTruthy()
  })

  it('nie da się zwrócić więcej, niż pobrano', () => {
    render(<DaySummary {...props()} />)
    const plus = screen.getByRole('button', { name: 'więcej rolek' }) as HTMLButtonElement
    for (let i = 0; i < 70; i++) fireEvent.click(plus)
    expect(screen.getByTestId('zwrot').textContent).toBe('60')
    expect(plus.disabled).toBe(true)
  })

  it('zamknięcie dnia oddaje liczbę zwróconych rolek', () => {
    const p = props()
    render(<DaySummary {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'więcej rolek' }))
    fireEvent.click(screen.getByTestId('zakoncz'))
    expect(p.onFinish).toHaveBeenCalledWith(1)
  })

  it('pokazuje czas pracy i sumę przerw', () => {
    render(<DaySummary {...props()} />)
    expect(screen.getByText(/7 godz\. 20 min pracy/)).toBeTruthy()
    expect(screen.getByText(/55 min przerw/)).toBeTruthy()
  })
})

describe('ShiftStats', () => {
  const stats = {
    perWorker: [{ worker: 'DAWID', kg: 1940, pieces: 64, kgPerHour: 746,
                  split: [{ kgPerPiece: 40, pieces: 5 }, { kgPerPiece: 20, pieces: 10 }] }],
    total: { kg: 1940, pieces: 64, kgPerHour: 746, workers: 1, workedMs: 9_360_000 },
  }

  it('kolumny w kolejności kilogramy → sztuki → tempo', () => {
    render(<ShiftStats stats={stats} date="25.08.2026" onClose={() => {}} />)
    expect(screen.getAllByRole('columnheader').map(h => h.textContent?.trim()))
      .toEqual(['Pracownik', 'Kilogramy', 'Sztuki', 'Kg / godz.', 'Co robił'])
  })

  it('rozbija robotę na wagi sztuk', () => {
    render(<ShiftStats stats={stats} date="25.08.2026" onClose={() => {}} />)
    expect(screen.getByText('5 × 40 kg')).toBeTruthy()
    expect(screen.getByText('10 × 20 kg')).toBeTruthy()
  })

  it('pusta zmiana mówi to wprost', () => {
    render(<ShiftStats stats={{ perWorker: [], total: { kg: 0, pieces: 0, kgPerHour: 0, workers: 0, workedMs: 0 } }}
      date="25.08.2026" onClose={() => {}} />)
    expect(screen.getByText(/Jeszcze nikt nic nie zapisał/i)).toBeTruthy()
  })
})

describe('WrappingModal — foliowczycy', () => {
  const workers = [
    { id: 'w3', name: 'VLAD' }, { id: 'w4', name: 'ADAM' }, { id: 'w5', name: 'PIOTR' },
  ]
  const props = (over: any = {}) => ({
    workers, saved: [], kgToday: 8000, onSave: vi.fn(), onClose: vi.fn(), ...over,
  })

  it('„Podziel po równo" dzieli dzień między zaznaczonych', () => {
    render(<WrappingModal {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'VLAD' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADAM' }))
    fireEvent.click(screen.getByRole('button', { name: /Podziel po równo/ }))

    expect(screen.getByTestId('kg-w3').textContent).toBe('4000 kg')
    expect(screen.getByTestId('kg-w4').textContent).toBe('4000 kg')
    expect(screen.getByTestId('suma-foliowania').textContent).toBe('8000 kg')
  })

  it('na trzech dzieli tak, żeby suma się zgadzała co do kilograma', () => {
    render(<WrappingModal {...props({ kgToday: 1000 })} />)
    workers.forEach(w => fireEvent.click(screen.getByRole('button', { name: w.name })))
    fireEvent.click(screen.getByRole('button', { name: /Podziel po równo/ }))
    expect(screen.getByTestId('suma-foliowania').textContent).toBe('1000 kg')
  })

  it('klawiatura numeryczna wpisuje kilogramy wybranej osobie', () => {
    render(<WrappingModal {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'VLAD' }))
    fireEvent.click(screen.getByTestId('kg-w3'))
    ;['4', '5', '00'].forEach(k => fireEvent.click(screen.getByRole('button', { name: k })))
    expect(screen.getByTestId('kg-w3').textContent).toBe('4500 kg')
  })

  it('kasowanie cofa ostatnią cyfrę', () => {
    render(<WrappingModal {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'VLAD' }))
    fireEvent.click(screen.getByTestId('kg-w3'))
    ;['1', '2', '3'].forEach(k => fireEvent.click(screen.getByRole('button', { name: k })))
    fireEvent.click(screen.getByRole('button', { name: 'skasuj' }))
    expect(screen.getByTestId('kg-w3').textContent).toBe('12 kg')
  })

  it('zapis oddaje tylko zaznaczone osoby z ich kilogramami', () => {
    const p = props()
    render(<WrappingModal {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'VLAD' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADAM' }))
    fireEvent.click(screen.getByRole('button', { name: /Podziel po równo/ }))
    fireEvent.click(screen.getByTestId('zapisz-foliowanie'))

    expect(p.onSave).toHaveBeenCalledWith([
      { workerId: 'w3', workerName: 'VLAD', kg: 4000 },
      { workerId: 'w4', workerName: 'ADAM', kg: 4000 },
    ])
  })

  it('bez wpisanych kilogramów zapis jest zablokowany', () => {
    const p = props()
    render(<WrappingModal {...p} />)
    fireEvent.click(screen.getByTestId('zapisz-foliowanie'))
    expect(p.onSave).not.toHaveBeenCalled()
  })

  it('wpis z rana można poprawić — pokazuje zapisane kilogramy', () => {
    render(<WrappingModal {...props({ saved: [{ workerId: 'w3', workerName: 'VLAD', kg: 1200 }] })} />)
    expect(screen.getByTestId('kg-w3').textContent).toBe('1200 kg')
  })
})
