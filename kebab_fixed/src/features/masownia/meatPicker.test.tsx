// @vitest-environment jsdom
/**
 * Kafelki mięsa na ekranie: bramka partii biura widziana oczami operatora.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MeatPicker } from './components/MeatPicker'

const meat = {
  pallets: [
    { id: 'p1', palletNo: 'PAL/17/09/26/1', kgNet: 200, expiryDate: '2026-10-01',
      lots: [{ lotNo: '511', kg: 200 }] },
    { id: 'p2', palletNo: 'PAL/17/09/26/2', kgNet: 200, expiryDate: '2026-10-01',
      lots: [{ lotNo: '513', kg: 200 }] },
  ],
  lots: [
    { meatStockId: 'ms-511', lotNo: '511', materialName: 'Mięso z/s', kgFree: 200, expiryDate: '2026-10-01' },
    { meatStockId: 'ms-513', lotNo: '513', materialName: 'Mięso z/s', kgFree: 200, expiryDate: '2026-10-01' },
    { meatStockId: 'ms-524', lotNo: '524', materialName: 'Filet z mostka wołowego', kgFree: 600, expiryDate: '2026-10-07' },
  ],
  taken: {},
}

afterEach(() => cleanup())

describe('MeatPicker', () => {
  it('bez partii w zleceniu wszystkie kafelki są klikalne', () => {
    render(<MeatPicker meat={meat} orderLots={[]} targetKg={200} maxKg={700} onConfirm={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole('button', { name: /PAL\/17\/09\/26\/1/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /PAL\/17\/09\/26\/2/ })).toBeEnabled()
  })

  it('z partią biura reszta kafelków jest szara i nieklikalna', () => {
    render(<MeatPicker meat={meat} orderLots={[{ meatLotNo: '511' }]} targetKg={200} maxKg={700} onConfirm={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole('button', { name: /PAL\/17\/09\/26\/1/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /PAL\/17\/09\/26\/2/ })).toBeDisabled()
  })

  it('kafelek odrzucony mówi, co wybrało biuro', () => {
    render(<MeatPicker meat={meat} orderLots={[{ meatLotNo: '511' }]} targetKg={200} maxKg={700} onConfirm={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getAllByText('Biuro wybrało partię 511').length).toBeGreaterThan(0)
  })

  it('filet z mostka wskazany przez biuro JEST do wzięcia, choć nie ma palety', () => {
    render(<MeatPicker meat={meat} orderLots={[{ meatLotNo: '524' }]} targetKg={600} maxKg={700} onConfirm={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Filet z mostka wołowego/ })).toBeEnabled()
  })

  it('pasek nad siatką wypisuje partie wskazane przez biuro', () => {
    render(<MeatPicker meat={meat} orderLots={[{ meatLotNo: '511' }, { meatLotNo: '513' }]}
      targetKg={400} maxKg={700} onConfirm={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByText(/Biuro wskazało partie: 511, 513/)).toBeInTheDocument()
  })

  it('kliknięcie kafelka palety dokłada jego kilogramy do wsadu', () => {
    const onConfirm = vi.fn()
    render(<MeatPicker meat={meat} orderLots={[]} targetKg={200} maxKg={700} onConfirm={onConfirm} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /PAL\/17\/09\/26\/1/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Załaduj/ }))
    expect(onConfirm).toHaveBeenCalledWith([
      { palletId: 'p1', lotNo: '511', meatStockId: 'ms-511', kg: 200 },
    ])
  })

  it('bez wskazanego mięsa nie da się załadować', () => {
    render(<MeatPicker meat={meat} orderLots={[]} targetKg={200} maxKg={700} onConfirm={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^Załaduj/ })).toBeDisabled()
  })

  it('kafelek szary nie reaguje na dotyk', () => {
    const onConfirm = vi.fn()
    render(<MeatPicker meat={meat} orderLots={[{ meatLotNo: '511' }]} targetKg={200} maxKg={700} onConfirm={onConfirm} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /PAL\/17\/09\/26\/2/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Załaduj/ }))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('ponowne dotknięcie palety zdejmuje ją ze wsadu', () => {
    const onConfirm = vi.fn()
    render(<MeatPicker meat={meat} orderLots={[]} targetKg={200} maxKg={700} onConfirm={onConfirm} onBack={vi.fn()} />)
    const kafel = screen.getByRole('button', { name: /PAL\/17\/09\/26\/1/ })
    fireEvent.click(kafel)
    fireEvent.click(kafel)
    expect(screen.getByRole('button', { name: /^Załaduj/ })).toBeDisabled()
  })

  it('paleta mieszana z partią spoza planu jest nieklikalna', () => {
    const mieszane = {
      ...meat,
      pallets: [{ id: 'pm', palletNo: 'PAL/17/09/26/25', kgNet: 200, expiryDate: '2026-10-01',
        lots: [{ lotNo: '511', kg: 60 }, { lotNo: '513', kg: 140 }] }],
    }
    render(<MeatPicker meat={mieszane} orderLots={[{ meatLotNo: '511' }]} targetKg={200} maxKg={700}
      onConfirm={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole('button', { name: /PAL\/17\/09\/26\/25/ })).toBeDisabled()
    expect(screen.getByText(/Na palecie jest też partia 513, spoza planu/)).toBeInTheDocument()
  })
})

describe('limit masownicy', () => {
  const duzo = {
    pallets: [
      { id: 'a', palletNo: 'PAL/A', kgNet: 200, expiryDate: '2026-10-01', lots: [{ lotNo: '511', kg: 200 }] },
      { id: 'b', palletNo: 'PAL/B', kgNet: 200, expiryDate: '2026-10-01', lots: [{ lotNo: '511', kg: 200 }] },
    ],
    lots: [{ meatStockId: 'ms-511', lotNo: '511', materialName: 'Mięso z/s',
             materialTypeId: 'mat-mieso-zs', kgFree: 400, expiryDate: '2026-10-01' }],
    taken: {},
  }

  it('nie da sie zaladowac ponad maksimum maszyny', () => {
    // Dwójka bierze 200 kg standardu i najwyżej 250 — dwie palety po 200 to 400.
    const onConfirm = vi.fn()
    render(<MeatPicker meat={duzo} orderLots={[]} targetKg={200} maxKg={250}
      onConfirm={onConfirm} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /PAL\/A/ }))
    fireEvent.click(screen.getByRole('button', { name: /PAL\/B/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Załaduj/ }))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('mowi ile trzeba zdjac, gdy wsad przekracza maszyne', () => {
    render(<MeatPicker meat={duzo} orderLots={[]} targetKg={200} maxKg={250}
      onConfirm={vi.fn()} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /PAL\/A/ }))
    fireEvent.click(screen.getByRole('button', { name: /PAL\/B/ }))
    expect(screen.getByText(/Masownica nie weźmie tyle/)).toBeInTheDocument()
    expect(screen.getByText(/zdejmij 150/)).toBeInTheDocument()
  })

  it('w granicy maszyny zaladunek przechodzi', () => {
    const onConfirm = vi.fn()
    render(<MeatPicker meat={duzo} orderLots={[]} targetKg={200} maxKg={250}
      onConfirm={onConfirm} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /PAL\/A/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Załaduj/ }))
    expect(onConfirm).toHaveBeenCalled()
  })
})
