// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
afterEach(() => {
  vi.restoreAllMocks(); vi.resetModules(); invoke.mockReset()
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
