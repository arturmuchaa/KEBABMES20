/**
 * Most do części Windows aplikacji (komendy `druk_*` w src-tauri/src/druk).
 * Poza aplikacją Tauri albo w starej wersji bez tych komend `dostepny()` = false.
 */
import type { Drukarka, Mozliwosci } from './typy'

const wTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function wywolaj<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

export const natywny = {
  drukarki: () => wywolaj<Drukarka[]>('druk_drukarki'),
  mozliwosci: (drukarka: string, ticket?: string | null) => wywolaj<Mozliwosci>('druk_mozliwosci', { drukarka, ticket: ticket ?? null }),
  ustawOpcje: (ticket: string, funkcja: string, opcja: string) => wywolaj<string>('druk_ustaw_opcje', { ticket, funkcja, opcja }),
  ustawieniaSterownika: (drukarka: string, ticket: string) => wywolaj<string>('druk_ustawienia_sterownika', { drukarka, ticket }),
  stronaPdf: () => wywolaj<string>('druk_strona_pdf'),
  drukujPdf: (a: { drukarka: string; pdfBase64: string; ticket: string; kopie: number; od?: number; do?: number; tytul: string }) =>
    wywolaj<number>('druk_pdf', { drukarka: a.drukarka, pdf: a.pdfBase64, ticket: a.ticket, kopie: a.kopie, od: a.od ?? null, do: a.do ?? null, tytul: a.tytul }),
  czytajPlik: () => wywolaj<string>('druk_ustawienia_czytaj'),
  zapiszPlik: (json: string) => wywolaj<void>('druk_ustawienia_zapisz', { json }),
  komputer: async () => { if (!wTauri()) return 'przeglądarka'; try { return await wywolaj<string>('druk_komputer') } catch { return '' } },
  /** Czy można drukować natywnie (Tauri + nowe komendy). Nigdy nie rzuca. */
  dostepny: async () => {
    if (!wTauri()) return false
    try { await wywolaj('druk_drukarki'); return true } catch { return false }
  },
}
