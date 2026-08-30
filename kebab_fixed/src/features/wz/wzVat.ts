/**
 * VAT na dokumencie WZ.
 *
 * Do 30.08.2026 WZ nie znało VAT-u w ogóle: kolumna „Wartość" była kwotą
 * netto i na tym się kończyło. Dla sprzedaży krajowej biuro musiało dopisywać
 * podatek ręcznie przy fakturze.
 *
 * Stawka jest CECHĄ POZYCJI, nie dokumentu — jedno auto potrafi wieźć wyrób
 * (5 %) i pozycję opodatkowaną inaczej. Domyślną stawkę bierzemy z NIP-u
 * nabywcy, ale biuro może ją zmienić w każdym wierszu.
 */

/** Stawka dla wyrobów spożywczych w kraju. */
export const VAT_KRAJOWY = 5

/** Stawki do wyboru w formularzu. 0 % = WDT / eksport. */
export const STAWKI_VAT = [0, 5, 8, 23]

/**
 * Czy NIP jest polski. Kontrahenci zagraniczni mają w kartotece prefiks
 * kraju („CZ03678580", „DE232653399", „FR77988827754"), krajowi same cyfry.
 */
export function nipKrajowy(nip: string | undefined | null): boolean {
  const czysty = String(nip ?? '').replace(/[\s-]/g, '').toUpperCase()
  if (!czysty) return true          // brak NIP-u = sprzedaż krajowa (os. fizyczna)
  if (czysty.startsWith('PL')) return true
  return !/^[A-Z]{2}/.test(czysty)
}

/** Domyślna stawka dla nabywcy: kraj 5 %, zagranica 0 % (WDT/eksport). */
export function stawkaVatDlaNabywcy(nip: string | undefined | null): number {
  return nipKrajowy(nip) ? VAT_KRAJOWY : 0
}

export interface PozycjaVat {
  value?: number | null
  vat_rate?: number | null
}

export interface WierszPodsumowaniaVat {
  stawka: number
  netto: number
  vat: number
  brutto: number
}

const grosze = (n: number) => Math.round(n * 100) / 100

/**
 * Podsumowanie w rozbiciu na stawki — tak, jak wygląda stopka faktury.
 *
 * VAT liczymy od SUMY netto w stawce, a nie od każdej pozycji osobno:
 * zaokrąglanie pozycja po pozycji potrafi rozjechać się z fakturą o grosze,
 * a to właśnie WZ jest podkładką pod fakturę.
 */
export function podsumowanieVat(lines: readonly PozycjaVat[]): {
  wiersze: WierszPodsumowaniaVat[]
  netto: number
  vat: number
  brutto: number
} {
  const wgStawki = new Map<number, number>()
  for (const l of lines) {
    const stawka = Number(l.vat_rate ?? 0)
    wgStawki.set(stawka, (wgStawki.get(stawka) ?? 0) + Number(l.value ?? 0))
  }

  const wiersze = [...wgStawki.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([stawka, netto]) => {
      const n = grosze(netto)
      const v = grosze(n * stawka / 100)
      return { stawka, netto: n, vat: v, brutto: grosze(n + v) }
    })

  return {
    wiersze,
    netto: grosze(wiersze.reduce((s, w) => s + w.netto, 0)),
    vat: grosze(wiersze.reduce((s, w) => s + w.vat, 0)),
    brutto: grosze(wiersze.reduce((s, w) => s + w.brutto, 0)),
  }
}

/** Czy dokument ma cokolwiek do pokazania w sekcji VAT. */
export function maVat(lines: readonly PozycjaVat[]): boolean {
  return lines.some(l => Number(l.vat_rate ?? 0) > 0)
}
