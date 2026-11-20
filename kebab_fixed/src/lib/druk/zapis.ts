/**
 * Zapis PDF wprost na dysk — bez okna druku i „Microsoft Print to PDF”.
 * Właściciel 20.11.2026: zapis jak w starym MES (plik nazwany po dokumencie,
 * np. WZ_KLIENT_nr.pdf, do folderu Pobrane); kilka zaznaczonych = osobne pliki.
 *
 * Aplikacja z komendą `druk_zapisz_pdf` → Pobrane; starsza aplikacja →
 * `open_document` (otwiera w czytniku, jak dotąd); przeglądarka → pobieranie.
 */
import { doBase64 } from './base64'

const wTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: i } = await import('@tauri-apps/api/core')
  return i<T>(cmd, args)
}

function pobierzWPrzegladarce(blob: Blob, nazwa: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nazwa
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

/** Blob → bajty; FileReader tam, gdzie Blob nie ma `arrayBuffer` (starsze WebView, jsdom). */
function bajtyBloba(b: Blob): Promise<Uint8Array> {
  if (typeof b.arrayBuffer === 'function') return b.arrayBuffer().then(x => new Uint8Array(x))
  return new Promise((ok, zle) => {
    const r = new FileReader()
    r.onerror = () => zle(new Error('Nie udało się odczytać dokumentu'))
    r.onload = () => ok(new Uint8Array(r.result as ArrayBuffer))
    r.readAsArrayBuffer(b)
  })
}

export interface Zapisany { nazwa: string; sciezka: string | null }

/** Jeden PDF na dysk. `sciezka` = pełna ścieżka w Pobranych (null w przeglądarce / starej aplikacji). */
export async function zapiszPdf(nazwa: string, dane: Blob | Uint8Array): Promise<Zapisany> {
  const blob = dane instanceof Blob ? dane : new Blob([dane.slice().buffer as ArrayBuffer], { type: 'application/pdf' })
  if (!wTauri()) { pobierzWPrzegladarce(blob, nazwa); return { nazwa, sciezka: null } }
  const b64 = doBase64(dane instanceof Uint8Array ? dane : await bajtyBloba(dane))
  try {
    return { nazwa, sciezka: await invoke<string>('druk_zapisz_pdf', { nazwa, pdf: b64 }) }
  } catch (e) {
    // Stara aplikacja nie zna komendy — otwieramy jak dotąd. Prawdziwy błąd zapisu idzie wyżej.
    if (!/not found|unknown command|nie znaleziono komendy/i.test(String(e))) throw e instanceof Error ? e : new Error(String(e))
    await invoke('open_document', { name: nazwa, data: b64 })
    return { nazwa, sciezka: null }
  }
}

/** Pokaż plik w Eksploratorze. Nigdy nie rzuca (to tylko wygoda). */
export async function pokazPlik(sciezka: string): Promise<void> {
  try { await invoke('druk_pokaz_plik', { sciezka }) } catch { /* starsza aplikacja */ }
}

/** Folder z pełnej ścieżki Windows/Unix — do komunikatu „zapisano w …”. */
export const folderPliku = (sciezka: string) => sciezka.replace(/[\\/][^\\/]*$/, '')
