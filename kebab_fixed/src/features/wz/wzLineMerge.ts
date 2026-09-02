/**
 * wzLineMerge — scalanie pozycji na dokumencie WZ.
 *
 * Dokument pokazuje TOWAR, nie partie: „Udo z kurczaka 40 kg" z trzech
 * partii to jedna pozycja z sumą sztuk i kilogramów. Rozbicie na partie
 * daje sekcja identyfikacji pod tabelą, a dane dokumentu w bazie zostają
 * per partia — scalanie jest sposobem WYŚWIETLANIA, nie zapisem.
 *
 * Co NIE może się scalić i dlaczego:
 *   * inna stawka VAT — podsumowanie rozbija kwoty po stawkach,
 *   * inna cena albo waga sztuki — to inny towar handlowo,
 *   * inna NAZWA — a nazwa niesie rozmiar niestandardowej tulei
 *     („…40kg (80cm)"), więc 80 cm nigdy nie wpada do worka ze standardem.
 *
 * Wydzielone z WzDocumentView 2026-09-02: to logika decydująca o treści
 * dokumentu handlowego, a siedziała bez testów w środku komponentu.
 */
import { sortujPozycjeWz } from './wzLineOrder'

/** Minimum, jakiego wymaga scalanie. Funkcja jest RODZAJOWA — oddaje
 *  dokładnie ten typ pozycji, który dostała, bez gubienia pól. */
interface PozycjaWz {
  name: string
  qty: number
  unit?: string
  price?: number | null
  value?: number | null
  kg_per_unit?: number | null
  total_kg?: number | null
  vat_rate?: number | null
}

/** Klucz scalania — wszystko, co czyni pozycję ODRĘBNĄ na papierze. */
function klucz(l: PozycjaWz): string {
  return [l.name, l.unit, l.price ?? '', l.kg_per_unit ?? '', l.vat_rate ?? ''].join('|')
}

/**
 * Pozycje gotowe do wydruku: posortowane regułą dokumentu, potem scalone.
 *
 * Sortujemy PRZED scalaniem, żeby kolejność wynikowa szła z reguły, a nie
 * z tego, w jakiej kolejności biuro dokładało pozycje do koszyka.
 */
export function scalPozycjeWz<T extends PozycjaWz>(lines: readonly T[]): T[] {
  const wg = new Map<string, T>()
  const out: T[] = []
  for (const l of sortujPozycjeWz(lines as any) as T[]) {
    const k = klucz(l)
    const m = wg.get(k)
    if (!m) {
      // Kopia — scalanie nie ma prawa ruszyć danych dokumentu.
      const c = { ...l }
      wg.set(k, c)
      out.push(c)
      continue
    }
    m.qty = Number(m.qty) + Number(l.qty)
    if ((l.total_kg ?? 0) > 0 || (m.total_kg ?? 0) > 0) {
      m.total_kg = Number(m.total_kg ?? 0) + Number(l.total_kg ?? 0)
    }
    // Wartość sumujemy TYLKO gdy którakolwiek pozycja ją ma — WZ wstępny
    // idzie bez cen i nie może dostać zera udającego kwotę.
    if (l.value != null || m.value != null) {
      m.value = Number(m.value ?? 0) + Number(l.value ?? 0)
    }
  }
  return out
}
