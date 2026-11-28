// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
const vat = vi.hoisted(() => ({ historia: vi.fn() }))
const ust = vi.hoisted(() => ({ getCompany: vi.fn() }))
const druk = vi.hoisted(() => ({ drukuj: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), vatUeApi: vat, settingsApi: ust }))
vi.mock('@/lib/print', () => druk)
import { VatUeBadge } from './VatUeBadge'
import type { VatUeWynik } from '@/lib/api'

afterEach(cleanup)
const W = (p: Partial<VatUeWynik>): VatUeWynik => ({ clientId: 'c1', vatNumber: 'ATU12345675', kraj: 'AT', status: 'aktywny',
  requestId: 'WAPIAAAAZ1x', checkedAt: '2026-11-27T10:00:00+00:00', komunikat: '', ostatniPewny: null, ...p })

describe('VatUeBadge', () => {
  it('aktywny: sam zielony napis, bez numeru potwierdzenia', () => {
    render(<VatUeBadge wynik={W({ requestId: 'b4cf8583-b26a-4639-8ec9-428ec630dcf5' })} onPonow={vi.fn()} />)
    const b = screen.getByRole('button', { name: 'VAT UE aktywny' })
    expect(b.className).toContain('ok')
    expect(screen.queryByText(/b4cf8583/)).toBeNull()
  })
  it('klik: numer potwierdzenia, dane z VIES i wydruk potwierdzenia', async () => {
    vat.historia.mockResolvedValue([
      { id: 'h2', vatNumber: 'ATU12345675', status: 'aktywny', requestId: 'b4cf8583-b26a-4639-8ec9-428ec630dcf5', error: '', context: 'wz',
        loadingId: null, orderId: null, wzId: null, operator: 'Biuro', checkedAt: '2026-11-27T10:00:00+00:00', orderNo: null, wzNumber: 'WZ/12/11/26', plate: null,
        viesName: 'Testa Handels GmbH', viesAddress: 'Teststraße 1\n1010 Wien' },
    ])
    ust.getCompany.mockResolvedValue({ name: 'Firma Przykładowa', nip: '1234567890' })
    druk.drukuj.mockResolvedValue(undefined)
    render(<VatUeBadge wynik={W({ requestId: 'b4cf8583-b26a-4639-8ec9-428ec630dcf5' })} onPonow={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'VAT UE aktywny' }))
    expect(await screen.findByRole('heading', { name: 'Potwierdzenie VAT UE' })).toBeTruthy()
    expect((await screen.findAllByText('b4cf8583-b26a-4639-8ec9-428ec630dcf5')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Testa Handels GmbH').length).toBeGreaterThan(0)
    expect(screen.getAllByText('ATU12345675').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /Drukuj potwierdzenie/ }))
    await waitFor(() => expect(druk.drukuj).toHaveBeenCalledWith(expect.objectContaining({ rodzaj: 'inne', tytul: 'Potwierdzenie VAT UE ATU12345675' })))
  })
  it('nieaktywny: wystaw fakturę z VAT 5 %', () => {
    render(<VatUeBadge wynik={W({ status: 'nieaktywny', requestId: '' })} onPonow={vi.fn()} />)
    expect(screen.getByText('VAT UE NIEAKTYWNY — wystaw fakturę z VAT 5 %')).toBeTruthy()
    expect(screen.getByRole('status').className).toContain('bad')
  })
  it('błąd: ostatni pewny wynik i ponowienie', () => {
    const onPonow = vi.fn()
    render(<VatUeBadge wynik={W({ status: 'blad', requestId: '', ostatniPewny: { status: 'aktywny', checkedAt: '2026-11-20T08:00:00+00:00', requestId: 'X' } })} onPonow={onPonow} />)
    expect(screen.getByText(/VIES nie odpowiada — ostatni wynik z 20\.11: aktywny/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź ponownie' }))
    expect(onPonow).toHaveBeenCalled()
  })
  it('błąd bez wcześniejszego wyniku', () => {
    render(<VatUeBadge wynik={W({ status: 'blad', ostatniPewny: null })} onPonow={vi.fn()} />)
    expect(screen.getByText(/VIES nie odpowiada — nie sprawdzono/)).toBeTruthy()
  })
  it('nie dotyczy i brak wyniku: nic', () => {
    const { container } = render(<VatUeBadge wynik={W({ status: 'nie_dotyczy' })} onPonow={vi.fn()} />)
    expect(container.textContent).toBe('')
    cleanup()
    const r2 = render(<VatUeBadge wynik={null} onPonow={vi.fn()} />)
    expect(r2.container.textContent).toBe('')
  })
  it('ładowanie', () => {
    render(<VatUeBadge wynik={null} ladowanie onPonow={vi.fn()} />)
    expect(screen.getByText(/Sprawdzam VAT UE w VIES/)).toBeTruthy()
  })
})
