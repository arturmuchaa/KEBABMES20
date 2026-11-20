// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => tauri)
import { folderPliku, zapiszPdf } from './zapis'

afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; tauri.invoke.mockReset() })
const pdf = new Uint8Array([37, 80, 68, 70])

describe('zapis PDF bez okna druku', () => {
  it('aplikacja: plik idzie do Pobranych pod nazwą dokumentu', async () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    tauri.invoke.mockResolvedValue('C:\\Users\\biuro\\Downloads\\WZ_TRUVA_2-11-26.pdf')
    const z = await zapiszPdf('WZ_TRUVA_2-11-26.pdf', pdf)
    expect(tauri.invoke).toHaveBeenCalledWith('druk_zapisz_pdf', { nazwa: 'WZ_TRUVA_2-11-26.pdf', pdf: 'JVBERg==' })
    expect(z.sciezka).toBe('C:\\Users\\biuro\\Downloads\\WZ_TRUVA_2-11-26.pdf')
    expect(folderPliku(z.sciezka!)).toBe('C:\\Users\\biuro\\Downloads')
  })
  it('starsza aplikacja bez komendy: otwiera dokument jak dotąd', async () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    tauri.invoke.mockRejectedValueOnce('Command druk_zapisz_pdf not found').mockResolvedValueOnce('C:\\tmp\\x.pdf')
    const z = await zapiszPdf('x.pdf', pdf)
    expect(tauri.invoke).toHaveBeenLastCalledWith('open_document', { name: 'x.pdf', data: 'JVBERg==' })
    expect(z.sciezka).toBeNull()
  })
  it('prawdziwy błąd zapisu (np. brak miejsca) nie jest połykany', async () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    tauri.invoke.mockRejectedValue('Nie udało się zapisać C:\\x.pdf: brak miejsca')
    await expect(zapiszPdf('x.pdf', pdf)).rejects.toThrow(/brak miejsca/)
  })
  it('przeglądarka: zwykłe pobranie pliku', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn()
    const klik = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const z = await zapiszPdf('HDI_A_1.pdf', pdf)
    expect(klik).toHaveBeenCalled()
    expect(z).toEqual({ nazwa: 'HDI_A_1.pdf', sciezka: null })
    expect(tauri.invoke).not.toHaveBeenCalled()
  })
})
