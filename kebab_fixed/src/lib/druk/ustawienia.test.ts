// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const plik = vi.hoisted(() => ({ tresc: '{}' }))
const invoke = vi.hoisted(() => vi.fn(async (cmd: string, args?: any) => {
  if (cmd === 'druk_ustawienia_czytaj') return plik.tresc
  if (cmd === 'druk_ustawienia_zapisz') { plik.tresc = args.json; return null }
  throw new Error(`nieznana komenda ${cmd}`)
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
afterEach(() => { plik.tresc = '{}'; invoke.mockClear() })

describe('ustawienia druku na komputerze', () => {
  it('brak pliku daje puste ustawienia', async () => {
    const { czytajUstawienia } = await import('./ustawienia')
    expect(await czytajUstawienia()).toEqual({ dokumenty: {}, koloryZasobnikow: {} })
  })
  it('zapis dokumentu nie rusza innych', async () => {
    plik.tresc = JSON.stringify({ dokumenty: { wz: { drukarka: 'bizhub', ticket: 'T-WZ', kopie: 2 } }, koloryZasobnikow: { bizhub: { t3: 'zielone' } } })
    const { zapiszDokument, czytajUstawienia } = await import('./ustawienia')
    await zapiszDokument('kartki-palet', { drukarka: 'bizhub', ticket: 'T-K', kopie: 1 })
    const u = await czytajUstawienia()
    expect(u.dokumenty.wz).toEqual({ drukarka: 'bizhub', ticket: 'T-WZ', kopie: 2 })
    expect(u.dokumenty['kartki-palet']).toEqual({ drukarka: 'bizhub', ticket: 'T-K', kopie: 1 })
    expect(u.koloryZasobnikow.bizhub.t3).toBe('zielone')
  })
  it('kolor zasobnika per drukarka', async () => {
    const { zapiszKolor, czytajUstawienia } = await import('./ustawienia')
    await zapiszKolor('bizhub', 't3', 'zielone')
    await zapiszKolor('hp', 't3', 'żółte')
    const u = await czytajUstawienia()
    expect(u.koloryZasobnikow).toEqual({ bizhub: { t3: 'zielone' }, hp: { t3: 'żółte' } })
  })
  it('pusty kolor usuwa wpis', async () => {
    const { zapiszKolor, czytajUstawienia } = await import('./ustawienia')
    await zapiszKolor('bizhub', 't3', 'zielone')
    await zapiszKolor('bizhub', 't3', '  ')
    expect((await czytajUstawienia()).koloryZasobnikow.bizhub).toEqual({})
  })
})
