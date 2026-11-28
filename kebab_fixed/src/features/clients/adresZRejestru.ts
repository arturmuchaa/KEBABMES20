/**
 * Adres z rejestru → pola kartoteki (stary MES).
 *
 * Od 27.11.2026 serwer oddaje adres już rozbity i sformatowany (ulica
 * z numerem, kod, miasto, kraj) — dla GUS/MF i VIES. Zgadywanie po stronie
 * przeglądarki zostaje tylko jako zapas dla starszego serwera.
 */
import type { NipCompany, ViesCompany } from '@/lib/api'

export interface AdresKarty { address: string; postalCode: string; city: string; country: string }

export function adresZGus(d: Omit<Partial<NipCompany>, 'zrodlo'>): AdresKarty {
  const base = [d.ulica, d.numer_budynku].filter(Boolean).join(' ').trim()
  return { address: d.numer_lokalu ? `${base}/${d.numer_lokalu}` : base, postalCode: d.kod_pocztowy ?? '', city: d.miasto ?? '', country: d.kraj || 'PL' }
}

function kodIMiasto(line: string): { postalCode: string; city: string } {
  const m = line.match(/^([0-9][0-9\s-]{1,9})\s+(.+)$/)
  return m ? { postalCode: m[1].trim(), city: m[2].trim() } : { postalCode: '', city: line }
}

export function adresZVies(d: ViesCompany): AdresKarty {
  const country = d.kraj || d.countryCode || ''
  if (d.ulica !== undefined || d.miasto !== undefined) {
    return { address: d.ulica ?? '', postalCode: d.kodPocztowy ?? '', city: d.miasto ?? '', country }
  }
  const raw = d.traderAddress ?? ''
  const lines = raw.split(/[\n\r]+/).map(s => s.trim()).filter(Boolean)
  if (!lines.length) return { address: '', postalCode: '', city: '', country }
  const bezKraju = (s: string) => (country ? s.replace(new RegExp(`^${country}\\s*-\\s*`, 'i'), '') : s)
  if (lines.length === 1) {
    const m = lines[0].match(/^(.*?)[,\s]+((?:[A-Z]{1,2}\s*-\s*)?\d[\d\s-]{2,}\s+.+)$/)
    return m ? { address: m[1].trim(), ...kodIMiasto(bezKraju(m[2].trim())), country } : { address: lines[0], postalCode: '', city: '', country }
  }
  return { address: lines.slice(0, -1).join(', '), ...kodIMiasto(bezKraju(lines[lines.length - 1])), country }
}
