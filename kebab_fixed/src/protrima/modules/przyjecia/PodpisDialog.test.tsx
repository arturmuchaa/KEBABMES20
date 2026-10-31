// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

/** Podpis PIN-em: zgłoszenie 31.10.2026 — po jednej cyfrze pole traciło fokus (przerysowanie okna). */
const sig = vi.hoisted(() => ({ eligible: vi.fn(() => Promise.resolve([{ id: 'w1', name: 'Jan Kowalski', png: '' }])), sign: vi.fn(() => Promise.resolve({})) }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), signaturesApi: sig }))
import { PodpisDialog } from './KontrolaHaccp'

afterEach(cleanup)

describe('PodpisDialog', () => {
  it('PIN wpisuje się cyfra po cyfrze bez utraty fokusu; po wyborze osoby kursor stoi w polu PIN; Enter podpisuje', async () => {
    const onSigned = vi.fn(), onClose = vi.fn()
    render(<PodpisDialog docId="d1" role="wykonal" onSigned={onSigned} onClose={onClose} />)
    fireEvent.click(await screen.findByRole('option', { name: /Jan Kowalski/ }))
    const pin = screen.getByLabelText('PIN podpisującego') as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(pin))
    let wpisane = ''
    for (const cyfra of '1234') {
      wpisane += cyfra
      fireEvent.change(pin, { target: { value: wpisane } })
      await new Promise(r => setTimeout(r, 20))
      expect(document.activeElement).toBe(pin)
    }
    fireEvent.keyDown(pin, { key: 'Enter' })
    await waitFor(() => expect(sig.sign).toHaveBeenCalledWith({ docType: 'reception_check', docId: 'd1', role: 'wykonal', workerId: 'w1', pin: '1234' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
