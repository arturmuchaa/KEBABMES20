// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
const zarejestruj = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./druk/rejestr', () => ({ zarejestruj, uruchomPonawianie: () => {} }))
const otworzOknoDruku = vi.hoisted(() => vi.fn())
vi.mock('./druk/okno', () => ({ otworzOknoDruku }))
afterEach(() => {
  vi.restoreAllMocks(); vi.resetModules(); invoke.mockReset(); zarejestruj.mockClear(); otworzOknoDruku.mockReset()
  delete (window as any).__TAURI_INTERNALS__
})

describe('audited print dialogs without changing legacy callers', () => {
  it('never prints when the document is no longer active', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const { drukuj } = await import('./print')
    await expect(drukuj({ strict: true, beforePrint: () => { throw new Error('cancelled') } })).rejects.toThrow('cancelled')
    expect(print).not.toHaveBeenCalled()
  })
  it('surfaces native failures in audited mode instead of using the no-op WebView fallback', async () => {
    ;(window as any).__TAURI_INTERNALS__ = {}
    invoke.mockRejectedValue(new Error('native failed'))
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const { drukuj } = await import('./print')
    await expect(drukuj({ strict: true })).rejects.toThrow('native failed')
    expect(print).not.toHaveBeenCalled()
    await drukuj() // existing document callers keep best-effort behaviour
    expect(print).toHaveBeenCalledOnce()
  })
  it('checks the document again after loading the native adapter', async () => {
    ;(window as any).__TAURI_INTERNALS__ = {}
    const { drukuj } = await import('./print')
    await expect(drukuj({ strict: true, beforePrint: () => { throw new Error('changed page') } })).rejects.toThrow('changed page')
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('okno druku i rejestr', () => {
  const nowyDesktop = () => {
    ;(window as any).__TAURI_INTERNALS__ = {}
    invoke.mockImplementation(async (cmd: string) => (cmd === 'druk_drukarki' ? [{ nazwa: 'bizhub', domyslna: true }] : undefined))
  }
  it('poza Tauri: window.print i wpis do rejestru', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const { drukuj } = await import('./print')
    await drukuj({ rodzaj: 'wz', tytul: 'WZ/1/11/26', rejestr: { orderId: 'o1' } })
    expect(print).toHaveBeenCalledOnce()
    expect(zarejestruj).toHaveBeenCalledWith({ rodzaj: 'wz', tytul: 'WZ/1/11/26', orderId: 'o1', kopie: 1 })
  })
  it('stary desktop bez nowych komend używa print_page', async () => {
    ;(window as any).__TAURI_INTERNALS__ = {}
    invoke.mockImplementation(async (cmd: string) => { if (cmd === 'druk_drukarki') throw new Error('command druk_drukarki not found') })
    const { drukuj } = await import('./print')
    await drukuj({ rodzaj: 'wz' })
    expect(invoke).toHaveBeenCalledWith('print_page')
    expect(otworzOknoDruku).not.toHaveBeenCalled()
  })
  it('udany druk rejestruje dane z okna', async () => {
    nowyDesktop()
    otworzOknoDruku.mockResolvedValue({ wydrukowano: true, drukarka: 'bizhub', zasobnik: 'Zasobnik 3', kopie: 2, stron: 4 })
    const { drukuj } = await import('./print')
    await drukuj({ rodzaj: 'kartki-palet', tytul: 'Kartki palet — TRUVA', rejestr: { orderId: 'o1', palletIds: ['p9', 'p14'] } })
    expect(otworzOknoDruku).toHaveBeenCalledWith({ rodzaj: 'kartki-palet', tytul: 'Kartki palet — TRUVA', zrodlo: { typ: 'strona' } })
    expect(zarejestruj).toHaveBeenCalledWith({ rodzaj: 'kartki-palet', tytul: 'Kartki palet — TRUVA', orderId: 'o1', palletIds: ['p9', 'p14'],
      drukarka: 'bizhub', zasobnik: 'Zasobnik 3', kopie: 2, stron: 4 })
    expect(invoke).not.toHaveBeenCalledWith('print_page')
  })
  it('PDF z serwera idzie do okna jako źródło pdf', async () => {
    nowyDesktop()
    otworzOknoDruku.mockResolvedValue({ wydrukowano: false })
    const { drukuj } = await import('./print')
    await drukuj({ rodzaj: 'wz', tytul: 'WZ', pdfBase64: 'QUJD' })
    expect(otworzOknoDruku).toHaveBeenCalledWith({ rodzaj: 'wz', tytul: 'WZ', zrodlo: { typ: 'pdf', pdfBase64: 'QUJD' } })
  })
  it('anulowanie nie rejestruje', async () => {
    nowyDesktop()
    otworzOknoDruku.mockResolvedValue({ wydrukowano: false })
    const { drukuj } = await import('./print')
    await drukuj({ rodzaj: 'wz' })
    expect(zarejestruj).not.toHaveBeenCalled()
  })
  it('druk systemowy po błędzie woła print_page i rejestruje', async () => {
    nowyDesktop()
    otworzOknoDruku.mockResolvedValue({ systemowe: true })
    const { drukuj } = await import('./print')
    await drukuj({ rodzaj: 'cmr', tytul: 'CMR 5' })
    expect(invoke).toHaveBeenCalledWith('print_page')
    expect(zarejestruj).toHaveBeenCalledWith({ rodzaj: 'cmr', tytul: 'CMR 5', kopie: 1, drukarka: 'okno systemowe' })
  })
  it('bez rodzaju dokumentu zapisuje „inne” z tytułem strony', async () => {
    nowyDesktop()
    document.title = 'Plan masowania 19.11'
    otworzOknoDruku.mockResolvedValue({ wydrukowano: true, drukarka: 'bizhub', zasobnik: 'Zasobnik 1', kopie: 1, stron: 1 })
    const { drukuj } = await import('./print')
    await drukuj()
    expect(otworzOknoDruku).toHaveBeenCalledWith({ rodzaj: 'inne', tytul: 'Plan masowania 19.11', zrodlo: { typ: 'strona' } })
  })
})
