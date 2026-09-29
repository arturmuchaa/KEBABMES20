/**
 * Werdykt ważenia kartonu przy wjeździe do mroźni — PODGLĄD na ekranie.
 *
 * Ta sama reguła co `backend/app/utils/wazenie_mrozni.py`; zapisuje się
 * werdykt policzony przez serwer. Zgodna ⇔ netto ze sztuk mieści się
 * w [brutto − taraDo − zapas, brutto − taraOd + zapas], zapas = netto × %.
 */
import type { PaletaMrozni, PozycjaSkladu } from '@/lib/api'

export interface Werdykt {
  ok: boolean
  /** (brutto − tara środkowa) − netto, zaokrąglone do 0,1 kg. */
  diffKg: number
  tareKg: number
}

const r2 = (v: number) => Math.round(v * 100) / 100

export function werdyktWagi(netKg: number, grossKg: number, p: PaletaMrozni): Werdykt {
  const zapas = (netKg * (p.marginPct || 0)) / 100
  const lo = r2(grossKg - p.tareMaxKg - zapas)
  const hi = r2(grossKg - p.tareMinKg + zapas)
  const tara = (p.tareMinKg + p.tareMaxKg) / 2
  const net = r2(netKg)
  return { ok: lo <= net && net <= hi, diffKg: Math.round((grossKg - tara - netKg) * 10) / 10, tareKg: r2(tara) }
}

/** Kilogramy po polsku: przecinek, bez zbędnego „,0". */
export function kgPl(kg: number, miejsc = 1): string {
  const m = 10 ** miejsc
  const v = Math.round(kg * m) / m
  return String(v).replace('.', ',')
}

/** „15 × 50 kg ZAGROS" — jak magazynier czyta skład kartonu. */
export function opisPozycji(l: PozycjaSkladu): string {
  return `${l.qty} × ${kgPl(l.kgPerUnit, 3)} kg ${l.recipeName}`.trim()
}

/** „+12,5 kg" / „−3 kg" — różnica ze znakiem (minus typograficzny). */
export function roznicaPl(diffKg: number): string {
  if (diffKg === 0) return '0 kg'
  return `${diffKg > 0 ? '+' : '−'}${kgPl(Math.abs(diffKg))} kg`
}
