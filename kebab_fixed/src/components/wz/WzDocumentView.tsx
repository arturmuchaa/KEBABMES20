import { useLayoutEffect, useRef } from 'react'
import { BlokSaldaWz } from '@/features/rozliczenia/BlokSaldaWz'
import { LogoZakladu } from '@/components/print/LogoZakladu'
import { WzDoc, WzLine } from '@/lib/api'
import { fmtDatePl } from '@/lib/utils'
import { buildHdiRows } from './hdiRows'
import { scalPozycjeWz } from '@/features/wz/wzLineMerge'
import { bezPowtorzonychSlow } from '@/features/wz/nazwaWyrobu'
import { maVat, podsumowanieVat } from '@/features/wz/wzVat'

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
  /** 'WM' = wewnętrzny WZ podziału wysyłki (Task 3) — niesie CAŁĄ przesyłkę,
   *  także część spoza faktury. */
  doc_series?: string
  /** Czy ten WM naprawdę ukrywa część spoza faktury (wysyłka Z PODZIAŁEM).
   *  Liczy backend po istnieniu WZ dla klienta. Tylko wtedy wydruk niesie
   *  pasek ostrzegawczy — przy całości na fakturę WM nie ukrywa niczego
   *  i wolno go dać klientowi (właściciel, 22.09.2026). */
  ukrywa_czesc_poza_faktura?: boolean
  /** Identyfikator dokumentu — po nim blok rozrachunków pyta backend
   *  o zaległości kontrahenta. Nieobecny na szkicu (dokument jeszcze
   *  nie istnieje), więc blok się wtedy nie rysuje. */
  id?: string
}

export function asWzDocData(doc: WzDoc): WzDocData { return doc }

// Kwoty po polsku: 2 128,00 (jak na fakturze Subiekt), nie 2128.00.
// Spacja tysięcy także w liczbach 4-cyfrowych (pl-PL jej tam nie stawia): „8 520,00”, nie „8520,00”.
const fmt = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/^(-?\d)(\d{3})(?=,)/, '$1\u00a0$2')
const fmtKg3 = (n: number | null | undefined) => {
  const v = Number(n ?? 0)
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '')
}
const curSymbol = (c?: string) => (c || 'PLN').toUpperCase() === 'EUR' ? '€' : 'zł'

/** Komórka tabeli HDI — wąska i BEZ zawijania (jedna partia = jedna linia).
 *  Bez klasy wyrównania: „text-left" na nazwie nie wygrałoby z „text-center"
 *  (o zwycięzcy decyduje kolejność w CSS Tailwinda, nie w atrybucie). */

const lineValue = (l: WzLine) => {
  if (l.value != null) return l.value
  const base = (l.total_kg ?? 0) > 0 ? Number(l.total_kg) : l.qty
  return base * (l.price ?? 0)
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
  const mergedLines: WzLine[] = scalPozycjeWz(doc.lines)

  const pokazVat = maVat(doc.lines)
  const vat = podsumowanieVat(mergedLines)
  const sym = curSymbol(doc.currency)
  const isEur = (doc.currency || 'PLN').toUpperCase() === 'EUR'
  const totalKg = doc.lines.reduce((s, l) => s + Number(l.total_kg ?? 0), 0)
  // Bez kolumn "Partia" i "Pojemniki" — te podaje sekcja HDI pod spodem.
  const head = [
    'Lp', 'Nazwa towaru', 'Ilość', 'j.m.',
    ...(hasKg ? ['Waga'] : []),
    ...(doc.valued ? [hasKg ? `Cena/kg [${sym}]` : `Cena jedn. [${sym}]`] : []),
    ...(doc.valued && pokazVat ? ['VAT'] : []),
    ...(doc.valued ? [`Wartość [${sym}]`] : []),
  ]
  const cols = head.length
  const totalValue = doc.total_value ?? doc.lines.reduce((s, l) => s + lineValue(l), 0)
  const fit = useFitOnePage(doc)
  // ── Wariant A (właściciel 14.11.2026): klasyczny układ bez szarych pasów — cienkie
  // linie, wyraźne sumy, duże pola na pieczątkę i podpis. Druk bywa czarno-biały:
  // nic nie opiera się wyłącznie na kolorze.
  const L = { mocna: '1.4px solid #111', cienka: '0.6px solid #c9c9c9', srednia: '0.9px solid #111' }
  const etykieta: React.CSSProperties = { fontSize: 8, textTransform: 'uppercase', letterSpacing: '.08em', color: '#555', fontWeight: 600, marginBottom: 3 }
  const th: React.CSSProperties = { fontSize: 8, textTransform: 'uppercase', letterSpacing: '.04em', color: '#444', fontWeight: 600, padding: '5px 6px', borderTop: L.mocna, borderBottom: L.srednia, textAlign: 'center', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '5px 6px', borderBottom: L.cienka, fontVariantNumeric: 'tabular-nums' }
  const prawa: React.CSSProperties = { ...td, textAlign: 'right' }
  const srodek: React.CSSProperties = { ...td, textAlign: 'center' }
  const metaWiersz = (label: string, val: string) => (
    <tr key={label}><th style={{ textAlign: 'left', fontWeight: 400, color: '#555', padding: '3px 14px 3px 0', fontSize: 9.5 }}>{label}</th>
      <td style={{ borderBottom: '0.8px solid #aaa', padding: '3px 0', minWidth: 112, textAlign: 'right', fontWeight: 600 }}>{val || ' '}</td></tr>
  )
  return (
    <div className="wz mx-auto"
      style={{ width: 756, padding: '16px 20px', fontSize: 10.5, lineHeight: 1.4, fontFamily: '"Fira Sans", Arial, Helvetica, sans-serif', background: '#fff', color: '#111' }}>
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

      {/* ── Nagłówek: logo i dane wystawcy, po prawej miejsce i daty ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <LogoZakladu wysokosc={84} />
          <div style={{ marginTop: 6, fontSize: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 11 }}>{doc.seller?.name || (draft ? '—' : '')}</div>
            <div style={{ whiteSpace: 'pre-line', color: '#222' }}>{doc.seller?.address}</div>
            {doc.seller?.nip && <div>NIP: {doc.seller.nip}</div>}
          </div>
        </div>
        <table style={{ borderCollapse: 'collapse' }}><tbody>
          {metaWiersz('Miejsce wystawienia', doc.place || (draft ? '—' : ''))}
          {metaWiersz('Data wystawienia', fmtDatePl(doc.issued_date))}
          {metaWiersz('Data wydania', fmtDatePl(doc.release_date))}
        </tbody></table>
      </div>

      {/* ── Sprzedawca / Nabywca ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 18 }}>
        {[
          { label: 'Sprzedawca', name: doc.seller?.name, address: doc.seller?.address, nip: doc.seller?.nip },
          { label: 'Nabywca', name: doc.buyer_name, address: doc.buyer_address, nip: doc.buyer_nip },
        ].map(p => (
          <div key={p.label} style={{ borderTop: L.mocna, paddingTop: 6, minHeight: 58 }}>
            <div style={etykieta}>{p.label}</div>
            <div style={{ fontWeight: 700, textTransform: 'uppercase' }}>{p.name || (draft ? '—' : '')}</div>
            <div style={{ fontSize: 10, color: '#222', whiteSpace: 'pre-line', textTransform: 'uppercase' }}>{p.address}</div>
            {p.nip && <div style={{ fontSize: 10, marginTop: 1 }}>NIP: {p.nip}</div>}
          </div>
        ))}
      </div>

      {/* ── Tytuł ── */}
      <div style={{ textAlign: 'center', margin: '20px 0 10px' }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Wydanie zewnętrzne&nbsp;&nbsp;
          <span style={{ fontFamily: 'Consolas, "Fira Mono", monospace', fontWeight: 600 }}>{doc.number || (draft ? '— / —— / ——' : '')}</span></span>
      </div>

      {/* WM drukuje się jak każde wydanie zewnętrzne — bez czerwonego paska
             „nie wydawać klientowi” (właściciel 14.11.2026: „WM zawiera wszystko,
             co wyszło z magazynu, WZ to dokument dla klienta do zapłaty”). */}

      {/* ── Pozycje ── */}
      <table className="w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>{head.map((h, hi) => <th key={h} style={{ ...th, textAlign: hi === 1 ? 'left' : 'center' }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {mergedLines.map((l, i) => (
            <tr key={i}>
              <td style={{ ...srodek, width: 26 }}>{i + 1}</td>
              {/* Nazwa bez powtórzonego słowa — dokumenty sprzed poprawki mają
                  „KEBAB YAPRAK YAPRAK" zapisane w bazie i wydruk ma je zwinąć. */}
              <td style={{ ...td, textTransform: 'uppercase', fontWeight: 600 }}>{bezPowtorzonychSlow(l.name)}</td>
              <td style={prawa}>{l.qty}</td>
              <td style={{ ...srodek, width: 40 }}>{l.unit}</td>
              {hasKg && <td style={prawa}>{(l.total_kg ?? 0) > 0 ? `${fmtKg3(l.total_kg)} kg` : '—'}</td>}
              {doc.valued && <td style={prawa}>{fmt(l.price)}</td>}
              {doc.valued && pokazVat && <td style={{ ...srodek, width: 38 }}>{Number(l.vat_rate ?? 0)}%</td>}
              {doc.valued && <td style={prawa}>{fmt(lineValue(l))}</td>}
            </tr>
          ))}
          {!mergedLines.length && (
            <tr><td colSpan={cols} style={{ ...srodek, color: '#888', padding: 12 }}>Brak pozycji</td></tr>
          )}
        </tbody>
        {doc.lines.length > 0 && (hasKg || doc.valued) && (
          <tfoot>
            <tr>
              <td colSpan={4} style={{ ...prawa, borderTop: L.mocna, borderBottom: 0, fontWeight: 700 }}>Razem</td>
              {hasKg && <td style={{ ...prawa, borderTop: L.mocna, borderBottom: 0, fontWeight: 700 }}>{fmtKg3(totalKg)} kg</td>}
              {doc.valued && <td style={{ borderTop: L.mocna }} />}
              {doc.valued && pokazVat && <td style={{ borderTop: L.mocna }} />}
              {doc.valued && <td style={{ ...prawa, borderTop: L.mocna, borderBottom: 0, fontWeight: 700 }}>{fmt(totalValue)}</td>}
            </tr>
          </tfoot>
        )}
      </table>

      {/* ── Podsumowanie po prawej ── */}
      {doc.valued && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <table style={{ borderCollapse: 'collapse', minWidth: 300, fontVariantNumeric: 'tabular-nums' }}><tbody>
            {pokazVat && vat.wiersze.map(w => (
              <tr key={w.stawka}><td style={{ padding: '3px 6px', borderBottom: L.cienka }}>Netto {w.stawka}% / VAT</td>
                <td style={{ padding: '3px 6px', borderBottom: L.cienka, textAlign: 'right' }}>{fmt(w.netto)} / {fmt(w.vat)} {sym}</td></tr>
            ))}
            {pokazVat && <tr><td style={{ padding: '3px 6px', borderBottom: L.cienka }}>Razem netto</td><td style={{ padding: '3px 6px', borderBottom: L.cienka, textAlign: 'right' }}>{fmt(vat.netto)} {sym}</td></tr>}
            <tr><td style={{ padding: '5px 6px', fontWeight: 700, fontSize: 13, borderBottom: '2px solid #111' }}>{pokazVat ? 'Razem brutto' : 'Razem do zapłaty'}</td>
              <td style={{ padding: '5px 6px', fontWeight: 700, fontSize: 13, borderBottom: '2px solid #111', textAlign: 'right' }}>{fmt(pokazVat ? vat.brutto : totalValue)} {sym}</td></tr>
            {isEur && doc.eur_rate ? <tr><td colSpan={2} style={{ padding: '4px 6px', fontSize: 9.5, color: '#444', textAlign: 'right' }}>
              Dokument wystawiony w walucie EUR — kurs NBP (tab. A): <b style={{ whiteSpace: 'nowrap' }}>{Number(doc.eur_rate).toFixed(4)} PLN</b></td></tr> : null}
          </tbody></table>
        </div>
      )}

      {/* Stan rozliczeń klienta na tym samym papierze co wydanie (spec 10.1).
          Właściciel 24.09.2026: „będę podpinał klientowi do dokumentów".
          Blok MILCZY, gdy backend nie ma zestawienia — jest dodatkiem do
          dokumentu, nie warunkiem jego powstania. Nie pokazujemy go na
          szkicu (nie jedzie do klienta) ani na WM (wewnętrzny dokument
          podziału wysyłki). */}
      {!draft && doc.id && doc.doc_series !== 'WM'
        ? <div style={{ marginTop: 14 }}><BlokSaldaWz wzId={String(doc.id)} /></div> : null}

      {/* ── Identyfikacja partii surowca (HDI) — tylko pozycje surowcowe;
             sprzedaż wyrobu (kebab) ma osobny, pełny HDI jak dotąd. ── */}
      {(() => {
        // Grupami towaru, w grupie partie od najstarszej, jedna partia = jedna
        // linia (reguły i testy: hdiRows.ts).
        const hdiLines = buildHdiRows(doc.lines)
        if (!hdiLines.length) return null
        const sumKg = hdiLines.reduce((s, l) => s + Number(l.total_kg ?? 0), 0)
        const sumCont = hdiLines.reduce((s, l) => s + Number((l as any).containers ?? 0), 0)
        const hth: React.CSSProperties = { ...th, fontSize: 7.5, padding: '3px 4px', borderTop: L.srednia }
        const htd: React.CSSProperties = { padding: '2px 4px', borderBottom: L.cienka, whiteSpace: 'nowrap', textAlign: 'center' }
        return (
          <div style={{ marginTop: 16 }}>
            <div style={etykieta}>Identyfikacja partii surowca (HDI)</div>
            {/* Wiersze JEDNOLINIOWE (nowrap) i wąskie — długi WZ na 1 stronie. */}
            <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 9, lineHeight: 1.35 }}>
              <thead>
                <tr>
                  {['Lp', 'Nazwa towaru', 'Partia', 'Masa netto [kg]', 'Data uboju', 'Data produkcji', 'Data ważności', 'Temp. przech.', 'Pojemniki*'].map((h, hi) => (
                    <th key={h} style={{ ...hth, textAlign: hi === 1 ? 'left' : 'center' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hdiLines.map((l, i) => (
                  <tr key={i}>
                    <td style={{ ...htd, width: 22 }}>{i + 1}</td>
                    <td style={{ ...htd, textAlign: 'left', textTransform: 'uppercase' }}>{l.name}</td>
                    <td style={{ ...htd, fontWeight: 700, fontFamily: 'Consolas, monospace' }}>{l.batch_no}</td>
                    <td style={{ ...htd, fontFamily: 'Consolas, monospace' }}>{fmtKg3(l.total_kg)}</td>
                    <td style={htd}>{(l as any).slaughter_date ? fmtDatePl((l as any).slaughter_date) : '—'}</td>
                    <td style={htd}>{(l as any).production_date ? fmtDatePl((l as any).production_date) : '—'}</td>
                    <td style={htd}>{(l as any).expiry_date ? fmtDatePl((l as any).expiry_date) : '—'}</td>
                    <td style={htd}>0–4°C</td>
                    <td style={{ ...htd, fontFamily: 'Consolas, monospace' }}>{((l as any).containers ?? 0) > 0 ? (l as any).containers : '—'}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} style={{ ...htd, textAlign: 'right', fontWeight: 700, borderBottom: 0 }}>Razem</td>
                  <td style={{ ...htd, fontWeight: 700, fontFamily: 'Consolas, monospace', borderBottom: 0 }}>{fmtKg3(sumKg)}</td>
                  <td colSpan={4} style={{ borderBottom: 0 }} />
                  <td style={{ ...htd, fontWeight: 700, fontFamily: 'Consolas, monospace', borderBottom: 0 }}>{sumCont > 0 ? sumCont : '—'}</td>
                </tr>
              </tbody>
            </table>
            <div style={{ marginTop: 3, fontSize: 9, color: '#555', lineHeight: 1.35 }}>
              * Liczba pojemników orientacyjna — prosimy o weryfikację podczas załadunku. Wiążąca jest masa netto [kg].
              <br />Zakład pod stałym nadzorem weterynaryjnym, posiada system HACCP. Dokument stanowi handlową identyfikację partii wydanego surowca.
            </div>
          </div>
        )
      })()}

      {/* ── Pola na pieczątkę i podpis (właściciel 14.11.2026: więcej miejsca) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 34, marginTop: 24, breakInside: 'avoid' }}>
        {[
          { id: 'wystawiajacy', caption: 'Pieczątka i podpis wystawiającego' },
          { id: 'odbiorca', caption: 'Data, pieczątka i podpis odbiorcy' },
        ].map(s => (
          <div key={s.id}>
            <div data-testid={`pole-podpisu-${s.id}`} style={{ height: 96, border: '1px solid #9a9a9a', borderRadius: 3 }} />
            <div style={{ textAlign: 'center', fontSize: 8.5, color: '#555', marginTop: 4 }}>{s.caption}</div>
          </div>
        ))}
      </div>
      </div>
      </div>
    </div>
  )
}
