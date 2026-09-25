/**
 * Jak karton opisuje się człowiekowi — jedno miejsce dla listy, pakowania
 * i alarmów, żeby ten sam karton nie nazywał się na trzech ekranach inaczej.
 */
import type { KartonPozycja, OtwartyKarton } from '@/lib/api'
import { kgTxt } from './pula'

/** „KIRMIZI · UDO 100% · METAL 80 · 15 kg" */
export function opisPozycji(p: KartonPozycja): string {
  return [p.recipeName, p.productTypeName, p.packagingName, `${kgTxt(p.kgPerUnit)} kg`]
    .filter(Boolean).join(' · ')
}

/** Skład jednym zdaniem; karton mieszany → „KIRMIZI 15 kg + YAPRAK 25 kg". */
export function skladKartonu(k: OtwartyKarton): string {
  if (!k.lines.length) return '—'
  if (k.lines.length === 1) return opisPozycji(k.lines[0])
  return k.lines.map(p => `${p.recipeName} ${kgTxt(p.kgPerUnit)} kg`).join(' + ')
}

export function brakuje(k: OtwartyKarton): number {
  return Math.max(0, k.targetQty - k.packedQty)
}

/** Zamówienie albo „na magazyn" — jedyna różnica między dwoma rodzajami kartonu. */
export function dokadKarton(k: OtwartyKarton): string {
  if (k.kind === 'order') return `${k.orderNo}${k.palletNo ? ` · P${k.palletNo}` : ''}`
  return k.orderNo ? `magazyn → ${k.orderNo}` : 'na magazyn'
}
