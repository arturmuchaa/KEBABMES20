import { WzDoc, WzLine } from '@/lib/api'
import { fmtDatePl } from '@/lib/utils'

/** Dane dokumentu do renderu — pełny WzDoc z API albo szkic z formularza
 *  (przed wystawieniem; wtedy number/seller mogą być puste). */
export type WzDocData = {
  number?: string
  place?: string
  issued_date?: string
  release_date?: string
  seller?: { name?: string; address?: string; nip?: string }
  buyer_name?: string
  buyer_address?: string
  buyer_nip?: string
  valued: boolean
  lines: WzLine[]
  total_value?: number
  currency?: string
  eur_rate?: number | null
}

export function asWzDocData(doc: WzDoc): WzDocData { return doc }

const fmt = (n: number | null | undefined) => (n ?? 0).toFixed(2)
const fmtKg3 = (n: number | null | undefined) => {
  const v = Number(n ?? 0)
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '')
}
const curSymbol = (c?: string) => (c || 'PLN').toUpperCase() === 'EUR' ? '€' : 'zł'

const lineValue = (l: WzLine) => {
  if (l.value != null) return l.value
  const base = (l.total_kg ?? 0) > 0 ? Number(l.total_kg) : l.qty
  return base * (l.price ?? 0)
}

/** Arkusz dokumentu WZ — wspólny dla podglądu (modal), strony wydruku i PDF.
 *  Klasyczny układ dokumentu magazynowego: nagłówek, strony, tabela, podpisy.
 *  Pozycje z wagą (total_kg) mają kolumnę "Waga" i cenę ZA KG. */
export function WzDocumentView({ doc, draft }: { doc: WzDocData; draft?: boolean }) {
  const hasKg = doc.lines.some(l => (l.total_kg ?? 0) > 0)
  // Główna tabela SCALA pozycje o tej samej nazwie/jm/cenie (np. „Kości
  // z kurczaka" z trzech partii = jedna pozycja z sumą kg) — rozbicie na
  // partie daje sekcja HDI pod spodem. Dane dokumentu zostają per partia.
  const mergedLines: WzLine[] = []
  {
    const byKey = new Map<string, WzLine>()
    for (const l of doc.lines) {
      const k = `${l.name}|${l.unit}|${l.price ?? ''}|${l.kg_per_unit ?? ''}`
      const m = byKey.get(k)
      if (m) {
        m.qty = Number(m.qty) + Number(l.qty)
        if ((l.total_kg ?? 0) > 0 || (m.total_kg ?? 0) > 0)
          m.total_kg = Number(m.total_kg ?? 0) + Number(l.total_kg ?? 0)
        if (l.value != null || m.value != null)
          m.value = Number(m.value ?? 0) + Number(l.value ?? 0)
      } else {
        const c = { ...l }
        byKey.set(k, c)
        mergedLines.push(c)
      }
    }
  }
  const sym = curSymbol(doc.currency)
  const isEur = (doc.currency || 'PLN').toUpperCase() === 'EUR'
  const totalKg = doc.lines.reduce((s, l) => s + Number(l.total_kg ?? 0), 0)
  // Bez kolumn "Partia" i "Pojemniki" — te podaje sekcja HDI pod spodem.
  const head = [
    'Lp', 'Nazwa towaru', 'Ilość', 'j.m.',
    ...(hasKg ? ['Waga'] : []),
    ...(doc.valued ? [hasKg ? `Cena/kg [${sym}]` : `Cena jedn. [${sym}]`, `Wartość [${sym}]`] : []),
  ]
  const cols = head.length
  return (
    <div className="wz bg-white text-[#111] mx-auto" style={{ width: 794, padding: 40, fontSize: 13 }}>
      {/* Nagłówek dokumentu */}
      <div className="flex justify-between items-start pb-4 border-b-2 border-[#111]">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Dokument magazynowy</div>
          <h1 className="text-[26px] font-bold leading-tight mt-0.5">WZ — Wydanie zewnętrzne</h1>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Numer</div>
          <div className="font-mono font-bold text-[18px]">
            {doc.number || (draft ? '— / —— / ————' : '')}
          </div>
          <div className="text-[12px] mt-1 text-[#444]">
            {doc.place}{doc.place ? ', ' : ''}{fmtDatePl(doc.issued_date)}
          </div>
        </div>
      </div>

      {/* Strony */}
      <div className="flex gap-5 mt-5">
        {[
          { label: 'Sprzedający / Wystawca', name: doc.seller?.name, address: doc.seller?.address, nip: doc.seller?.nip },
          { label: 'Odbiorca / Nabywca',     name: doc.buyer_name,   address: doc.buyer_address,   nip: doc.buyer_nip },
        ].map(p => (
          <div key={p.label} className="flex-1 border border-[#9a9a9a] p-3">
            <div className="text-[10px] uppercase tracking-[0.15em] text-[#666] mb-1.5">{p.label}</div>
            <div className="font-bold">{p.name || (draft ? '—' : '')}</div>
            <div className="text-[12px] text-[#333] whitespace-pre-line">{p.address}</div>
            {p.nip && <div className="text-[12px] mt-0.5">NIP: <span className="font-mono">{p.nip}</span></div>}
          </div>
        ))}
      </div>

      {/* Pozycje */}
      <table className="w-full mt-5" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {head.map(h => (
              <th key={h} className="border border-[#9a9a9a] bg-[#f0f0f0] px-2 py-1.5 text-[11px] uppercase tracking-wide text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mergedLines.map((l, i) => (
            <tr key={i}>
              <td className="border border-[#9a9a9a] px-2 py-1.5 text-center w-9">{i + 1}</td>
              <td className="border border-[#9a9a9a] px-2 py-1.5 uppercase">{l.name}</td>
              <td className="border border-[#9a9a9a] px-2 py-1.5 text-right font-mono">{l.qty}</td>
              <td className="border border-[#9a9a9a] px-2 py-1.5 w-12">{l.unit}</td>
              {hasKg && (
                <td className="border border-[#9a9a9a] px-2 py-1.5 text-right font-mono">
                  {(l.total_kg ?? 0) > 0 ? `${fmtKg3(l.total_kg)} kg` : '—'}
                </td>
              )}
              {doc.valued && <td className="border border-[#9a9a9a] px-2 py-1.5 text-right font-mono">{fmt(l.price)}</td>}
              {doc.valued && <td className="border border-[#9a9a9a] px-2 py-1.5 text-right font-mono">{fmt(lineValue(l))}</td>}
            </tr>
          ))}
          {!mergedLines.length && (
            <tr><td colSpan={cols} className="border border-[#9a9a9a] px-2 py-4 text-center text-[#888]">Brak pozycji</td></tr>
          )}
        </tbody>
        {doc.lines.length > 0 && (hasKg || doc.valued) && (
          <tfoot>
            <tr>
              <td colSpan={4} className="border border-[#9a9a9a] px-2 py-1.5 text-right font-bold">Razem</td>
              {hasKg && (
                <td className="border border-[#9a9a9a] px-2 py-1.5 text-right font-bold font-mono">{fmtKg3(totalKg)} kg</td>
              )}
              {doc.valued && <td className="border border-[#9a9a9a] px-2 py-1.5" />}
              {doc.valued && (
                <td className="border border-[#9a9a9a] px-2 py-1.5 text-right font-bold font-mono">
                  {fmt(doc.total_value ?? doc.lines.reduce((s, l) => s + lineValue(l), 0))} {sym}
                </td>
              )}
            </tr>
          </tfoot>
        )}
      </table>

      <div className="mt-3 flex justify-between text-[12px]">
        <div>Data wydania: <b>{fmtDatePl(doc.release_date)}</b></div>
        {isEur && doc.eur_rate ? (
          <div className="text-[#444]">Kurs EUR/PLN (NBP, tab. A): <b className="font-mono">{Number(doc.eur_rate).toFixed(4)}</b></div>
        ) : null}
      </div>

      {/* ── Identyfikacja partii surowca (HDI) — tylko pozycje surowcowe;
             sprzedaż wyrobu (kebab) ma osobny, pełny HDI jak dotąd. ── */}
      {(() => {
        const hdiLines = doc.lines.filter(l =>
          (l as any).stock_type && (l as any).stock_type !== 'fg' && l.batch_no)
        if (!hdiLines.length) return null
        const sumKg = hdiLines.reduce((s, l) => s + Number(l.total_kg ?? (l.unit === 'kg' ? l.qty : 0) ?? 0), 0)
        const sumCont = hdiLines.reduce((s, l) => s + Number((l as any).containers ?? 0), 0)
        return (
          // Węższa i lżejsza niż tabela WZ (cieńsze szarości, mniejszy druk),
          // żeby sekcje nie zlewały się na wydruku.
          <div className="mt-7" style={{ width: '86%' }}>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] pb-1 border-b border-[#777] mb-1.5">
              Identyfikacja partii surowca (HDI)
            </div>
            <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  {['Lp', 'Nazwa towaru', 'Partia', 'Data uboju', 'Data ważności', 'Pojemniki*', 'Waga [kg]'].map(h => (
                    <th key={h} className="border border-[#bfbfbf] bg-[#f7f7f7] px-1.5 py-1 text-[10px] uppercase tracking-wide text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hdiLines.map((l, i) => (
                  <tr key={i}>
                    <td className="border border-[#bfbfbf] px-1.5 py-1 text-center w-8">{i + 1}</td>
                    <td className="border border-[#bfbfbf] px-1.5 py-1 uppercase">{l.name}</td>
                    <td className="border border-[#bfbfbf] px-1.5 py-1 font-mono font-bold">{l.batch_no}</td>
                    <td className="border border-[#bfbfbf] px-1.5 py-1">
                      {(l as any).slaughter_date ? fmtDatePl((l as any).slaughter_date) : '—'}
                    </td>
                    <td className="border border-[#bfbfbf] px-1.5 py-1">
                      {(l as any).expiry_date ? fmtDatePl((l as any).expiry_date) : '—'}
                    </td>
                    <td className="border border-[#bfbfbf] px-1.5 py-1 text-right font-mono">
                      {((l as any).containers ?? 0) > 0 ? (l as any).containers : '—'}
                    </td>
                    <td className="border border-[#bfbfbf] px-1.5 py-1 text-right font-mono">
                      {fmtKg3(l.total_kg ?? (l.unit === 'kg' ? l.qty : 0))}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={5} className="border border-[#bfbfbf] px-1.5 py-1 text-right font-bold">Razem</td>
                  <td className="border border-[#bfbfbf] px-1.5 py-1 text-right font-bold font-mono">
                    {sumCont > 0 ? sumCont : '—'}
                  </td>
                  <td className="border border-[#bfbfbf] px-1.5 py-1 text-right font-bold font-mono">{fmtKg3(sumKg)}</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-1 text-[10px] text-[#666] leading-snug">
              * Liczba pojemników orientacyjna — przy załadunku towar bywa przekładany między pojemnikami; wiążąca jest waga [kg]. Prosimy o weryfikację przy odbiorze.
              <br />Zakład pod stałym nadzorem weterynaryjnym, posiada system HACCP. Dokument stanowi handlową identyfikację partii wydanego surowca.
            </div>
          </div>
        )
      })()}

      {/* Podpisy */}
      <div className="flex justify-between mt-16">
        {['Wydał', 'Odebrał'].map(s => (
          <div key={s} className="border-t border-[#111] w-[220px] text-center pt-1 text-[12px] text-[#444]">{s}</div>
        ))}
      </div>
    </div>
  )
}
