// @vitest-environment jsdom
/**
 * Skanowanie gotowych kebabów na stanowisku produkcyjnym.
 *
 * Skaner na hali to „klawiatura": wystukuje kod i wciska Enter. Panel musi
 * łapać to bez dotykania ekranu, bo operator ma zajęte ręce — i po każdym
 * skanie sam wracać do gotowości na następny.
 *
 * Skan jest zamknięty na JEDNĄ pozycję planu: operator wybiera „poz. 1 ·
 * 20×40 kg" i przekłada wózek tej pozycji. Sztuka z innej pozycji musi się
 * odbić, zamiast po cichu zaliczyć się gdzie indziej.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

import { ScanPanel } from './ScanPanel'
import type { PlanLineView } from './PlanList'

afterEach(cleanup)

const linie: PlanLineView[] = [
  { id: 'l1', qty: 20, kgPerUnit: 40, totalKg: 800, recipeName: 'WROCŁAW',
    packagingName: 'METAL 65', clientName: 'Bulli sp. z o.o.', qtyDone: 12 },
  { id: 'l2', qty: 8, kgPerUnit: 35, totalKg: 280, recipeName: 'KIRMIZI',
    packagingName: 'KARTON 65', clientName: '', qtyDone: 0 },
]

const skany = { l1: { total: 20, scanned: 12 }, l2: { total: 0, scanned: 0 } }

const wynik = (over: any = {}) => ({
  ok: true, unitId: 'u1', status: 'produced', clientName: 'Bulli sp. z o.o.',
  batchNo: '250826 344', weightKg: 35, done: 5, total: 20, onStock: true, planLineId: 'l1', ...over,
})

/** Panel wpuszczony od razu w tryb skanu wybranej pozycji (wejście z licznika). */
const naPozycji = (onScan: any, over: any = {}) =>
  render(<ScanPanel lines={linie} scans={skany} initialLineId="l1"
    onScan={onScan} onClose={() => {}} {...over} />)

const skanuj = (kod: string) => {
  const pole = screen.getByTestId('pole-skanu') as HTMLInputElement
  fireEvent.change(pole, { target: { value: kod } })
  fireEvent.submit(pole.closest('form')!)
}

describe('ScanPanel — wybór pozycji', () => {
  it('bez wskazanej pozycji prosi o jej wybór, a nie o skan', () => {
    render(<ScanPanel lines={linie} scans={skany} onScan={vi.fn()} onClose={() => {}} />)
    expect(screen.queryByTestId('pole-skanu')).toBeNull()
    expect(screen.getByText(/Wybierz pozycję/i)).toBeTruthy()
  })

  it('każda pozycja planu ma swój kafelek z tym, co operator widzi na wózku', () => {
    render(<ScanPanel lines={linie} scans={skany} onScan={vi.fn()} onClose={() => {}} />)
    const poz = screen.getByTestId('pozycja-l1')
    expect(within(poz).getByText(/20 szt\. × 40 kg/)).toBeTruthy()
    expect(within(poz).getByText(/WROCŁAW/)).toBeTruthy()
    expect(within(poz).getByText(/Bulli/)).toBeTruthy()
  })

  it('kafelek pozycji niesie jej postęp skanowania', () => {
    render(<ScanPanel lines={linie} scans={skany} onScan={vi.fn()} onClose={() => {}} />)
    expect(within(screen.getByTestId('pozycja-l1')).getByText('12 / 20')).toBeTruthy()
  })

  it('pozycja bez wydrukowanych etykiet mówi, że nie ma czego skanować', () => {
    render(<ScanPanel lines={linie} scans={skany} onScan={vi.fn()} onClose={() => {}} />)
    expect(within(screen.getByTestId('pozycja-l2')).getByText(/Brak etykiet/i)).toBeTruthy()
  })

  it('wybór pozycji otwiera skan właśnie jej', () => {
    render(<ScanPanel lines={linie} scans={skany} onScan={vi.fn()} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('pozycja-l1'))
    expect(screen.getByTestId('pole-skanu')).toBeTruthy()
    expect(screen.getByTestId('wybrana-pozycja').textContent).toMatch(/WROCŁAW/)
  })

  it('wejście z licznika pozycji omija wybór', () => {
    naPozycji(vi.fn())
    expect(screen.getByTestId('pole-skanu')).toBeTruthy()
    expect(screen.getByTestId('wybrana-pozycja').textContent).toMatch(/WROCŁAW/)
  })

  it('można wrócić do wyboru, gdy wózek się skończył', () => {
    naPozycji(vi.fn())
    fireEvent.click(screen.getByTestId('zmien-pozycje'))
    expect(screen.queryByTestId('pole-skanu')).toBeNull()
    expect(screen.getByTestId('pozycja-l2')).toBeTruthy()
  })

  it('bez planu dnia nie udaje, że jest co skanować', () => {
    render(<ScanPanel lines={[]} scans={{}} onScan={vi.fn()} onClose={() => {}} />)
    expect(screen.getByText(/Biuro nie zaplanowało/i)).toBeTruthy()
  })
})

describe('ScanPanel — skan wybranej pozycji', () => {
  it('skan z czytnika idzie na serwer WRAZ z pozycją', async () => {
    const onScan = vi.fn().mockResolvedValue(wynik())
    naPozycji(onScan)

    skanuj('KEBAB-u1')

    await waitFor(() => expect(onScan).toHaveBeenCalledWith('KEBAB-u1', 'l1'))
  })

  it('po udanym skanie mówi, co weszło na magazyn', async () => {
    naPozycji(vi.fn().mockResolvedValue(wynik()))

    skanuj('KEBAB-u1')

    expect(await screen.findByText(/Na magazynie/i)).toBeTruthy()
    expect(screen.getByTestId('ostatni-skan').textContent).toMatch(/250826 344/)
    expect(screen.getByTestId('ostatni-skan').textContent).toMatch(/35 kg/)
    expect(screen.getByTestId('postep-pozycji').textContent).toBe('5 / 20')
  })

  it('pole czyści się po każdym skanie — następny kod nie doklei się do poprzedniego', async () => {
    naPozycji(vi.fn().mockResolvedValue(wynik()))

    skanuj('KEBAB-u1')

    await waitFor(() => expect((screen.getByTestId('pole-skanu') as HTMLInputElement).value).toBe(''))
  })

  it('dubel mówi wprost, że ta sztuka już jest', async () => {
    naPozycji(vi.fn().mockRejectedValue(Object.assign(new Error('409: duplikat'), { status: 409 })))

    skanuj('KEBAB-u1')

    expect(await screen.findByText(/już zeskanowana/i)).toBeTruthy()
  })

  // Serwer wie, do której pozycji sztuka należy — jego treść jest cenniejsza
  // niż nasze „coś nie tak", bo mówi operatorowi, gdzie odłożyć wózek.
  it('sztuka z innej pozycji odbija się z jej nazwą', async () => {
    naPozycji(vi.fn().mockRejectedValue(
      Object.assign(new Error('Ta sztuka jest z pozycji 2 (KIRMIZI)'), { status: 409 })))

    skanuj('KEBAB-u9')

    expect(await screen.findByText(/z pozycji 2 \(KIRMIZI\)/)).toBeTruthy()
    expect(screen.queryByText(/już zeskanowana/i)).toBeNull()
  })

  it('błąd łączności pokazuje treść, a nie ciche nic', async () => {
    naPozycji(vi.fn().mockRejectedValue(new Error('brak łączności')))

    skanuj('KEBAB-u1')

    expect(await screen.findByText(/brak łączności/i)).toBeTruthy()
  })

  it('liczy sztuki zeskanowane w tej sesji — operator widzi swój dorobek', async () => {
    const onScan = vi.fn()
      .mockResolvedValueOnce(wynik({ done: 5 }))
      .mockResolvedValueOnce(wynik({ unitId: 'u2', done: 6 }))
    naPozycji(onScan)

    skanuj('KEBAB-u1')
    await waitFor(() => expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('1'))
    skanuj('KEBAB-u2')
    await waitFor(() => expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('2'))
  })

  it('nieudany skan NIE podbija licznika sesji', async () => {
    naPozycji(vi.fn().mockRejectedValue(new Error('brak łączności')))

    skanuj('KEBAB-u1')

    await screen.findByText(/brak łączności/i)
    expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('0')
  })

  it('pusty kod nie leci na serwer', () => {
    const onScan = vi.fn()
    naPozycji(onScan)

    skanuj('   ')

    expect(onScan).not.toHaveBeenCalled()
  })

  // Zmiana pozycji to nowy wózek — licznik sesji z poprzedniej pozycji
  // wprowadzałby w błąd („zeskanowano 12", a tej pozycji dotyczy 0).
  it('zmiana pozycji zeruje licznik sesji', async () => {
    naPozycji(vi.fn().mockResolvedValue(wynik()))

    skanuj('KEBAB-u1')
    await waitFor(() => expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('1'))
    fireEvent.click(screen.getByTestId('zmien-pozycje'))
    fireEvent.click(screen.getByTestId('pozycja-l2'))

    expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('0')
  })

  // Pozycja domknięta skanem: operator ma to zobaczyć NA MIEJSCU, bez
  // wracania na listę planu.
  it('komplet skanów na pozycji melduje potwierdzenie', async () => {
    naPozycji(vi.fn().mockResolvedValue(wynik({ done: 20, total: 20 })))

    skanuj('KEBAB-u1')

    expect(await screen.findByText(/Pozycja potwierdzona/i)).toBeTruthy()
  })
})
