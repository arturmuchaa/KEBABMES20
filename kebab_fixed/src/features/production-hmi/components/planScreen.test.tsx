// @vitest-environment jsdom
/**
 * Komponenty ekranu produkcyjnego — co operator widzi i czym steruje.
 *
 * Kolumny i ich kolejność są przeniesione z KARTY PRODUKCJI, którą hala zna
 * z wydruku. Licznik działa jak w tablecie produkcji: minus, liczba, plus,
 * jeden zapis — BEZ KLAWIATURY (w rękawicy trafia się w duży przycisk).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'

import { PlanList } from './PlanList'
import { LineCounter } from './LineCounter'
import { LineDetails } from './LineDetails'

// jsdom 25 nie zna PointerEvent — bez tego `fireEvent.pointerDown` tworzy
// goły Event bez współrzędnych i przycisku.
if (typeof (window as any).PointerEvent === 'undefined') {
  ;(window as any).PointerEvent = class extends MouseEvent {
    pointerId: number
    constructor(type: string, init: any = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 }
  }
}
import { PlanChangedBanner } from './PlanChangedBanner'
import { BreakOverlay } from './BreakOverlay'
import { DaySummary } from './DaySummary'
import { ShiftStats } from './ShiftStats'
import { WrappingModal } from './WrappingModal'
import { PackagingPicker } from './PackagingPicker'
import { MovePiecesModal } from './MovePiecesModal'
import type { PlanLineView } from './PlanList'

afterEach(cleanup)

const linia = (over: Partial<PlanLineView> = {}): PlanLineView => ({
  id: 'l1', qty: 20, kgPerUnit: 35, totalKg: 700,
  recipeName: 'WROCŁAW', packagingName: 'Tuleja 120', clientName: 'Bulli sp. z o.o.',
  qtyDone: 12, workerEntries: [], ...over,
})

const wiersz = (id: string) => screen.getByTestId(`pozycja-planu-${id}`)

describe('PlanList', () => {
  it('wiersz niesie numer, „ilość × waga", rodzaj, klienta i tuleję', () => {
    render(<PlanList lines={[linia(), linia({ id: 'l2', recipeName: 'BULLI' })]} onPick={() => {}} />)
    const w = wiersz('l2')
    expect(w.textContent).toMatch(/^2/)                          // numer pozycji
    expect(within(w).getByText('20 × 35 kg')).toBeTruthy()
    expect(within(w).getByText('BULLI')).toBeTruthy()
    expect(w.textContent).toContain('Bulli sp. z o.o.')
    expect(w.textContent).toContain('Tuleja 120')
  })

  it('postęp pozycji: zrobione / plan', () => {
    render(<PlanList lines={[linia()]} onPick={() => {}} />)
    expect(screen.getByTestId('postep-l1').textContent).toBe('12/20')
  })

  it('pozycja bez klienta to produkcja na magazyn', () => {
    render(<PlanList lines={[linia({ clientName: '' })]} onPick={() => {}} />)
    expect(wiersz('l1').textContent).toContain('na magazyn')
  })

  it('gotowa pozycja jest wyróżniona', () => {
    render(<PlanList lines={[linia({ qtyDone: 20 })]} onPick={() => {}} />)
    expect(within(wiersz('l1')).getByText('Gotowe')).toBeTruthy()
    expect(wiersz('l1').getAttribute('data-state')).toBe('DONE')
  })

  it('dotknięcie wiersza oddaje jego id', () => {
    const pick = vi.fn()
    render(<PlanList lines={[linia(), linia({ id: 'l2', recipeName: 'BULLI' })]} onPick={pick} onDetails={() => {}} />)
    fireEvent.click(wiersz('l2'))
    expect(pick).toHaveBeenCalledWith('l2')
  })

  it('wybrana pozycja jest oznaczona (także dla czytnika ekranu)', () => {
    render(<PlanList lines={[linia(), linia({ id: 'l2' })]} selectedId="l2" onPick={() => {}} />)
    expect(wiersz('l2').getAttribute('aria-pressed')).toBe('true')
    expect(wiersz('l1').getAttribute('aria-pressed')).toBe('false')
  })

  // Partie przeniesione do szczegółów (01.10.2026) — na liście zabierały
  // miejsce 30 pozycjom.
  it('NIE pokazuje partii, alokacji ani sum kilogramów na liście', () => {
    render(<PlanList onPick={() => {}} lines={[
      linia({ id: 'l1', seasonedBatchNos: ['344'] }),
      linia({ id: 'l2', batchAllocation: { '472': { pieces: 2 }, 'PP13': { pieces: 6 } } }),
    ]} />)
    const tekst = screen.getByTestId('plan-lista').textContent ?? ''
    expect(tekst).not.toContain('344')
    expect(tekst).not.toContain('472')
    expect(tekst).not.toContain('PP13')
    expect(tekst).not.toContain('700 kg')
  })

  it('nie ma tabeli z kilkunastoma kolumnami ani poziomego przewijania z definicji', () => {
    render(<PlanList lines={[linia()]} onPick={() => {}} />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByTestId('plan-przewijanie').style.overflowX).toBe('hidden')
  })

  it('30 pozycji: wszystkie w DOM, w dwóch kolumnach, w kolejności planu', () => {
    const lines = Array.from({ length: 30 }, (_, i) => linia({ id: `p${i + 1}`, recipeName: `R${i + 1}` }))
    render(<PlanList lines={lines} onPick={() => {}} />)
    const wiersze = screen.getAllByTestId(/^pozycja-planu-/)
    expect(wiersze).toHaveLength(30)
    expect(wiersze.map(w => w.getAttribute('data-testid'))).toEqual(lines.map(l => `pozycja-planu-${l.id}`))
    expect(screen.getByTestId('plan-lista').getAttribute('data-cols')).toBe('2')
  })

  // Potwierdzenie pozycji to SKAN, nie licznik sztuk: dopiero zeskanowana
  // sztuka leży na magazynie wyrobu gotowego.
  it('pozycja zeskanowana w całości jest POTWIERDZONA, a nie tylko gotowa', () => {
    render(<PlanList lines={[linia({ qtyDone: 20 })]} onPick={() => {}}
      scans={{ l1: { total: 20, scanned: 20 } }} />)
    expect(screen.getByText('Potwierdzone')).toBeTruthy()
    expect(screen.queryByText('Gotowe')).toBeNull()
  })

  it('policzona, ale niezeskanowana pozycja zostaje gotowa', () => {
    render(<PlanList lines={[linia({ qtyDone: 20 })]} onPick={() => {}}
      scans={{ l1: { total: 20, scanned: 12 } }} />)
    expect(screen.getByText('Gotowe')).toBeTruthy()
    expect(screen.queryByText('Potwierdzone')).toBeNull()
  })

  // Skan liczony do PLANU pozycji — tak samo jak stan POTWIERDZONE
  // (`isConfirmed`), żeby lista i potwierdzenie nie mówiły dwóch rzeczy.
  it('kolumna skanu pokazuje, ile sztuk pozycji już zeskanowano', () => {
    render(<PlanList lines={[linia()]} onPick={() => {}} scans={{ l1: { total: 20, scanned: 12 } }} />)
    expect(screen.getByTestId('skan-l1').textContent).toContain('12/20')
  })

  it('pozycja bez wydrukowanych etykiet mówi wprost, że nie ma czego skanować', () => {
    render(<PlanList lines={[linia()]} onPick={() => {}} scans={{}} />)
    expect(screen.getByTestId('skan-l1').textContent).toContain('—')
  })

  it('pusty plan mówi wprost, że biuro nic nie zaplanowało', () => {
    render(<PlanList lines={[]} onPick={() => {}} />)
    expect(screen.getByText(/Biuro nie zaplanowało/i)).toBeTruthy()
  })
})

// Krótkie dotknięcie wybiera, przytrzymanie otwiera szczegóły. Po
// przytrzymaniu przeglądarka i tak wyśle `click` — nie może zmienić wyboru.
describe('PlanList — przytrzymanie wiersza', () => {
  const setup = () => {
    const pick = vi.fn()
    const details = vi.fn()
    const r = render(<PlanList lines={[linia(), linia({ id: 'l2' })]} onPick={pick} onDetails={details} />)
    return { pick, details, ...r }
  }
  afterEach(() => vi.useRealTimers())

  it('przytrzymanie ~600 ms otwiera szczegóły i NIE wybiera pozycji', () => {
    vi.useFakeTimers()
    const { pick, details } = setup()
    fireEvent.pointerDown(wiersz('l2'), { button: 0, clientX: 10, clientY: 10 })
    act(() => { vi.advanceTimersByTime(650) })
    expect(details).toHaveBeenCalledWith('l2')
    fireEvent.pointerUp(wiersz('l2'))
    fireEvent.click(wiersz('l2'))
    expect(pick).not.toHaveBeenCalled()
  })

  it('krótkie dotknięcie wybiera, nie otwiera szczegółów', () => {
    vi.useFakeTimers()
    const { pick, details } = setup()
    fireEvent.pointerDown(wiersz('l1'), { button: 0 })
    act(() => { vi.advanceTimersByTime(200) })
    fireEvent.pointerUp(wiersz('l1'))
    fireEvent.click(wiersz('l1'))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(pick).toHaveBeenCalledWith('l1')
    expect(details).not.toHaveBeenCalled()
  })

  it('przerwany gest (cancel / przesunięcie palca) nie otwiera szczegółów', () => {
    vi.useFakeTimers()
    const { details } = setup()
    fireEvent.pointerDown(wiersz('l1'), { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerCancel(wiersz('l1'))
    act(() => { vi.advanceTimersByTime(1000) })
    fireEvent.pointerDown(wiersz('l1'), { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(wiersz('l1'), { clientX: 10, clientY: 60 })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(details).not.toHaveBeenCalled()
  })

  it('odmontowanie w trakcie przytrzymania sprząta zegar', () => {
    vi.useFakeTimers()
    const { details, unmount } = setup()
    fireEvent.pointerDown(wiersz('l1'), { button: 0 })
    unmount()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(details).not.toHaveBeenCalled()
  })

  it('menu kontekstowe przeglądarki jest zablokowane na wierszu', () => {
    setup()
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    wiersz('l1').dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('wiersz to pojedynczy przycisk — bez zagnieżdżonych przycisków', () => {
    setup()
    expect(wiersz('l1').tagName).toBe('BUTTON')
    expect(wiersz('l1').querySelector('button')).toBeNull()
  })
})

describe('LineDetails — szczegóły pozycji', () => {
  const props = (over: any = {}) => ({
    line: linia({ seasonedBatchNos: ['344'], batchAllocation: { '472': { pieces: 2 }, 'PP13': { pieces: 6 } },
      packagingUsed: 7, workerEntries: [{ workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 9, addedAt: '' }] }),
    lp: 3, scan: { total: 20, scanned: 4 }, onClose: vi.fn(), onChangePackaging: vi.fn(), onMoveFrom: vi.fn(),
    ...over,
  })

  it('pokazuje PEŁNE rozbicie partii, nie zwinięte', () => {
    render(<LineDetails {...props()} />)
    const partie = screen.getByTestId('partie').textContent ?? ''
    expect(partie).toContain('472')
    expect(partie).toContain('2 szt.')
    expect(partie).toContain('PP13')
    expect(partie).toContain('6 szt.')
  })

  it('pełne nazwy, tuleja, postęp i rozliczenie', () => {
    render(<LineDetails {...props()} />)
    const okno = screen.getByRole('dialog')
    expect(okno.textContent).toContain('Bulli sp. z o.o.')
    expect(screen.getByTestId('tuleja-nazwa').textContent).toBe('Tuleja 120')
    expect(okno.textContent).toContain('12 / 20 szt.')
    expect(okno.textContent).toContain('4 / 20 szt.')
    expect(screen.getByTestId('rozliczenie-w1').textContent).toContain('9 szt.')
  })

  it('zmiana tulei i przepisanie oddają id', () => {
    const p = props()
    render(<LineDetails {...p} />)
    fireEvent.click(screen.getByTestId('zmien-tuleje'))
    expect(p.onChangePackaging).toHaveBeenCalledWith('l1')
    fireEvent.click(screen.getByTestId('rozliczenie-w1'))
    expect(p.onMoveFrom).toHaveBeenCalledWith('w1')
  })

  it('Escape zamyka; fokus startuje na „Zamknij"', () => {
    const p = props()
    render(<LineDetails {...p} />)
    expect(document.activeElement).toBe(screen.getByTestId('zamknij-szczegoly'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(p.onClose).toHaveBeenCalled()
  })

  it('jest dialogiem z tytułem dla czytnika ekranu', () => {
    render(<LineDetails {...props()} />)
    const okno = screen.getByRole('dialog')
    expect(okno.getAttribute('aria-modal')).toBe('true')
    expect(okno.getAttribute('aria-labelledby')).toBe('szczegoly-tytul')
  })
})

describe('MovePiecesModal — pomyłka „nie ta osoba"', () => {
  const props = () => ({
    line: linia({ qtyDone: 12, workerEntries: [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 9, addedAt: '10:00' },
      { workerId: 'w2', workerName: 'DENYS KOVAL', pieces: 3, addedAt: '11:00' },
    ] }),
    fromWorkerId: 'w1',
    workers: [{ id: 'w1', name: 'DAWID NOWAK' }, { id: 'w2', name: 'DENYS KOVAL' }, { id: 'w3', name: 'OLEH BONDAR' }],
    onMove: vi.fn(),
    onClose: vi.fn(),
  })

  it('mówi, od kogo i ile sztuk można przenieść', () => {
    render(<MovePiecesModal {...props()} />)
    expect(screen.getByText(/DAWID/)).toBeTruthy()
    expect(screen.getByText(/9 szt\./)).toBeTruthy()
  })

  it('nie proponuje przeniesienia na samego siebie', () => {
    render(<MovePiecesModal {...props()} />)
    expect(screen.queryByTestId('na-w1')).toBeNull()
    expect(screen.getByTestId('na-w2')).toBeTruthy()
    expect(screen.getByTestId('na-w3')).toBeTruthy()
  })

  it('licznik nie przekracza tego, co osoba ma — 9 sztuk to sufit', () => {
    render(<MovePiecesModal {...props()} />)
    for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole('button', { name: 'więcej' }))
    expect(screen.getByTestId('ile-sztuk').textContent).toBe('9')
  })

  it('bez wskazania osoby zapis jest niedostępny — sztuki nie mogą zniknąć', () => {
    const p = props()
    render(<MovePiecesModal {...p} />)
    fireEvent.click(screen.getByTestId('przenies'))
    expect(p.onMove).not.toHaveBeenCalled()
  })

  it('oddaje komu i ile', () => {
    const p = props()
    render(<MovePiecesModal {...p} />)
    fireEvent.click(screen.getByTestId('na-w3'))
    fireEvent.click(screen.getByRole('button', { name: 'więcej' }))
    fireEvent.click(screen.getByTestId('przenies'))
    expect(p.onMove).toHaveBeenCalledWith({ toWorkerId: 'w3', toWorkerName: 'OLEH BONDAR', pieces: 2 })
  })
})

describe('WrappingModal — folia stretch przeniesiona z ekranu głównego', () => {
  const props = () => ({
    workers: [{ id: 'w1', name: 'VLAD FOLIA' }, { id: 'w2', name: 'ADAM FOLIA' }],
    saved: [],
    kgToday: 8000,
    material: { packagingId: 'f1', name: 'Folia stretch', unit: 'rolka', pobrane: 40, zwrocone: 0, zuzyte: 40, moves: [] } as any,
    onTakeMaterial: vi.fn(),
    onSave: vi.fn(),
    onClose: vi.fn(),
  })

  it('pokazuje ile rolek już pobrano', () => {
    render(<WrappingModal {...props()} />)
    expect(screen.getByTestId('folia-pobrane').textContent).toBe('40')
  })

  it('dokłada rolki jednym dotknięciem', () => {
    const p = props()
    render(<WrappingModal {...p} />)
    fireEvent.click(screen.getByText(/Dołóż rolki/i))
    fireEvent.click(screen.getByRole('button', { name: '+10' }))
    expect(p.onTakeMaterial).toHaveBeenCalledWith(10)
  })

  it('bez kartoteki folii nie udaje, że da się pobrać', () => {
    render(<WrappingModal {...{ ...props(), material: null }} />)
    expect(screen.queryByText(/Dołóż rolki/i)).toBeNull()
    expect(screen.getByText(/Brak kartoteki folii/i)).toBeTruthy()
  })
})

describe('PackagingPicker — zmiana tulei z hali', () => {
  const tuleje = [
    { id: 't1', name: 'METAL 65', type: 'tuleja', kgAvailable: 4 },
    { id: 't2', name: 'KARTON 65', type: 'tuleja', kgAvailable: 80 },
    { id: 'f1', name: 'Folia stretch', type: 'FOLIA', kgAvailable: 30 },
  ]
  const props = () => ({
    line: linia({ packagingName: 'METAL 65' }),
    packagingId: 't1',
    packaging: tuleje,
    onPick: vi.fn(),
    onClose: vi.fn(),
  })

  it('pokazuje same tuleje i ich stan', () => {
    render(<PackagingPicker {...props()} />)
    expect(screen.getByText('KARTON 65')).toBeTruthy()
    expect(screen.getByText(/80 szt\./)).toBeTruthy()
    expect(screen.queryByText('Folia stretch')).toBeNull()
  })

  it('zaznacza tuleję, która stoi na pozycji teraz', () => {
    render(<PackagingPicker {...props()} />)
    expect(within(screen.getByTestId('tuleja-opcja-t1')).getByText(/obecna/i)).toBeTruthy()
  })

  it('ostrzega, gdy tulei nie starczy na resztę pozycji', () => {
    // zostało 8 sztuk (20 − 12), a metalowych jest 4
    render(<PackagingPicker {...props()} />)
    expect(within(screen.getByTestId('tuleja-opcja-t1')).getByText(/nie starczy/i)).toBeTruthy()
    expect(within(screen.getByTestId('tuleja-opcja-t2')).queryByText(/nie starczy/i)).toBeNull()
  })

  it('wybór oddaje id tulei', () => {
    const p = props()
    render(<PackagingPicker {...p} />)
    fireEvent.click(screen.getByTestId('tuleja-opcja-t2'))
    expect(p.onPick).toHaveBeenCalledWith('t2')
  })

  it('brak tulei na stanie nie blokuje wyboru — hala wie lepiej, co ma w ręce', () => {
    const p = { ...props(), packaging: [{ id: 't3', name: 'METAL 90', type: 'tuleja', kgAvailable: 0 }] }
    render(<PackagingPicker {...p} />)
    fireEvent.click(screen.getByTestId('tuleja-opcja-t3'))
    expect(p.onPick).toHaveBeenCalledWith('t3')
  })

  it('mówi, ile tulei już zeszło z pozycji', () => {
    render(<PackagingPicker {...props()} used={12} />)
    expect(screen.getByTestId('tuleje-do-oddania').textContent).toMatch(/12 tulei .*wróci na magazyn/i)
    cleanup()
    render(<PackagingPicker {...props()} used={0} />)
    expect(screen.queryByTestId('tuleje-do-oddania')).toBeNull()
  })
})

/** Jeden zapis = jedna pozycja i jedna osoba. */
const zapis = (pieces: number, workerId = 'w1', lineId = 'l1') => ({ lineId, workerId, pieces })

describe('LineCounter', () => {
  const props = () => ({
    line: linia(),
    workers: [{ id: 'w1', name: 'DAWID NOWAK' }, { id: 'w2', name: 'DENYS KOVAL' }],
    selectedWorkerId: 'w1',
    onSelectWorker: vi.fn(),
    onSave: vi.fn(),
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


  it('zapis oddaje pozycję, osobę i liczbę sztuk naraz', () => {
    const p = props()
    render(<LineCounter {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'więcej' }))
    fireEvent.click(screen.getByTestId('zapisz'))
    expect(p.onSave).toHaveBeenCalledWith(zapis(2))
  })

  it('szybkie ilości 1/3/5 ustawiają licznik; większe niż reszta planu gasną', () => {
    render(<LineCounter {...props()} line={linia({ qtyDone: 16 })} />)   // zostały 4
    fireEvent.click(screen.getByTestId('ile-3'))
    expect(screen.getByTestId('licznik').textContent).toBe('3')
    expect(screen.getByTestId('zapisz').textContent).toBe('Dodaj 3 szt. · DAWID')
    expect((screen.getByTestId('ile-5') as HTMLButtonElement).disabled).toBe(true)
  })

  it('zmiana osoby wraca z ilością do 1 — „5 szt." nie przechodzi na kolejną osobę', () => {
    const p = props()
    const { rerender } = render(<LineCounter {...p} />)
    fireEvent.click(screen.getByTestId('ile-5'))
    fireEvent.click(screen.getByTestId('pracownik-w2'))
    expect(p.onSelectWorker).toHaveBeenCalledWith('w2')
    rerender(<LineCounter {...p} selectedWorkerId="w2" />)
    expect(screen.getByTestId('licznik').textContent).toBe('1')
  })

  it('bez wybranej osoby zapis jest zablokowany i mówi, czego brakuje', () => {
    const p = { ...props(), selectedWorkerId: '' }
    render(<LineCounter {...p} />)
    const b = screen.getByTestId('zapisz') as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(b.textContent).toMatch(/Wybierz osobę/)
    fireEvent.click(b)
    expect(p.onSave).not.toHaveBeenCalled()
  })

  it('bez pracowników na liście — jasny komunikat i blokada zapisu', () => {
    const p = { ...props(), workers: [], selectedWorkerId: '' }
    render(<LineCounter {...p} />)
    expect(screen.getByTestId('brak-pracownikow').textContent).toMatch(/Brak pracowników/)
    expect((screen.getByTestId('zapisz') as HTMLButtonElement).disabled).toBe(true)
  })

  it('zapis w locie i czekanie na serwer gaszą przycisk', () => {
    const p = props()
    const { rerender } = render(<LineCounter {...p} busy />)
    expect((screen.getByTestId('zapisz') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('zapisz').textContent).toMatch(/Zapisuję/)
    rerender(<LineCounter {...p} syncing />)
    expect((screen.getByTestId('zapisz') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('zapisz'))
    expect(p.onSave).not.toHaveBeenCalled()
  })

  it('potwierdzenie zapisu stoi w panelu tej pozycji, a cudze nie', () => {
    const p = props()
    const { rerender } = render(<LineCounter {...p} feedback={{ seq: 1, lineId: 'l1', ok: true, text: 'Dodano 3 szt. · DAWID' }} />)
    expect(screen.getByTestId('wynik-zapisu').textContent).toContain('Dodano 3 szt. · DAWID')
    rerender(<LineCounter {...p} feedback={{ seq: 2, lineId: 'l9', ok: false, text: 'błąd innej' }} />)
    expect(screen.getByTestId('wynik-zapisu').textContent).not.toContain('błąd innej')
  })

  it('dwie osoby o tym samym imieniu — przycisk podaje inicjał nazwiska', () => {
    const p = { ...props(), workers: [{ id: 'a1', name: 'ANAR KOWAL' }, { id: 'a2', name: 'ANAR MAMEDOV' }], selectedWorkerId: 'a2' }
    render(<LineCounter {...p} />)
    expect(screen.getByTestId('zapisz').textContent).toBe('Dodaj 1 szt. · ANAR M.')
    expect(screen.getByTestId('pracownik-a1').textContent).toContain('KOWAL')
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

  it('nie ma „wróć do listy" — plan stoi obok', () => {
    render(<LineCounter {...props()} />)
    expect(screen.queryByText(/Plan dnia/)).toBeNull()
  })
})

// Układa 10–15 osób naraz. Kafelek ma nieść nazwisko I dorobek na tej pozycji,
// bo operator wybiera osobę wzrokiem z drugiego końca stołu, w rękawicy.
describe('LineCounter — kafelki pracowników', () => {
  const zaloga = Array.from({ length: 12 }, (_, i) => ({ id: `w${i + 1}`, name: `PRACOWNIK ${i + 1}` }))
  const props = (over: any = {}) => ({
    line: linia({ qtyDone: 12, workerEntries: [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 9, addedAt: '10:00' },
      { workerId: 'w2', workerName: 'DENYS KOVAL', pieces: 3, addedAt: '11:00' },
    ] }),
    workers: zaloga,
    selectedWorkerId: 'w1',
    onSelectWorker: vi.fn(),
    onSave: vi.fn(),
    canSave: true,
    ...over,
  })

  it('każdy pracownik ma własny kafelek — cała załoga na ekranie', () => {
    render(<LineCounter {...props()} />)
    expect(screen.getAllByTestId(/^pracownik-/)).toHaveLength(12)
  })

  it('kafelek niesie dorobek osoby na tej pozycji', () => {
    render(<LineCounter {...props()} />)
    expect(within(screen.getByTestId('pracownik-w1')).getByText('9 szt.')).toBeTruthy()
    expect(within(screen.getByTestId('pracownik-w2')).getByText('3 szt.')).toBeTruthy()
  })

  it('osoba bez sztuk na pozycji nie udaje, że coś zrobiła', () => {
    render(<LineCounter {...props()} />)
    expect(within(screen.getByTestId('pracownik-w5')).queryByText(/szt\./)).toBeNull()
  })

  it('zaznaczony kafelek jest oznaczony dla czytnika ekranu', () => {
    render(<LineCounter {...props()} />)
    expect(screen.getByTestId('pracownik-w1').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('pracownik-w2').getAttribute('aria-pressed')).toBe('false')
  })

  it('dotknięcie kafelka wybiera osobę', () => {
    const p = props()
    render(<LineCounter {...p} />)
    fireEvent.click(screen.getByTestId('pracownik-w7'))
    expect(p.onSelectWorker).toHaveBeenCalledWith('w7')
  })
})

// Pomyłka w liczeniu wychodzi zwykle na końcu pozycji. Dopóki sztuka nie jest
// zeskanowana, jest tylko liczbą na ekranie — wolno ją odjąć.
describe('LineCounter — odejmowanie sztuk przed skanem', () => {
  const props = (over: any = {}) => ({
    line: linia({ qty: 20, qtyDone: 12, workerEntries: [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 9, addedAt: '10:00' },
      { workerId: 'w2', workerName: 'DENYS KOVAL', pieces: 3, addedAt: '11:00' },
    ] }),
    workers: [{ id: 'w1', name: 'DAWID NOWAK' }, { id: 'w2', name: 'DENYS KOVAL' }],
    selectedWorkerId: 'w1',
    onSelectWorker: vi.fn(),
    onSave: vi.fn(),
    canSave: true,
    scan: { total: 20, scanned: 0 },
    ...over,
  })
  /** Odejmowanie jest korektą — schowane za przełącznikiem. */
  const korekta = () => fireEvent.click(screen.getByTestId('korekta'))

  it('odejmowanie jest schowane, dopóki operator nie włączy korekty', () => {
    render(<LineCounter {...props()} />)
    expect(screen.queryByTestId('odejmij')).toBeNull()
    korekta()
    expect(screen.getByTestId('odejmij')).toBeTruthy()
    expect(screen.queryByTestId('zapisz')).toBeNull()
  })

  it('odejmowanie oddaje UJEMNĄ liczbę sztuk — jeden zapis, jedna droga', () => {
    const p = props()
    render(<LineCounter {...p} />)
    korekta()
    fireEvent.click(screen.getByRole('button', { name: 'więcej' }))
    fireEvent.click(screen.getByTestId('odejmij'))
    expect(p.onSave).toHaveBeenCalledWith(zapis(-2))
  })

  it('nazwisko osoby stoi na przycisku odejmowania — sztuki schodzą JEJ', () => {
    render(<LineCounter {...props()} />)
    korekta()
    expect(screen.getByTestId('odejmij').textContent).toContain('DAWID')
  })

  it('nie odejmiesz osobie więcej, niż ma na pozycji', () => {
    const p = props({ selectedWorkerId: 'w2' })   // DENYS ma 3 szt.
    render(<LineCounter {...p} />)
    korekta()
    for (let i = 0; i < 8; i++) fireEvent.click(screen.getByRole('button', { name: 'więcej' }))
    fireEvent.click(screen.getByTestId('odejmij'))
    expect(p.onSave).toHaveBeenCalledWith(zapis(-3, 'w2'))
  })

  it('osobie bez sztuk nie ma czego odjąć', () => {
    const p = props({ workers: [{ id: 'w1', name: 'DAWID NOWAK' }, { id: 'w3', name: 'OLEH BONDAR' }],
                      selectedWorkerId: 'w3' })
    render(<LineCounter {...p} />)
    korekta()
    expect((screen.getByTestId('odejmij') as HTMLButtonElement).disabled).toBe(true)
  })

  it('GOTOWA pozycja nadal pozwala odjąć — pomyłka wychodzi na końcu', () => {
    const p = props({ line: linia({ qty: 12, qtyDone: 12, workerEntries: [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 12, addedAt: '10:00' },
    ] }) })
    render(<LineCounter {...p} />)
    expect((screen.getByTestId('zapisz') as HTMLButtonElement).disabled).toBe(true)
    korekta()
    expect((screen.getByTestId('odejmij') as HTMLButtonElement).disabled).toBe(false)
  })

  it('w trakcie przerwy nie odejmiesz tak samo jak nie dopiszesz', () => {
    const p = props({ canSave: false })
    render(<LineCounter {...p} />)
    korekta()
    fireEvent.click(screen.getByTestId('odejmij'))
    expect(p.onSave).not.toHaveBeenCalled()
  })

  it('udany zapis wraca z korekty do dodawania', () => {
    const p = props()
    const { rerender } = render(<LineCounter {...p} />)
    korekta()
    rerender(<LineCounter {...p} feedback={{ seq: 1, lineId: 'l1', ok: true, text: 'Odjęto 1 szt.' }} />)
    expect(screen.getByTestId('zapisz')).toBeTruthy()
  })
})

// Skan = sztuka leży na magazynie wyrobu gotowego. Tego już nie cofniemy
// z HMI — zostaje przepisanie pracy komu innemu.
describe('LineCounter — po zeskanowaniu', () => {
  const props = (over: any = {}) => ({
    line: linia({ qty: 20, qtyDone: 12, workerEntries: [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 9, addedAt: '10:00' },
      { workerId: 'w2', workerName: 'DENYS KOVAL', pieces: 3, addedAt: '11:00' },
    ] }),
    workers: [{ id: 'w1', name: 'DAWID NOWAK' }, { id: 'w2', name: 'DENYS KOVAL' }],
    selectedWorkerId: 'w1',
    onSelectWorker: vi.fn(),
    onSave: vi.fn(),
    canSave: true,
    onMoveFrom: vi.fn(),
    ...over,
  })

  it('wszystko zeskanowane → odejmowanie zgaszone, zostaje przepisanie', () => {
    const p = props({ scan: { total: 20, scanned: 12 }, selectedWorkerId: 'w2' })
    render(<LineCounter {...p} />)
    fireEvent.click(screen.getByTestId('korekta'))
    expect((screen.getByTestId('odejmij') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('przepisz'))
    expect(p.onMoveFrom).toHaveBeenCalledWith('w2')
  })

  it('nadwyżkę ponad zeskanowane wolno jeszcze skasować', () => {
    const p = props({ scan: { total: 20, scanned: 9 } })   // wpisane 12, zeskanowane 9
    render(<LineCounter {...p} />)
    fireEvent.click(screen.getByTestId('korekta'))
    for (let i = 0; i < 8; i++) fireEvent.click(screen.getByRole('button', { name: 'więcej' }))
    fireEvent.click(screen.getByTestId('odejmij'))
    expect(p.onSave).toHaveBeenCalledWith(zapis(-3))
  })

  it('mówi wprost, ile sztuk pozycji jest już zeskanowanych', () => {
    render(<LineCounter {...props({ scan: { total: 20, scanned: 9 } })} />)
    expect(screen.getByTestId('skan-pozycji').textContent).toMatch(/9 \/ 20/)
  })

  it('dopisywanie sztuk działa mimo skanów — brakującą sztukę wolno dodać', () => {
    const p = props({ scan: { total: 20, scanned: 12 } })
    render(<LineCounter {...p} />)
    fireEvent.click(screen.getByTestId('zapisz'))
    expect(p.onSave).toHaveBeenCalledWith(zapis(1))
  })

  it('prowadzi do skanowania TEJ pozycji', () => {
    const skanuj = vi.fn()
    render(<LineCounter {...props({ onScanLine: skanuj })} />)
    fireEvent.click(screen.getByTestId('skanuj-pozycje'))
    expect(skanuj).toHaveBeenCalledWith('l1')
  })
})

describe('LineCounter — poprawka „nie ta osoba"', () => {
  const zProps = (over: any = {}) => ({
    line: linia({ qtyDone: 12, workerEntries: [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 9, addedAt: '10:00' },
      { workerId: 'w2', workerName: 'DENYS KOVAL', pieces: 3, addedAt: '11:00' },
    ] }),
    workers: [{ id: 'w1', name: 'DAWID NOWAK' }, { id: 'w2', name: 'DENYS KOVAL' }],
    selectedWorkerId: 'w1',
    onSelectWorker: () => {},
    onSave: () => {},
    canSave: true,
    ...over,
  })

  it('korekta → „Przepisz na…" prosi o przeniesienie sztuk WYBRANEJ osoby', () => {
    const move = vi.fn()
    render(<LineCounter {...zProps({ onMoveFrom: move, selectedWorkerId: 'w2' })} />)
    fireEvent.click(screen.getByTestId('korekta'))
    fireEvent.click(screen.getByTestId('przepisz'))
    expect(move).toHaveBeenCalledWith('w2')
  })

  it('osoba bez sztuk na pozycji nie ma czego przepisać', () => {
    const move = vi.fn()
    render(<LineCounter {...zProps({ onMoveFrom: move, workers: [{ id: 'w3', name: 'OLEH BONDAR' }], selectedWorkerId: 'w3' })} />)
    fireEvent.click(screen.getByTestId('korekta'))
    expect((screen.getByTestId('przepisz') as HTMLButtonElement).disabled).toBe(true)
  })

  it('gotowa pozycja NADAL pozwala poprawić przypisanie', () => {
    const move = vi.fn()
    render(<LineCounter {...zProps({ onMoveFrom: move, line: linia({ qty: 12, qtyDone: 12, workerEntries: [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 12, addedAt: '10:00' },
    ] }) })} />)
    expect(screen.getByTestId('zapisz').hasAttribute('disabled')).toBe(true)   // sztuk już nie dopiszesz
    fireEvent.click(screen.getByTestId('korekta'))
    fireEvent.click(screen.getByTestId('przepisz'))
    expect(move).toHaveBeenCalledWith('w1')
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

  // Pasek ma jedną linię — przy wielu zmianach nie może zjeść wysokości planu.
  it('wiele zmian: jedna linia + rozwijana pełna lista', () => {
    const duzo = Array.from({ length: 6 }, (_, i) => ({
      kind: 'added' as const, line: { id: `x${i}`, qty: i + 1, kgPerUnit: 40, recipeName: `R${i}`, packagingName: '', clientName: '' },
    }))
    render(<PlanChangedBanner changes={duzo} onAck={() => {}} />)
    expect(screen.getByTestId('pasek-zmian').style.height).toBe('44px')
    expect(screen.queryByTestId('zmiany-lista')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Wszystkie (6)' }))
    expect(within(screen.getByTestId('zmiany-lista')).getAllByRole('listitem')).toHaveLength(6)
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
