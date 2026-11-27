import React, { useMemo } from 'react'
import { Plus, Search } from 'lucide-react'
import type { LabelDesignSummary } from '@/lib/api'

/** Szablony pogrupowane klientem; przy każdym sposób druku i przypisanie. */
export function ListaSzablonow({ lista, wybranyId, szukaj, onSzukaj, onWybierz, onNowy }: {
  lista: LabelDesignSummary[]; wybranyId: string | null; szukaj: string
  onSzukaj: (q: string) => void; onWybierz: (id: string) => void; onNowy: () => void
}) {
  const grupy = useMemo(() => {
    const q = szukaj.trim().toLocaleLowerCase('pl')
    const m = new Map<string, LabelDesignSummary[]>()
    for (const d of lista) {
      if (q && ![d.name, d.clientName, d.recipeName, d.productTypeName].some(t => (t || '').toLocaleLowerCase('pl').includes(q))) continue
      const k = d.clientName || '—'
      m.set(k, [...(m.get(k) ?? []), d])
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pl'))
  }, [lista, szukaj])

  return (
    <aside className="et-lista" aria-label="Szablony etykiet">
      <div className="et-lista-g">
        <label className="et-szukaj"><Search size={14} />
          <input className="field" type="search" placeholder="Klient, receptura…" value={szukaj} onChange={e => onSzukaj(e.target.value)} aria-label="Szukaj szablonu" /></label>
        <button className="btn sm" onClick={onNowy}><Plus size={14} />Nowy</button>
      </div>
      <div className="et-lista-b">
        {!lista.length && <p className="muted et-pad">Nie ma jeszcze szablonów. Załóż pierwszy z pliku PDF albo z ZebraDesigner.</p>}
        {lista.length > 0 && !grupy.length && <p className="muted et-pad">Nic nie pasuje do „{szukaj}”.</p>}
        {grupy.map(([klient, szablony]) => (
          <section key={klient} className="et-grupa">
            <h4>{klient}</h4>
            {szablony.map(d => (
              <button key={d.id} type="button" className={`et-szablon${d.id === wybranyId ? ' sel' : ''}`} aria-pressed={d.id === wybranyId} onClick={() => onWybierz(d.id)}>
                <span className="l1"><b>{d.name}</b></span>
                <span className="l2">
                  <span className={`tag ${d.printMode === 'a4' ? 'outline' : 'neutral'}`}>{d.printMode === 'a4' ? `A4 × ${d.labelsPerSheet}` : `Zebra ${Math.round(d.widthMm)} × ${Math.round(d.heightMm)}`}</span>
                  <span className="muted">{[d.productTypeName || 'każdy rodzaj', d.recipeName || 'każda receptura'].join(' · ')}</span>
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </aside>
  )
}
