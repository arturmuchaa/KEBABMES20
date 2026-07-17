import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Printer, Download } from 'lucide-react'
import { cmrApi, downloadDocPdf } from '@/lib/api'
import { mergeCmrPositions, CMR_LINE_GAP, getGoodsRowH, fontCss, customFieldKeys,
         type CmrPositions, type FieldPos } from '@/lib/cmrLayout'

// Cztery kopie = cztery strony oficjalnego druku (tło 1:1), różnią się kolorem.
const COPY_BG = ['/cmr/cmr-1.png', '/cmr/cmr-2.png', '/cmr/cmr-3.png', '/cmr/cmr-4.png']

function fmt(date?: string) {
  if (!date) return ''
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : date
}

// Pole nakładane na druk: pozycja w % strony A4 (left/top), szerokość, rozmiar.
// Czcionka danych jak na oryginalnym druku CMR: Roboto Condensed.
function F({ l, t, w, s = 10.5, bold, italic, font, hidden, raw, center, right, children }: {
  l: number; t: number; w?: number; s?: number
  bold?: boolean; italic?: boolean; font?: string; hidden?: boolean; raw?: boolean
  center?: boolean; right?: boolean; children?: React.ReactNode
}) {
  if (hidden) return null
  return (
    <div style={{
      position: 'absolute', left: `${l}%`, top: `${t}%`,
      width: w ? `${w}%` : undefined,
      fontSize: `${s}px`, fontWeight: bold ? 700 : 400,
      fontStyle: italic ? 'italic' : 'normal', lineHeight: 1.1,
      textAlign: center ? 'center' : right ? 'right' : 'left',
      color: '#000', fontFamily: fontCss(font),
      textTransform: raw ? 'none' : 'uppercase',
    }}>{children}</div>
  )
}

// Blok adresowy: 3 linie (nazwa / ulica / „kod, miasto, kraj") wg pozycji z konfiguracji.
function AddrBlock({ d, p, gap }: { d: any; p: FieldPos; gap: number }) {
  if (!d || p.hidden) return null
  const cityLine = [d.postal_code, d.city, d.country].filter(Boolean).join(', ')
  const lines = [d.name, d.address, cityLine].filter(Boolean)
  return <>{lines.map((ln, i) => (
    <F key={i} l={p.x} t={p.y + i * gap} w={26} s={p.size}
       font={p.font} bold={p.bold} italic={p.italic}>{ln}</F>
  ))}</>
}

function CmrSheet({ doc, bg, pos, rowH }: { doc: any; bg: string; pos: CmrPositions; rowH: number }) {
  const p = doc.payload || {}
  const att = p.attachments || {}
  const goods: any[] = p.goods || []
  const c = p.carrier || {}
  const P = (k: string): FieldPos => pos[k] || { x: 0, y: 0, size: 11 }
  // Czcionka/pogrubienie/kursywa/ukrycie pola wg konfiguratora (do rozłożenia w <F>).
  const ff = (k: string) => {
    const q = P(k)
    return { font: q.font, bold: q.bold, italic: q.italic, hidden: q.hidden }
  }
  const gN = P('goodsNum'), gQ = P('goodsQty'), gNa = P('goodsName'), gK = P('goodsKg')

  return (
    <div className="cmr-page">
      <img className="cmr-bg" src={bg} alt="" />

      <F l={P('cmrNo').x} t={P('cmrNo').y} s={P('cmrNo').size} {...ff('cmrNo')} bold={P('cmrNo').bold ?? true}>{doc.number}</F>

      <AddrBlock d={p.sender} p={P('sender')} gap={CMR_LINE_GAP} />
      <F l={P('senderNip').x} t={P('senderNip').y} w={16} s={P('senderNip').size} {...ff('senderNip')}>{p.sender?.nip}</F>

      <AddrBlock d={p.consignee} p={P('consignee')} gap={CMR_LINE_GAP} />
      <F l={P('consigneeNip').x} t={P('consigneeNip').y} w={15} s={P('consigneeNip').size} {...ff('consigneeNip')}>{p.consignee?.nip}</F>

      {/* Pole 3: MIEJSCE PRZEZNACZENIA z dokumentu (kartoteka klienta:
          nazwa/adres/miasto docelowe) — render consignee ukrywał poprawki
          adresu przeznaczenia (prod 2026-07-17, ISSA→FARMEX). Stare dokumenty
          bez delivery_place: jak dotąd adres odbiorcy. */}
      {p.delivery_place
        ? <F l={P('delivery').x} t={P('delivery').y} w={26} s={P('delivery').size} {...ff('delivery')}>{p.delivery_place}</F>
        : <AddrBlock d={p.consignee} p={P('delivery')} gap={CMR_LINE_GAP} />}

      <F l={P('loadPlace').x} t={P('loadPlace').y} w={26} s={P('loadPlace').size} {...ff('loadPlace')}>{p.load_place}</F>
      <F l={P('loadDate').x} t={P('loadDate').y} w={14} s={P('loadDate').size} {...ff('loadDate')}>{fmt(p.load_date)}</F>

      {att.hdi_number && <F l={P('attHdi').x} t={P('attHdi').y} w={42} s={P('attHdi').size} {...ff('attHdi')}>HDI {att.hdi_number}</F>}
      {att.invoice_no && <F l={P('attInvoice').x} t={P('attInvoice').y} w={42} s={P('attInvoice').size} {...ff('attInvoice')}>{att.invoice_no}</F>}

      {goods.map((g, i) => (
        <div key={i}>
          <F l={gN.x} t={gN.y + i * rowH} w={4} s={gN.size} {...ff('goodsNum')}>{i + 1}.</F>
          <F l={gQ.x} t={gQ.y + i * rowH} w={9} s={gQ.size} {...ff('goodsQty')}>{g.qty || ''}</F>
          <F l={gNa.x} t={gNa.y + i * rowH} w={18} s={gNa.size} {...ff('goodsName')}>{g.name}</F>
          <F l={gK.x} t={gK.y + i * rowH} w={9} s={gK.size} {...ff('goodsKg')}>{g.kg ? `${g.kg}` : ''}</F>
        </div>
      ))}
      {goods.length > 1 && (
        <F l={P('goodsGross').x} t={P('goodsGross').y} w={9} s={P('goodsGross').size} {...ff('goodsGross')} bold={P('goodsGross').bold ?? true}>{p.gross_kg ? `${p.gross_kg}` : ''}</F>
      )}

      <F l={P('instructions').x} t={P('instructions').y} w={42} s={P('instructions').size} {...ff('instructions')}>{p.instructions}</F>

      <AddrBlock d={c} p={P('carrier')} gap={CMR_LINE_GAP} />
      <F l={P('carrierNip').x} t={P('carrierNip').y} w={13} s={P('carrierNip').size} {...ff('carrierNip')}>{c.nip}</F>
      <F l={P('carrierVat').x} t={P('carrierVat').y} w={13} s={P('carrierVat').size} {...ff('carrierVat')}>{c.vat_eu}</F>
      <F l={P('carrierPlate').x} t={P('carrierPlate').y} w={22} s={P('carrierPlate').size} {...ff('carrierPlate')}>{c.plate || ''}</F>

      <F l={P('establishedPlace').x} t={P('establishedPlace').y} w={14} s={P('establishedPlace').size} {...ff('establishedPlace')}>{p.established_place}</F>
      <F l={P('establishedDate').x} t={P('establishedDate').y} w={14} s={P('establishedDate').size} {...ff('establishedDate')}>{fmt(p.established_date)}</F>

      {/* Pola własne dodane w konfiguratorze (dowolny tekst nakładany na druk) */}
      {customFieldKeys(pos).map(k => {
        const q = pos[k]
        return (
          <F key={k} l={q.x} t={q.y} s={q.size}
             font={q.font} bold={q.bold} italic={q.italic} hidden={q.hidden} raw>
            {q.text || ''}
          </F>
        )
      })}
    </div>
  )
}

export function CmrPrintPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [doc, setDoc] = useState<any>(null)
  const [pos, setPos] = useState<CmrPositions | null>(null)
  const [err, setErr] = useState('')
  const isPdf = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('pdf')

  useEffect(() => {
    cmrApi.get(id).then(setDoc).catch(e => setErr(e instanceof Error ? e.message : 'Błąd'))
    cmrApi.getLayout().then(l => setPos(mergeCmrPositions(l))).catch(() => setPos(mergeCmrPositions(null)))
  }, [id])

  useEffect(() => {
    // Drukuj dopiero, gdy mamy dokument i ustawienia układu.
    if (doc && pos && !isPdf) {
      const t = setTimeout(() => window.print(), 700)
      return () => clearTimeout(t)
    }
  }, [doc, pos, isPdf])

  if (err) return <div className="p-8 text-red-700">{err}</div>
  if (!doc || !pos) return <div className="p-8 text-slate-500">Ładowanie CMR…</div>

  return (
    <div style={{ background: '#fff', color: '#000' }}>
      <style>{`
        @font-face { font-family: 'Roboto Condensed'; font-style: normal; font-weight: 400;
          src: url('/fonts/robotocondensed-400-latin-ext.woff2') format('woff2');
          unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
        @font-face { font-family: 'Roboto Condensed'; font-style: normal; font-weight: 400;
          src: url('/fonts/robotocondensed-400-latin.woff2') format('woff2');
          unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
        @font-face { font-family: 'Roboto Condensed'; font-style: normal; font-weight: 700;
          src: url('/fonts/robotocondensed-700-latin-ext.woff2') format('woff2');
          unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
        @font-face { font-family: 'Roboto Condensed'; font-style: normal; font-weight: 700;
          src: url('/fonts/robotocondensed-700-latin.woff2') format('woff2');
          unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
        @media print {
          .no-print { display: none !important; }
          @page { size: A4 portrait; margin: 0; }
          body { margin: 0; }
        }
        .cmr-page {
          position: relative;
          width: 210mm;
          height: 297mm;
          margin: 0 auto;
          overflow: hidden;
          page-break-after: always;
          background: #fff;
        }
        .cmr-page:last-child { page-break-after: auto; }
        .cmr-bg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
        }
      `}</style>

      {/* Toolbar — hidden on print */}
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', background: '#f8f9fa', borderBottom: '1px solid #dee2e6' }}>
        <Link to="/office/zamowienia" style={{ fontSize: '13px', color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}>
          <ArrowLeft size={14} /> Zamówienia
        </Link>
        <button
          onClick={() => window.print()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 12px', fontSize: '13px', cursor: 'pointer' }}
        >
          <Printer size={14} /> Drukuj
        </button>
        <button
          type="button"
          onClick={() => void downloadDocPdf(cmrApi.pdfUrl(id)).catch(e => alert(e?.message || 'Nie udało się pobrać PDF'))}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#fff', color: '#be123c', border: '1px solid #fecdd3', borderRadius: '4px', padding: '5px 12px', fontSize: '13px', cursor: 'pointer' }}
        >
          <Download size={14} /> Pobierz PDF
        </button>
      </div>

      {COPY_BG.map((bg, i) => (
        <CmrSheet key={i} doc={doc} bg={bg} pos={pos} rowH={getGoodsRowH(pos)} />
      ))}
    </div>
  )
}
