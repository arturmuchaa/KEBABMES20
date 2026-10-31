import { Scale } from 'lucide-react'
import { FlagIcon } from '../../../ui/Glyphs'
import { SzkieletBloku } from '../../../ui/Szkielet'
import type { Pallet } from '../../../data/model'
import { useApi } from '@/hooks/useApi'
import { magazynApi, type WazenieMrozni } from '@/lib/api'

const kg1 = (v: number) => `${v.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`
/** Ważenie dotyczy tylko pełnego kartonu — rozpisanej albo pakowanej palety nie pytamy serwera. */
const SPAKOWANA: ReadonlyArray<Pallet['status']> = ['packed', 'cold', 'loaded', 'shipped']

/**
 * Ważenie palety przed mroźnią (kiosk magazynu) — ostatnie ważenie wygrywa.
 * Serwer liczy werdykt: brutto z wagi − tara palety vs netto ze sztuk, z zapasem %.
 * Niezgodna waga nie blokuje (decyzja właściciela) — tu tylko ostrzeżenie.
 */
export function WazeniePalety({ p }: { p: Pallet }) {
  const spakowana = SPAKOWANA.includes(p.status)
  const res = useApi<WazenieMrozni | null>(async () => {
    if (!spakowana) return null
    try {
      return await magazynApi.mrozniaOstatnieWazenie(p.id)
    } catch (e) {
      // 404 „Ten karton nie był ważony” to stan palety, nie błąd ekranu.
      if (/404|nie był ważony/i.test(e instanceof Error ? e.message : String(e))) return null
      throw e
    }
  }, [p.id, spakowana])

  if (!spakowana) return <div className="waz waz-brak"><Scale size={15} /><span>Rozpisana — ważenie po spakowaniu, przed mroźnią.</span></div>
  if (res.error) return <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>Nie udało się pobrać ważenia: {res.error}</div></div>
  if (res.loading && !res.data) return <SzkieletBloku linie={2} opis="Pobieranie ważenia…" />
  const w = res.data
  if (!w) return p.status === 'cold' || p.status === 'loaded' || p.status === 'shipped'
    ? <div className="note warn"><FlagIcon level="warn" size={15} /><div><b>Niezważona</b> — paleta przeszła dalej bez ważenia („zważ później”). Kiosk magazynu: Mroźnia → zważ.</div></div>
    : <div className="waz waz-brak"><Scale size={15} /><span>Spakowana, czeka na ważenie przed mroźnią.</span></div>
  const nettoZWagi = Math.round((w.grossKg - w.tareKg) * 10) / 10
  return (
    <div className="waz" aria-label={`Ważenie palety ${p.no}`}>
      <div className={`waz-h ${w.ok ? 'ok' : 'warn'}`}>
        <Scale size={15} />
        <b>{w.ok ? 'Zważona — waga zgodna' : `Zważona — NIEZGODNA ${w.diffKg > 0 ? '+' : ''}${kg1(w.diffKg)}`}</b>
      </div>
      <dl className="kv">
        <dt>Paleta</dt><dd>{w.palletTypeName || '—'} <span className="muted">· tara {kg1(w.tareMinKg)}–{kg1(w.tareMaxKg)}</span></dd>
        <dt>Brutto</dt><dd className="num strong">{kg1(w.grossKg)}{w.weighMode === 'manual' && <span className="tag warn" style={{ marginLeft: 6 }}>ręcznie</span>}</dd>
        <dt>Netto ze sztuk</dt><dd className="num">{kg1(w.netKg)}</dd>
        <dt>Netto z wagi</dt><dd className="num">{kg1(nettoZWagi)} <span className="muted">(brutto − tara)</span></dd>
        <dt>Zważono</dt><dd>{w.weighedAt ? new Date(w.weighedAt).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—'}{w.operator ? ` · ${w.operator}` : ''}</dd>
      </dl>
    </div>
  )
}
