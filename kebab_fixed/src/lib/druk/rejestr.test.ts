// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rejestrApi = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ drukApi: { rejestr: rejestrApi } }))
const KLUCZ = 'druk.rejestr.kolejka'
beforeEach(() => { localStorage.clear(); rejestrApi.mockReset() })
afterEach(() => { vi.resetModules() })

const wpis = { rodzaj: 'kartki-palet' as const, tytul: 'Kartki palet', orderId: 'o1', palletIds: ['p1'], kopie: 1 }

describe('rejestr wydruków', () => {
  it('blad serwera trafia do kolejki i nie rzuca', async () => {
    rejestrApi.mockRejectedValue(new Error('offline'))
    const { zarejestruj } = await import('./rejestr')
    await expect(zarejestruj(wpis)).resolves.toBeUndefined()
    const kolejka = JSON.parse(localStorage.getItem(KLUCZ) || '[]')
    expect(kolejka).toHaveLength(1)
    expect(kolejka[0]).toMatchObject({ rodzaj: 'kartki-palet', palletIds: ['p1'] })
    expect(typeof kolejka[0].klientId).toBe('string')
  })
  it('wyslijZaleglosci wysyla z tym samym klientId i czysci', async () => {
    rejestrApi.mockRejectedValueOnce(new Error('offline'))
    const { zarejestruj, wyslijZaleglosci } = await import('./rejestr')
    await zarejestruj(wpis)
    const id = JSON.parse(localStorage.getItem(KLUCZ)!)[0].klientId
    rejestrApi.mockResolvedValue({})
    expect(await wyslijZaleglosci()).toBe(1)
    expect(rejestrApi).toHaveBeenLastCalledWith(expect.objectContaining({ klientId: id }))
    expect(JSON.parse(localStorage.getItem(KLUCZ) || '[]')).toEqual([])
  })
  it('uszkodzona kolejka w localStorage nie psuje druku', async () => {
    localStorage.setItem(KLUCZ, '{{{')
    rejestrApi.mockResolvedValue({})
    const { zarejestruj } = await import('./rejestr')
    await expect(zarejestruj(wpis)).resolves.toBeUndefined()
    expect(rejestrApi).toHaveBeenCalledWith(expect.objectContaining({ rodzaj: 'kartki-palet', komputer: expect.any(String) }))
  })
  it('udany zapis od razu dosyla zaleglosci', async () => {
    localStorage.setItem(KLUCZ, JSON.stringify([{ ...wpis, klientId: 'stary' }]))
    rejestrApi.mockResolvedValue({})
    const { zarejestruj } = await import('./rejestr')
    await zarejestruj({ ...wpis, palletIds: ['p2'] })
    expect(rejestrApi).toHaveBeenCalledWith(expect.objectContaining({ klientId: 'stary' }))
    expect(JSON.parse(localStorage.getItem(KLUCZ) || '[]')).toEqual([])
  })
})

describe('sygnał po zapisie w rejestrze', () => {
  it('udany zapis powiadamia słuchaczy (odświeżenie znaczników palet)', async () => {
    rejestrApi.mockResolvedValue({})
    const { zarejestruj, nasluchujWydrukow } = await import('./rejestr')
    const cb = vi.fn()
    const stop = nasluchujWydrukow(cb)
    await zarejestruj(wpis)
    expect(cb).toHaveBeenCalledWith({ orderId: 'o1', palletIds: ['p1'] })
    stop()
    await zarejestruj(wpis)
    expect(cb).toHaveBeenCalledTimes(1)
  })
  it('zapis w kolejce (serwer niedostępny) nie powiadamia', async () => {
    rejestrApi.mockRejectedValue(new Error('offline'))
    const { zarejestruj, nasluchujWydrukow } = await import('./rejestr')
    const cb = vi.fn()
    nasluchujWydrukow(cb)
    await zarejestruj(wpis)
    expect(cb).not.toHaveBeenCalled()
  })
})
