/**
 * Ślad skanowania palet zamówienia.
 *
 * Odpowiada na pytanie biura „czy gdzieś sztuka nie zginęła" (właściciel,
 * 22.09.2026): paleta ze skanem do mroźni i bez skanu na auto stoi w chłodni;
 * paleta z cofnięciem i bez ponownego skanu została zdjęta i nikt jej nie
 * wrócił. Dziś obie sytuacje są niewidoczne, mimo że `pallet_scans` zapisuje
 * każdy skan od zawsze.
 *
 * ETAPY PO POLSKU. Kod z bazy (`cold_storage`, `loaded`, `undo`) nic biuru
 * nie mówi, a to biuro tego szuka, nie serwisant.
 *
 * PALETA BEZ ZDARZEŃ JEST OPISANA WPROST, nie pominięta — to dokładnie ta,
 * której ktoś szuka.
 */
import { useEffect, useState } from 'react'
import { palletScanApi } from '@/lib/api'

interface Zdarzenie {
  action: string
  scanned_at: string
  operator: string
  vehicle: string
}

interface SladPalety {
  pallet_no: number
  status: string
  zdarzenia: Zdarzenie[]
}

const ETAP: Record<string, string> = {
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

export function SladSkanowania({ orderId }: { orderId: string }) {
  const [slad, setSlad] = useState<SladPalety[] | null>(null)
  const [blad, setBlad] = useState('')

  useEffect(() => {
    let porzucone = false
    palletScanApi.slad(orderId)
      .then(r => { if (!porzucone) setSlad(r as SladPalety[]) })
      .catch(() => { if (!porzucone) { setSlad([]); setBlad('Nie udało się wczytać śladu') } })
    return () => { porzucone = true }
  }, [orderId])

  if (slad === null) {
    return <div className="p-3 text-[12px] text-muted-foreground">Wczytuję ślad…</div>
  }
  if (blad) {
    return <div className="p-3 text-[12px] text-red-700">{blad}</div>
  }
  if (!slad.length) {
    return <div className="p-3 text-[12px] text-muted-foreground">To zamówienie nie ma palet.</div>
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {slad.map(p => (
        <div key={p.pallet_no} className="rounded-lg border bg-background p-2.5">
          <div className="mb-1.5 text-[12.5px] font-bold">Paleta P{p.pallet_no}</div>
          {p.zdarzenia.length === 0 ? (
            <div className="text-[12px] text-amber-700">
              Brak zdarzeń — <b>nikt jej nie skanował</b>.
            </div>
          ) : (
            <ul className="m-0 list-none p-0">
              {p.zdarzenia.map((z, i) => (
                <li key={i} data-akcja={z.action}
                  className="flex items-baseline gap-3 border-t py-1 first:border-t-0">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {godzina(z.scanned_at)}
                  </span>
                  <span className={`text-[12.5px] font-bold ${
                    z.action === 'undo' ? 'text-amber-700' : ''}`}>
                    {ETAP[z.action] ?? z.action}
                  </span>
                  {z.vehicle ? (
                    <span className="text-[11px] text-muted-foreground">{z.vehicle}</span>
                  ) : null}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {z.operator || '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}
