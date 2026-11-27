/**
 * Rozpis palet zamówienia — na liście kompletacji, w zamówieniu dla klienta
 * i jako osobny dokument.
 *
 * Właściciel 27.11.2026: „rozpis palet musi być na jednej stronie — jak np.
 * YALCIN się nie mieści, to cała kartka z rozpisem palet na drugiej stronie;
 * jeżeli małe zamówienie i się mieści, to może być na jednej”. Dlatego:
 *  - blok rozpisu NIGDY się nie łamie (`break-inside: avoid` w print.css),
 *  - gdy z szacunku wychodzi, że pod pozycjami się nie zmieści, dostaje
 *    `dk-page` — od nowej strony (sam druk też przeniósłby go w całości, ale
 *    szacunek daje ten sam wynik w podglądzie i na papierze),
 *  - karty palet idą w trzech kolumnach, żeby nawet 21 palet weszło na A4.
 */
import React from 'react'
import type { OrderPallet } from '@/lib/api'
import type { ClientOrder } from '@/lib/mockApi'

const nf = (n: number, d = 0) => new Intl.NumberFormat('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d === 0 ? 3 : d }).format(n).replace(/^(-?\d)(\d{3})(?=,|$)/, '$1 $2')
const dataPl = (iso?: string) => { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return d && m && y ? `${d}.${m}.${y}` : iso }

/** Wierszy tekstu (ok. 5 mm) na stronie A4 z marginesami. */
const WIERSZY_NA_STRONIE = 50
/** Nagłówek, sumy i stopka dokumentu z pozycjami — w wierszach. */
const WIERSZY_OBUDOWY = 16
const KOLUMN = 3

/** Wysokość rozpisu w wierszach: rząd kart = nagłówek karty + najdłuższa karta. */
function wierszeRozpisu(pallets: OrderPallet[]): number {
  let suma = 2
  for (let i = 0; i < pallets.length; i += KOLUMN) {
    const rzad = pallets.slice(i, i + KOLUMN)
    suma += 1.6 + Math.max(...rzad.map(p => p.items.length + (p.notes ? 1 : 0)))
  }
  return suma
}

/** Czy rozpis pod `pozycji` wierszami listy wyjdzie poza pierwszą stronę. */
export function rozpisNaOsobnejStronie(pozycji: number, pallets: OrderPallet[]): boolean {
  return WIERSZY_OBUDOWY + pozycji * 1.3 + wierszeRozpisu(pallets) > WIERSZY_NA_STRONIE
}

/**
 * Karty palet. `nowaStrona` — undefined = z szacunku (pod pozycjami
 * dokumentu), false = dokument sam w sobie (zaczyna się od góry strony).
 * `dlaKlienta` — bez uwag wewnętrznych przy paletach.
 */
export function RozpisPalet({ o, pallets, nowaStrona, dlaKlienta = false }: {
  o: ClientOrder; pallets: OrderPallet[]; nowaStrona?: boolean; dlaKlienta?: boolean
}) {
  const osobna = nowaStrona ?? rozpisNaOsobnejStronie(o.lines.length, pallets)
  const linia = (id: string) => o.lines.find(l => l.id === id)
  const posortowane = [...pallets].sort((a, b) => a.palletNo - b.palletNo)
  return (
    <section className={`dk-rozpis${osobna ? ' dk-page' : ''}`} aria-label="Rozpis palet">
      <h3>Rozpis palet — {o.orderNo} · {o.clientName} · {pallets.length} pal.</h3>
      <div className="dk-pals">{posortowane.map(p => {
        const kgP = p.items.reduce((s, it) => s + it.qty * (linia(it.orderLineId)?.kgPerUnit ?? 0), 0)
        return (
          <div key={p.id ?? p.palletNo} className="dk-pal-card">
            <div className="dk-pal-h"><b>PALETA P{p.palletNo}</b><span>{nf(p.items.reduce((s, it) => s + it.qty, 0))} szt. · {nf(kgP, 1)} kg</span></div>
            {p.items.map((it, i) => {
              const l = linia(it.orderLineId)
              return (
                <div key={i} className="dk-pal-l">
                  <span><b>{it.qty} ×</b> {l ? `${nf(l.kgPerUnit)} kg ${l.recipeName || l.productTypeName}` : '—'}</span>
                  <span>{nf(it.qty * (l?.kgPerUnit ?? 0), 1)} kg</span>
                </div>
              )
            })}
            {!dlaKlienta && p.notes && <div className="dk-mut" style={{ fontStyle: 'italic' }}>{p.notes}</div>}
          </div>
        )
      })}</div>
    </section>
  )
}

/** Rozpis palet jako osobny dokument (np. dla kierowcy albo magazynu). */
export function KartkaRozpisuPalet({ o, pallets, firma }: { o: ClientOrder; pallets: OrderPallet[]; firma?: string }) {
  const kg = pallets.reduce((s, p) => s + p.items.reduce((a, it) => a + it.qty * (o.lines.find(l => l.id === it.orderLineId)?.kgPerUnit ?? 0), 0), 0)
  const szt = pallets.reduce((s, p) => s + p.items.reduce((a, it) => a + it.qty, 0), 0)
  return (
    <article className="doc-zam doc-komp" aria-label="Rozpis palet — dokument">
      <header className="dz-head">
        <div className="dz-firm"><div><strong>{o.clientName}</strong><span>{firma}</span></div></div>
        <div className="dz-title">
          <span className="dz-kind" style={{ fontSize: '15pt' }}>Rozpis palet</span>
          <span className="dz-no">{o.orderNo}</span>
          <dl><dt>Data zamówienia</dt><dd>{dataPl(o.orderDate)}</dd><dt>Wyjazd</dt><dd>{o.deliveryDate ? dataPl(o.deliveryDate) : '—'}</dd></dl>
        </div>
      </header>
      <RozpisPalet o={o} pallets={pallets} nowaStrona={false} />
      <section className="dz-sum">
        <div className="dz-notes" />
        <dl className="dz-totals"><dt>Palet</dt><dd>{pallets.length}</dd><dt>Sztuk</dt><dd>{nf(szt)}</dd><dt className="big">Masa</dt><dd className="big">{nf(kg, 1)} kg</dd></dl>
      </section>
      <footer className="dz-foot"><p>Rozpis palet · {o.orderNo} · wydruk {new Date().toLocaleString('pl-PL')}</p></footer>
    </article>
  )
}
