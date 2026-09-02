// @vitest-environment jsdom
/** Dialog podpisu — akt podpisania wymaga PIN-u PODPISUJĄCEGO, nie sesji
 *  biura. Zalogowana przeglądarka znaczy tylko tyle, że ktoś ją zostawił
 *  otwartą, więc te testy pilnują, że PIN naprawdę idzie na serwer. */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const eligible = vi.fn()
const sign = vi.fn()
vi.mock('@/lib/apiClient', () => ({
  signaturesApi: { eligible: (...a: any[]) => eligible(...a), sign: (...a: any[]) => sign(...a) },
}))

import { SignDialog } from './SignDialog'

const PNG = 'data:image/png;base64,AA'

beforeEach(() => {
  cleanup()
  eligible.mockReset(); sign.mockReset()
  eligible.mockResolvedValue([{ id: 'w-1', name: 'Jan K.', png: PNG }])
  sign.mockResolvedValue({ signerName: 'Jan K.', png: PNG })
})

describe('SignDialog', () => {
  it('pyta o osoby uprawnione do TEJ roli', async () => {
    render(<SignDialog docType="reception_check" docId="r1" role="sprawdzil"
                       onSigned={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(eligible).toHaveBeenCalledWith('sprawdzil'))
  })

  it('brak uprawnionych tłumaczy, gdzie narysować wzór', async () => {
    eligible.mockResolvedValue([])
    render(<SignDialog docType="reception_check" docId="r1" role="wykonal"
                       onSigned={() => {}} onClose={() => {}} />)
    expect(await screen.findByText(/0099/)).toBeTruthy()
  })

  it('podpisanie wysyła PIN i identyfikator osoby', async () => {
    const onSigned = vi.fn()
    render(<SignDialog docType="reception_check" docId="r1" role="wykonal"
                       onSigned={onSigned} onClose={() => {}} />)
    fireEvent.click(await screen.findByText('Jan K.'))
    fireEvent.change(screen.getByLabelText(/PIN/i), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: /^Podpisz$/i }))
    await waitFor(() => expect(sign).toHaveBeenCalled())
    expect(sign.mock.calls[0][0]).toMatchObject({
      docType: 'reception_check', docId: 'r1', role: 'wykonal',
      workerId: 'w-1', pin: '1234',
    })
    await waitFor(() => expect(onSigned).toHaveBeenCalled())
  })

  it('zły PIN pokazuje błąd i nie zamyka dialogu', async () => {
    sign.mockRejectedValue(new Error('Nieprawidłowy PIN'))
    const onSigned = vi.fn()
    render(<SignDialog docType="reception_check" docId="r1" role="wykonal"
                       onSigned={onSigned} onClose={() => {}} />)
    fireEvent.click(await screen.findByText('Jan K.'))
    fireEvent.change(screen.getByLabelText(/PIN/i), { target: { value: '0000' } })
    fireEvent.click(screen.getByRole('button', { name: /^Podpisz$/i }))
    expect(await screen.findByText(/Nieprawidłowy PIN/i)).toBeTruthy()
    expect(onSigned).not.toHaveBeenCalled()
  })

  it('bez PIN-u nie da się podpisać', async () => {
    render(<SignDialog docType="reception_check" docId="r1" role="wykonal"
                       onSigned={() => {}} onClose={() => {}} />)
    fireEvent.click(await screen.findByText('Jan K.'))
    const btn = screen.getByRole('button', { name: /^Podpisz$/i })
    expect(btn.hasAttribute('disabled')).toBe(true)
    fireEvent.click(btn)
    expect(sign).not.toHaveBeenCalled()
  })

  it('ostrzega, gdy ta sama osoba podpisała już drugą rolę', async () => {
    render(<SignDialog docType="reception_check" docId="r1" role="sprawdzil"
                       juzPodpisal="w-1" onSigned={() => {}} onClose={() => {}} />)
    fireEvent.click(await screen.findByText('Jan K.'))
    expect(await screen.findByText(/ta sama osoba/i)).toBeTruthy()
    // Ostrzeżenie, NIE blokada — w sobotę bywa jeden człowiek. Z wpisanym
    // PIN-em przycisk musi być czynny mimo ostrzeżenia.
    fireEvent.change(screen.getByLabelText(/PIN/i), { target: { value: '1234' } })
    expect(screen.getByRole('button', { name: /^Podpisz$/i }).hasAttribute('disabled')).toBe(false)
  })
})
