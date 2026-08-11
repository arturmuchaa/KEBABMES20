import { useLayoutEffect, useRef } from 'react'
import { WzDoc, WzLine } from '@/lib/api'
import { fmtDatePl } from '@/lib/utils'
import { buildHdiRows } from './hdiRows'

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

// Kwoty po polsku: 2 128,00 (jak na fakturze Subiekt), nie 2128.00.
const fmt = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtKg3 = (n: number | null | undefined) => {
  const v = Number(n ?? 0)
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '')
}
const curSymbol = (c?: string) => (c || 'PLN').toUpperCase() === 'EUR' ? '€' : 'zł'

/** Komórka tabeli HDI — wąska i BEZ zawijania (jedna partia = jedna linia).
 *  Bez klasy wyrównania: „text-left" na nazwie nie wygrałoby z „text-center"
 *  (o zwycięzcy decyduje kolejność w CSS Tailwinda, nie w atrybucie). */
const hdiTd = 'border border-[#bfbfbf] px-1 py-[1px] whitespace-nowrap'

const lineValue = (l: WzLine) => {
  if (l.value != null) return l.value
  const base = (l.total_kg ?? 0) > 0 ? Number(l.total_kg) : l.qty
  return base * (l.price ?? 0)
}

/** Szary pasek sekcji jak na fakturze Subiekt GT (wzorzec 2026-07-17). */
function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-center font-bold" style={{
      background: '#d7d7d7', border: '1px solid #9a9a9a', borderBottom: 'none',
      fontSize: 9.5, padding: '2px 8px', letterSpacing: '.02em',
    }}>{children}</div>
  )
}

// Wysokość arkusza A4 przy marginesie 5 mm (@page niżej) minus pionowe
// wyściółki arkusza — tyle miejsca ma treść na JEDNEJ stronie.
const PAGE_H_PX = 287 /* mm */ / 25.4 * 96 - 32 - 8 /* zapas na zaokrąglenia */
const MIN_SCALE = 0.6   // niżej druk byłby nieczytelny — wtedy wolimy 2 strony

/** „Zmieść na jednej stronie": jeśli treść jest wyższa od A4, skalujemy ją
 *  proporcjonalnie (jak „fit to page" w drukarce). Wysokość zewnętrznego boksu
 *  ustawiamy na PRZESKALOWANĄ — inaczej Chrome dalej łamie stronę po
 *  nieskalowanym layoutcie i wypluwa pustą drugą kartkę. */
function useFitOnePage(deps: unknown) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const o = outer.current, i = inner.current
    if (!o || !i) return
    i.style.transform = 'none'
    o.style.height = ''
    const natural = i.scrollHeight
    if (natural > PAGE_H_PX) {
      const s = Math.max(MIN_SCALE, PAGE_H_PX / natural)
      i.style.transformOrigin = 'top left'
      i.style.transform = `scale(${s})`
      o.style.height = `${Math.ceil(natural * s)}px`
      o.style.overflow = 'hidden'
    }
  }, [deps])
  return { outer, inner }
}

/** Arkusz dokumentu WZ — wspólny dla podglądu (modal), strony wydruku i PDF.
 *  Układ w stylu faktury Subiekt GT (logo + boksy dat po prawej, sekcje
 *  z szarym paskiem, tabela z szarym nagłówkiem, boksy podpisów) — spójny
 *  z HDI/HACCP. Pozycje z wagą (total_kg) mają kolumnę "Waga" i cenę ZA KG. */
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
  const totalValue = doc.total_value ?? doc.lines.reduce((s, l) => s + lineValue(l), 0)
  const fit = useFitOnePage(doc)
  return (
    <div className="wz bg-white text-[#111] mx-auto"
      style={{ width: 756, padding: '16px 20px', fontSize: 10.5, fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 5mm; }
          html, body { margin: 0; background: #fff !important; }
        }
        .wz, .wz * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
      `}</style>
      <div ref={fit.outer}>
      <div ref={fit.inner} style={{ width: 716 }}>

      {/* ── Nagłówek: logo + firma po lewej, boksy dat po prawej (Subiekt) ── */}
      <div className="flex justify-between items-start">
        <div>
          <img src="/logo-ksiezyc.png" alt="Księżyc" style={{ height: 72, width: 'auto' }} />
          <div className="mt-2 leading-snug">
            <div className="font-bold text-[11.5px]">{doc.seller?.name || (draft ? '—' : '')}</div>
            <div className="text-[10px] text-[#222] whitespace-pre-line">{doc.seller?.address}</div>
            {doc.seller?.nip && <div className="text-[10px]">NIP: {doc.seller.nip}</div>}
          </div>
        </div>
        <div style={{ width: 210 }}>
          {[
            ['Miejsce wystawienia:', doc.place || (draft ? '—' : '')],
            ['Data wystawienia:', fmtDatePl(doc.issued_date)],
            ['Data wydania:', fmtDatePl(doc.release_date)],
          ].map(([label, val]) => (
            <div key={label} className="mb-1.5">
              <Bar>{label}</Bar>
              <div className="text-center text-[10px] py-0.5" style={{ border: '1px solid #9a9a9a', borderTop: 'none' }}>
                {val || ' '}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Sprzedawca / Nabywca ── */}
      <div className="flex gap-6 mt-3">
        {[
          { label: 'Sprzedawca:', name: doc.seller?.name, address: doc.seller?.address, nip: doc.seller?.nip },
          { label: 'Nabywca:',    name: doc.buyer_name,   address: doc.buyer_address,   nip: doc.buyer_nip },
        ].map(p => (
          <div key={p.label} className="flex-1">
            <Bar>{p.label}</Bar>
            <div className="px-2.5 py-1.5 leading-snug" style={{ border: '1px solid #9a9a9a', borderTop: 'none', minHeight: 62 }}>
              <div className="font-bold uppercase">{p.name || (draft ? '—' : '')}</div>
              <div className="text-[10px] text-[#222] whitespace-pre-line uppercase">{p.address}</div>
              {p.nip && <div className="text-[10px] mt-0.5">NIP: {p.nip}</div>}
            </div>
          </div>
        ))}
      </div>

      {/* ── Tytuł dokumentu (jak „Faktura VAT 47/07/2026") ── */}
      <div className="text-center mt-4 mb-2">
        <span className="font-bold" style={{ fontSize: 13.5 }}>
          WZ — Wydanie zewnętrzne&nbsp;&nbsp;{doc.number || (draft ? '— / —— / ——' : '')}
        </span>
      </div>

      {/* ── Pozycje ── */}
      <table className="w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {head.map((h, hi) => (
              <th key={h} className={`px-1.5 py-0.5 text-[8px] uppercase ${hi === 1 ? 'text-left' : 'text-center'}`}
                style={{ border: '1px solid #9a9a9a', background: '#d7d7d7' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mergedLines.map((l, i) => (
            <tr key={i}>
              <td className="px-1.5 py-0.5 text-center w-8 text-[9.5px]" style={{ border: '1px solid #9a9a9a' }}>{i + 1}</td>
              <td className="px-1.5 py-0.5 uppercase font-semibold text-[9.5px]" style={{ border: '1px solid #9a9a9a' }}>{l.name}</td>
              <td className="px-1.5 py-0.5 text-right text-[9.5px]" style={{ border: '1px solid #9a9a9a' }}>{l.qty}</td>
              <td className="px-1.5 py-0.5 w-12 text-center text-[9.5px]" style={{ border: '1px solid #9a9a9a' }}>{l.unit}</td>
              {hasKg && (
                <td className="px-1.5 py-0.5 text-right text-[9.5px]" style={{ border: '1px solid #9a9a9a' }}>
                  {(l.total_kg ?? 0) > 0 ? `${fmtKg3(l.total_kg)} kg` : '—'}
                </td>
              )}
              {doc.valued && <td className="px-1.5 py-0.5 text-right text-[9.5px]" style={{ border: '1px solid #9a9a9a' }}>{fmt(l.price)}</td>}
              {doc.valued && <td className="px-1.5 py-0.5 text-right text-[9.5px]" style={{ border: '1px solid #9a9a9a' }}>{fmt(lineValue(l))}</td>}
            </tr>
          ))}
          {!mergedLines.length && (
            <tr><td colSpan={cols} className="px-1.5 py-3 text-center text-[#888] text-[9.5px]" style={{ border: '1px solid #9a9a9a' }}>Brak pozycji</td></tr>
          )}
        </tbody>
        {doc.lines.length > 0 && (hasKg || doc.valued) && (
          <tfoot>
            <tr>
              <td colSpan={4} className="px-1.5 py-0.5 text-right font-bold text-[9.5px]" style={{ border: '1px solid #9a9a9a', background: '#efefef' }}>Razem</td>
              {hasKg && (
                <td className="px-1.5 py-0.5 text-right font-bold text-[9.5px]" style={{ border: '1px solid #9a9a9a', background: '#efefef' }}>{fmtKg3(totalKg)} kg</td>
              )}
              {doc.valued && <td style={{ border: '1px solid #9a9a9a', background: '#efefef' }} />}
              {doc.valued && (
                <td className="px-1.5 py-0.5 text-right font-bold text-[9.5px]" style={{ border: '1px solid #9a9a9a', background: '#efefef' }}>
                  {fmt(totalValue)}
                </td>
              )}
            </tr>
          </tfoot>
        )}
      </table>

      {/* ── Podsumowanie po prawej (Subiekt: „Razem do zapłaty") ── */}
      {doc.valued && (
        <div className="flex justify-end mt-2.5">
          <div style={{ width: 280 }}>
            <div className="flex items-center justify-between font-bold px-2.5 py-1"
              style={{ background: '#d7d7d7', border: '1px solid #9a9a9a', fontSize: 11 }}>
              <span>Razem do zapłaty:</span>
              <span>{fmt(totalValue)} {sym}</span>
            </div>
            {isEur && doc.eur_rate ? (
              <div className="text-right text-[10.5px] mt-0.5 text-[#333]">
                Dokument wystawiony w walucie EUR — kurs NBP (tab. A):{' '}
                <b style={{ whiteSpace: 'nowrap' }}>{Number(doc.eur_rate).toFixed(4)} PLN</b>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Identyfikacja partii surowca (HDI) — tylko pozycje surowcowe;
             sprzedaż wyrobu (kebab) ma osobny, pełny HDI jak dotąd. ── */}
      {(() => {
        // Grupami towaru, w grupie partie od najstarszej, jedna partia = jedna
        // linia (reguły i testy: hdiRows.ts).
        const hdiLines = buildHdiRows(doc.lines)
        if (!hdiLines.length) return null
        const sumKg = hdiLines.reduce((s, l) => s + Number(l.total_kg ?? 0), 0)
        const sumCont = hdiLines.reduce((s, l) => s + Number((l as any).containers ?? 0), 0)
        return (
          // Pełna szerokość jak tabela WZ, ale drobniejszy druk i cieńsze
          // szarości — sekcja identyfikacji nie zlewa się z dokumentem.
          <div className="mt-4">
            <Bar>Identyfikacja partii surowca (HDI)</Bar>
            <div style={{ borderBottom: '1px solid #9a9a9a', marginBottom: 6 }} />
            {/* Wiersze JEDNOLINIOWE (nowrap) i wąskie — długi WZ na 1 stronie. */}
            <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 9, lineHeight: 1.35 }}>
              <thead>
                <tr>
                  {['Lp', 'Nazwa towaru', 'Partia', 'Masa netto [kg]', 'Data uboju', 'Data produkcji', 'Data ważności', 'Temp. przech.', 'Pojemniki*'].map((h, hi) => (
                    <th key={h} className={`border border-[#bfbfbf] bg-[#f7f7f7] px-1 text-[8px] uppercase tracking-wide whitespace-nowrap ${hi === 1 ? 'text-left' : 'text-center'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hdiLines.map((l, i) => (
                  <tr key={i}>
                    <td className={`${hdiTd} text-center w-6`}>{i + 1}</td>
                    <td className={`${hdiTd} uppercase`}>{l.name}</td>
                    <td className={`${hdiTd} text-center font-mono font-bold`}>{l.batch_no}</td>
                    <td className={`${hdiTd} text-center font-mono`}>{fmtKg3(l.total_kg)}</td>
                    <td className={`${hdiTd} text-center`}>
                      {(l as any).slaughter_date ? fmtDatePl((l as any).slaughter_date) : '—'}
                    </td>
                    <td className={`${hdiTd} text-center`}>
                      {(l as any).production_date ? fmtDatePl((l as any).production_date) : '—'}
                    </td>
                    <td className={`${hdiTd} text-center`}>
                      {(l as any).expiry_date ? fmtDatePl((l as any).expiry_date) : '—'}
                    </td>
                    <td className={`${hdiTd} text-center`}>0–4°C</td>
                    <td className={`${hdiTd} text-center font-mono`}>
                      {((l as any).containers ?? 0) > 0 ? (l as any).containers : '—'}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} className={`${hdiTd} text-right font-bold`}>Razem</td>
                  <td className={`${hdiTd} text-center font-bold font-mono`}>{fmtKg3(sumKg)}</td>
                  <td colSpan={4} className="border border-[#bfbfbf]" />
                  <td className={`${hdiTd} text-center font-bold font-mono`}>{sumCont > 0 ? sumCont : '—'}</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-1 text-[10px] text-[#666] leading-snug">
              * Liczba pojemników orientacyjna — prosimy o weryfikację podczas załadunku. Wiążąca jest masa netto [kg].
              <br />Zakład pod stałym nadzorem weterynaryjnym, posiada system HACCP. Dokument stanowi handlową identyfikację partii wydanego surowca.
            </div>
          </div>
        )
      })()}

      {/* ── Boksy podpisów (Subiekt: Wystawił(a) / Odebrał(a)) ── */}
      <div className="flex justify-between gap-8 mt-6">
        {[
          { label: 'Wystawił(a):', caption: 'Podpis osoby upoważnionej do wystawienia dokumentu WZ' },
          { label: 'Odebrał(a):',  caption: 'Podpis osoby upoważnionej do odbioru towaru' },
        ].map(s => (
          <div key={s.label} className="flex-1" style={{ maxWidth: 330 }}>
            <Bar>{s.label}</Bar>
            <div style={{ border: '1px solid #9a9a9a', borderTop: 'none', height: 52 }} />
            <div className="text-center text-[8.5px] text-[#555] mt-0.5">{s.caption}</div>
          </div>
        ))}
      </div>
      </div>
      </div>
    </div>
  )
}
