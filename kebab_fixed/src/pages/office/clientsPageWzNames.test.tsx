// @vitest-environment jsdom
/**
 * Kartoteka odbiorcy: ptaszek „Stosuj też na WZ".
 *
 * Do 12.09.2026 nazewnictwo z kartoteki schodziło na HDI zawsze, a na ręczny
 * WZ nie schodziło wcale — tego samego dnia HDI mówiło „KEBAB UDO 80KG",
 * a WZ „KEBAB UDO 100% WROCŁAW 80kg". Ptaszek rozstrzyga to per odbiorca
 * i domyślnie jest ZAZNACZONY: zgodność jest tym, czego oczekuje biuro.
 *
 * Test montuje ekran z prawdziwą kartą i sprawdza, co widzi i klika biuro —
 * stan ptaszka przy otwarciu oraz to, co naprawdę leci do zapisu.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const stan = vi.hoisted(() => ({
  karty: [] as any[],
  zapisane: null as any,
}))

vi.mock('@/lib/api', () => ({
  clientsApi: {
    list: () => Promise.resolve(stan.karty),
    create: (dto: any) => { stan.zapisane = dto; return Promise.resolve({ ...dto, id: 'c1' }) },
    update: (_id: string, dto: any) => { stan.zapisane = dto; return Promise.resolve({ ...dto, id: 'c1' }) },
    deactivate: () => Promise.resolve(),
    delete: () => Promise.resolve({ ok: true }),
  },
  recipesApi: { list: () => Promise.resolve([]) },
  clientGroupsApi: { list: () => Promise.resolve([]) },
  lookupNip: () => Promise.resolve(null),
}))

import { ClientsPage } from './ClientsPage'

afterEach(() => { cleanup(); stan.karty = []; stan.zapisane = null })

function karta(nadpisz: Record<string, any> = {}) {
  return {
    id: 'c1', code: 'K1', name: 'MATEUSZ STYRNIK', displayName: '', nip: '2222222222',
    regon: '', address: 'Wrocław', postalCode: '', city: '', contactName: '', phone: '',
    email: '', language: '', destName: '', destAddress: '', destCity: '',
    destForHdi: true, destForCmr: true, halalSupervision: false,
    hdiNameMode: 'type', hdiRecipeNames: [], wzUsesHdiNames: true,
    active: true, createdAt: '2026-09-01', ...nadpisz,
  }
}

async function otworzEdycje(nadpisz: Record<string, any> = {}) {
  stan.karty = [karta(nadpisz)]
  render(<MemoryRouter><ClientsPage /></MemoryRouter>)
  const edytuj = await screen.findByTitle('Edytuj')
  fireEvent.click(edytuj)
  return await screen.findByTestId('nazwa-takze-na-wz') as HTMLInputElement
}

describe('ptaszek „Stosuj też na WZ"', () => {
  it('karta z włączonym nazewnictwem na WZ pokazuje ptaszek zaznaczony', async () => {
    const ptaszek = await otworzEdycje({ wzUsesHdiNames: true })
    expect(ptaszek.checked).toBe(true)
  })

  it('karta z wyłączonym pokazuje ptaszek odznaczony', async () => {
    const ptaszek = await otworzEdycje({ wzUsesHdiNames: false })
    expect(ptaszek.checked).toBe(false)
  })

  it('stara karta BEZ tego pola domyślnie stosuje nazewnictwo także na WZ', async () => {
    const ptaszek = await otworzEdycje({ wzUsesHdiNames: undefined })
    expect(ptaszek.checked).toBe(true)
  })

  it('odznaczenie naprawdę leci do zapisu', async () => {
    const ptaszek = await otworzEdycje({ wzUsesHdiNames: true })
    fireEvent.click(ptaszek)
    expect(ptaszek.checked).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: /zapisz/i }))
    await waitFor(() => expect(stan.zapisane).not.toBeNull())
    expect(stan.zapisane.wzUsesHdiNames).toBe(false)
    // Tryb HDI ma zostać nietknięty — ptaszek rządzi tylko WZ.
    expect(stan.zapisane.hdiNameMode).toBe('type')
  })
})
