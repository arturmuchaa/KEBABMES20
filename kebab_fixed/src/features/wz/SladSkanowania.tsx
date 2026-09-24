/**
 * Ślad palety: skład + łańcuch skanowania. Treść okna otwieranego z Wydań.
 *
 * Właściciel 24.09.2026: „P1 na auto nic mi nie mówi ani jak ślad tej palety,
 * ani co się działo ze sztukami — chcę skład palety i łańcuch produkcja →
 * magazyn → wydanie, gdzie ewentualnie jaka sztuka zaginęła przy reklamacji".
 *
 * Trzy rzeczy, które to okno musi robić dobrze:
 *
 * 1. ETAPY PO POLSKU. Kod z bazy (`cold_storage`, `loaded`, `undo`) nic biuru
 *    nie mówi, a to biuro tego szuka, nie serwisant.
 * 2. PALETA BEZ SKANÓW ZOSTAJE NA LIŚCIE — to dokładnie ta, której ktoś szuka.
 * 3. ETAP BEZ ŹRÓDŁA JEST NAZWANY WPROST. „Nie skanowane na tym etapie" to
 *    inna informacja niż „brak skanu" i przy reklamacji decyduje o odpowiedzi:
 *    dalej niż paleta nie wiemy, bo hala nie skanuje sztuk ([[etapyPalety]]).
 */
import { useEffect, useState } from 'react'
import { palletScanApi } from '@/lib/api'
import { etapyPalety, type SladPalety } from './etapyPalety'

const AKCJA: Record<string, string> = {
  cold_storage: 'Mroźnia',
  loaded: 'Na auto',
  undo: 'Cofnięto',
  reset: 'Wyzerowano',
  shipped: 'Wydane',
}

function godzina(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString('pl-PL',
      { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

function Lancuch({ paleta }: { paleta: SladPalety }) {
  return (
    <ol className="m-0 list-none p-0">
      {etapyPalety(paleta).map(etap => (
        <li key={etap.kod} data-etap={etap.kod} data-stan={etap.stan}
            className="border-l-2 pl-3 pb-3 last:pb-0 border-surface-4">
          <div className="flex items-baseline gap-2">
            <span className="text-[12.5px] font-bold">{etap.nazwa}</span>
            <span className="text-[10.5px] text-muted-foreground">{etap.opis}</span>
          </div>

          {etap.stan === 'brak_zrodla' && (
            <div className="mt-0.5 text-[11.5px] italic text-amber-700">
              Nie skanowane na tym etapie — ślad się tu urywa.
            </div>
          )}
          {etap.stan === 'pusty' && (
            <div className="mt-0.5 text-[11.5px] text-muted-foreground">
              Brak skanu tej palety na tym etapie.
            </div>
          )}

          {etap.zdarzenia.map((z, i) => (
            <div key={i} data-akcja={z.action}
                 className="mt-1 flex items-baseline gap-3 text-[12px]">
              <span className="font-mono text-[11px] text-muted-foreground">
                {godzina(z.scanned_at)}
              </span>
              <span className={`font-bold ${z.action === 'undo' ? 'text-amber-700' : ''}`}>
                {AKCJA[z.action] ?? z.action}
              </span>
              {z.vehicle ? <span className="text-[11px] text-muted-foreground">{z.vehicle}</span> : null}
              <span className="ml-auto text-[11px] text-muted-foreground">{z.operator || '—'}</span>
            </div>
          ))}
        </li>
      ))}
    </ol>
  )
}

function Sklad({ paleta }: { paleta: SladPalety }) {
  const { zadeklarowane, sledzone } = paleta.sztuki ?? { zadeklarowane: 0, sledzone: 0 }
  return (
    <div>
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        Skład palety
      </div>
      {(paleta.sklad ?? []).length === 0 ? (
        <div className="text-[12px] text-muted-foreground">Brak rozpisu dla tej palety.</div>
      ) : (
        <table className="w-full text-[12px]">
          <tbody>
            {paleta.sklad.map((s, i) => (
              <tr key={i} className="border-t first:border-t-0">
                <td className="py-1 font-mono font-bold tabular-nums">{s.qty} szt</td>
                <td className="py-1 font-mono tabular-nums text-muted-foreground">
                  × {s.kg_per_unit} kg
                </td>
                <td className="py-1">{s.rodzaj}</td>
                <td className="py-1 text-muted-foreground">{s.receptura}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {/* Różnica „wg rozpisu" kontra „z własnym numerem" to jedyna uczciwa
          odpowiedź na pytanie o konkretną sztukę, dopóki hala nie skanuje. */}
      <div className="mt-1.5 text-[11.5px] text-muted-foreground">
        <b className="tabular-nums">{zadeklarowane}</b> szt wg rozpisu ·{' '}
        <b className="tabular-nums">{sledzone}</b> z własnym numerem
        {sledzone < zadeklarowane && (
          <span className="ml-1 text-amber-700">
            — pojedynczej sztuki nie da się dziś wskazać
          </span>
        )}
      </div>
    </div>
  )
}

export function SladSkanowania({ orderId }: { orderId: string }) {
  const [slad, setSlad] = useState<SladPalety[] | null>(null)
  const [blad, setBlad] = useState('')
  const [wybrana, setWybrana] = useState<number | null>(null)

  useEffect(() => {
    let porzucone = false
    palletScanApi.slad(orderId)
      .then(r => {
        if (porzucone) return
        const lista = r as SladPalety[]
        setSlad(lista)
        setWybrana(lista.length ? lista[0].pallet_no : null)
      })
      .catch(() => { if (!porzucone) { setSlad([]); setBlad('Nie udało się wczytać śladu') } })
    return () => { porzucone = true }
  }, [orderId])

  if (slad === null) return <div className="p-4 text-[12px] text-muted-foreground">Wczytuję ślad…</div>
  if (blad) return <div className="p-4 text-[12px] text-red-700">{blad}</div>
  if (!slad.length) return <div className="p-4 text-[12px] text-muted-foreground">To zamówienie nie ma palet.</div>

  const paleta = slad.find(p => p.pallet_no === wybrana) ?? slad[0]

  return (
    <div className="flex gap-4 p-4 max-sm:flex-col">
      <div className="flex shrink-0 flex-col gap-1 sm:w-44 max-sm:flex-row max-sm:flex-wrap">
        {slad.map(p => {
          const pusta = (p.zdarzenia ?? []).length === 0
          return (
            <button key={p.pallet_no} type="button"
              onClick={() => setWybrana(p.pallet_no)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                p.pallet_no === paleta.pallet_no ? 'border-ink bg-muted' : 'hover:bg-muted/50'}`}>
              <div className="text-[12.5px] font-bold">Paleta P{p.pallet_no}</div>
              <div className="text-[11px] text-muted-foreground">
                {p.sztuki?.zadeklarowane ?? 0} szt
                {pusta && <span className="text-amber-700"> · nikt jej nie skanował</span>}
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Sklad paleta={paleta} />
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Łańcuch skanowania
          </div>
          <Lancuch paleta={paleta} />
        </div>
      </div>
    </div>
  )
}
