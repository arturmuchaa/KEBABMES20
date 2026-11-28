/**
 * Statystyki rozbioru — czysta logika ekranu (bez Reacta): okresy, porównania,
 * „z wagi”, bilans masy. Spec 2026-11-28 §B.
 */
import type { DeboningStats } from '@/lib/api'
import { num } from '../../../data/model'

export type RodzajOkresu = 'dzis' | 'wczoraj' | '7dni' | 'miesiac' | 'zakres'
export interface Okres { od: string; do: string }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const zIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const plusDni = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const dniMiedzy = (a: string, b: string) => Math.round((zIso(b).getTime() - zIso(a).getTime()) / 86_400_000)
const krotko = (s: string) => { const [, m, d] = s.split('-'); return `${d}.${m}` }

export const ETYKIETA_OKRESU: Record<RodzajOkresu, string> = {
  dzis: 'Dziś', wczoraj: 'Wczoraj', '7dni': '7 dni', miesiac: 'Miesiąc', zakres: 'Zakres',
}

export function okres(rodzaj: RodzajOkresu, dzis: Date, zakres?: Okres): Okres & { etykieta: string; naZywo: boolean } {
  const d = iso(dzis)
  const r: Okres = rodzaj === 'dzis' ? { od: d, do: d }
    : rodzaj === 'wczoraj' ? { od: iso(plusDni(dzis, -1)), do: iso(plusDni(dzis, -1)) }
    : rodzaj === '7dni' ? { od: iso(plusDni(dzis, -6)), do: d }
    : rodzaj === 'miesiac' ? { od: iso(new Date(dzis.getFullYear(), dzis.getMonth(), 1)), do: d }
    : zakres ?? { od: d, do: d }
  return { ...r, etykieta: opisOkresu(r), naZywo: r.od <= d && d <= r.do }
}

export function opisOkresu(o: Okres): string {
  return o.od === o.do ? krotko(o.od) : `${krotko(o.od)} – ${krotko(o.do)}`
}

/** Przesuwa okres o jego długość; naprzód nigdy poza dziś. */
export function przesun(o: Okres, kierunek: -1 | 1, dzis: Date): Okres {
  const n = dniMiedzy(o.od, o.do) + 1
  const od = iso(plusDni(zIso(o.od), kierunek * n)), doo = iso(plusDni(zIso(o.do), kierunek * n))
  return doo > iso(dzis) ? o : { od, do: doo }
}

const ul1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 1 })

/** Zmiana względem poprzedniego okresu; `pp` = punkty procentowe, `%` = zmiana względna. */
export function delta(teraz: number | null | undefined, poprzednio: number | null | undefined,
  lepiej: 'wiecej' | 'mniej' | 'brak', jednostka: 'kg' | 'pp' | '%'): { tekst: string; poziom: 'dobrze' | 'zle' | 'neutral' } | null {
  if (teraz == null || poprzednio == null) return null
  let d: number
  if (jednostka === '%') { if (poprzednio === 0) return null; d = (teraz - poprzednio) / poprzednio * 100 } else d = teraz - poprzednio
  const r = jednostka === 'kg' ? Math.round(d) : Math.round(d * 10) / 10
  const jedn = jednostka === 'kg' ? ' kg' : jednostka === 'pp' ? ' p.p.' : '%'
  const liczba = jednostka === 'kg' ? num(Math.abs(r)) : jednostka === '%' ? String(Math.round(Math.abs(r))) : ul1(Math.abs(r))
  if (r === 0) return { tekst: `±0${jedn}`, poziom: 'neutral' }
  const tekst = `${r > 0 ? '+' : '−'}${liczba}${jedn}`
  const poziom = lepiej === 'brak' ? 'neutral' : (r > 0) === (lepiej === 'wiecej') ? 'dobrze' : 'zle'
  return { tekst, poziom }
}

export function tekstZWagi(w: NonNullable<DeboningStats['weighing']>): string {
  if (w.autoPct == null) return 'tryb nieznany'
  const p = `${ul1(w.autoPct)}% z wagi`
  return w.manualCount > 0 ? `${p} · ${w.manualCount} ręcznie` : p
}

export type KluczBilansu = 'zs' | 'bs' | 'grzbiety' | 'kosci' | 'ubytek'
export const ETYKIETA_BILANSU: Record<KluczBilansu, string> = {
  zs: 'Mięso z/s', bs: 'Mięso b/s', grzbiety: 'Grzbiety', kosci: 'Kości', ubytek: 'Ubytek',
}

/** Ćwiartka = 100%: mięso z/s | b/s | grzbiety | kości | ubytek. Nadwyżka → ubytek kg < 0, pct 0. */
export function pasekBilansu(s: DeboningStats): { klucz: KluczBilansu; kg: number; pct: number }[] {
  const q = s.summary.kgQuarter
  const mt = s.summary.meatByType
  const zs = mt ? mt.zs.kgMeat : s.summary.kgMeat
  const bs = mt ? mt.bs.kgMeat : 0
  const ub = s.summary.missingKg
  const kawalki: [KluczBilansu, number][] = [['zs', zs], ['bs', bs], ['grzbiety', s.summary.kgBacks], ['kosci', s.summary.kgBones], ['ubytek', ub]]
  const mian = ub < 0 ? q - ub : q
  return kawalki.map(([klucz, kg]) => ({ klucz, kg, pct: mian > 0 && kg > 0 ? kg / mian * 100 : 0 }))
}
