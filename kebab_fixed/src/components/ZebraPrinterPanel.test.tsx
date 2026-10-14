// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ZebraPrinterPanel } from './ZebraPrinterPanel'
import { calibrateZebra } from '@/lib/zebraPrinter'
import { sendZpl } from '@/lib/zebra'

vi.mock('@/lib/zebra', () => ({
  discoverZebraDevices: vi.fn(async () => [{ uid: 'usb', name: 'GC420t' }]),
  sendZpl: vi.fn(async () => {}),
  zebraErrorMessage: (e: any) => e.message ?? String(e),
}))
vi.mock('@/lib/zebraPrinter', () => ({ calibrateZebra: vi.fn(), readZebraDiagnostics: vi.fn() }))
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks() })

it('blokuje test podczas kalibracji i nie pokazuje sukcesu po błędzie', async () => {
  let fail!: (error: Error) => void
  vi.mocked(calibrateZebra).mockImplementation(() => new Promise((_ok, reject) => { fail = reject }))
  const onCalibrated = vi.fn()
  render(<ZebraPrinterPanel defaultProfile="100x150" onCalibrated={onCalibrated} />)
  fireEvent.change(screen.getByLabelText('Rozmiar rolki'), { target: { value: '50x80' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Zmieniam rolkę / kalibruj' })) })
  expect(screen.getByRole('button', { name: 'Jedna etykieta testowa' })).toBeDisabled()
  expect(screen.getByLabelText('Rozmiar rolki')).toBeDisabled()
  await act(async () => { fail(new Error('Nie potwierdzono wyniku kalibracji')) })
  expect(screen.getByRole('alert')).toHaveTextContent('Nie potwierdzono wyniku kalibracji')
  expect(onCalibrated).not.toHaveBeenCalled()
  expect(sendZpl).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Zmieniam rolkę / kalibruj' })).toBeEnabled()
})

it('przekazuje pomiar do ekranu przyjęcia dopiero po weryfikacji', async () => {
  vi.mocked(calibrateZebra).mockResolvedValue({ lengthMm: 102.3, message: 'Odczyt stabilny' })
  const onCalibrated = vi.fn()
  render(<ZebraPrinterPanel defaultProfile="80x100" onCalibrated={onCalibrated} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Zmieniam rolkę / kalibruj' })) })
  expect(onCalibrated).toHaveBeenCalledWith('80x100', 102.3)
  expect(sendZpl).not.toHaveBeenCalled() // test wysyła dopiero osobny przycisk
  expect(screen.getByRole('status')).toHaveTextContent('Odczyt stabilny')
})
