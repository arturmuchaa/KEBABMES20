import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Printer, Download } from 'lucide-react'
import { cmrApi } from '@/lib/api'

// Cztery kopie = cztery strony oficjalnego druku (tło 1:1), różnią się kolorem.
const COPY_BG = ['/cmr/cmr-1.png', '/cmr/cmr-2.png', '/cmr/cmr-3.png', '/cmr/cmr-4.png']

function fmt(date?: string) {
  if (!date) return ''
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : date
}

// Pole nakładane na druk: pozycja w % strony A4 (left/top), szerokość, rozmiar.
// Czcionka danych jak na oryginalnym druku CMR: Roboto Condensed.
function F({ l, t, w, s = 10.5, bold, center, right, children }: {
  l: number; t: number; w?: number; s?: number
  bold?: boolean; center?: boolean; right?: boolean; children?: React.ReactNode
}) {
  return (
    <div style={{
      position: 'absolute', left: `${l}%`, top: `${t}%`,
      width: w ? `${w}%` : undefined,
      fontSize: `${s}px`, fontWeight: bold ? 700 : 400, lineHeight: 1.1,
      textAlign: center ? 'center' : right ? 'right' : 'left',
      color: '#000', fontFamily: "'Roboto Condensed', Arial, sans-serif",
      textTransform: 'uppercase',
    }}>{children}</div>
  )
}

// Blok adresowy: 3 linie (nazwa / ulica / „kod, miasto, kraj") rozmieszczone
// dokładnie jak na wzorze — odstęp linii 1,3% wysokości A4.
function AddrBlock({ d, l, t, s = 11.5 }: { d: any; l: number; t: number; s?: number }) {
  if (!d) return null
  const cityLine = [d.postal_code, d.city, d.country].filter(Boolean).join(', ')
  const lines = [d.name, d.address, cityLine].filter(Boolean)
  return <>{lines.map((ln, i) => <F key={i} l={l} t={t + i * 1.3} w={26} s={s}>{ln}</F>)}</>
}

function CmrSheet({ doc, bg }: { doc: any; bg: string }) {
  const p = doc.payload || {}
  const att = p.attachments || {}
  const goods: any[] = p.goods || []
  const c = p.carrier || {}

  // Współrzędne wyciągnięte 1:1 z wypełnionego cmr wzor.pdf (pozycje wartości).
  const ROW0 = 48.3      // top % pierwszego wiersza towaru (jak na wzorze)
  const ROWH = 2.7       // odstęp wierszy

  return (
    <div className="cmr-page">
      <img className="cmr-bg" src={bg} alt="" />

      {/* Numer CMR (po „CMR No:") */}
      <F l={79.3} t={8.7} s={15} bold>{doc.number}</F>

      {/* 1 Nadawca */}
      <AddrBlock d={p.sender} l={8.4} t={8.7} />
      <F l={35.4} t={12.7} w={16} s={11}>{p.sender?.nip}</F>

      {/* 2 Odbiorca */}
      <AddrBlock d={p.consignee} l={8.4} t={18.6} />
      <F l={36.4} t={22.6} w={15} s={11}>{p.consignee?.nip}</F>

      {/* 3 Miejsce przeznaczenia (pełny adres odbiorcy, jak na wzorze) */}
      <AddrBlock d={p.consignee} l={8.4} t={28.5} />

      {/* 4 Miejsce i data załadowania */}
      <F l={8.4} t={38.4} w={26} s={11}>{p.load_place}</F>
      <F l={42.1} t={38.4} w={14} s={11}>{fmt(p.load_date)}</F>

      {/* 5 Załączone dokumenty (HDI + nr FV) */}
      {att.hdi_number && <F l={8.4} t={42.0} w={42} s={11}>HDI {att.hdi_number}</F>}
      {att.invoice_no && <F l={8.4} t={43.2} w={42} s={11}>{att.invoice_no}</F>}

      {/* 6–11 Towar (wiersze) */}
      {goods.map((g, i) => (
        <div key={i}>
          <F l={6.8} t={ROW0 + i * ROWH} w={4} s={11}>{i + 1}.</F>
          <F l={22} t={ROW0 + i * ROWH} w={9} s={11}>{g.qty || ''}</F>
          <F l={47.7} t={ROW0 + i * ROWH} w={18} s={11}>{g.name}</F>
          <F l={77.6} t={ROW0 + i * ROWH} w={9} s={11}>{g.kg ? `${g.kg}` : ''}</F>
        </div>
      ))}
      {/* Waga brutto razem (gdy więcej niż jedna pozycja) */}
      {goods.length > 1 && (
        <F l={77.6} t={57.0} w={9} s={11} bold>{p.gross_kg ? `${p.gross_kg}` : ''}</F>
      )}

      {/* 13 Instrukcje nadawcy */}
      <F l={9.3} t={65.8} w={42} s={11}>{p.instructions}</F>

      {/* 14 Postanowienia dot. przewoźnego (Franco) */}
      <F l={31} t={77.4} w={18} s={11}>{p.franco}</F>

      {/* 16 Przewoźnik */}
      <AddrBlock d={c} l={53.7} t={18.6} />
      <F l={78} t={23.4} w={13} s={11}>{c.nip}</F>
      <F l={78} t={24.5} w={13} s={11}>{c.vat_eu}</F>
      <F l={53.7} t={26.0} w={22} s={11}>{c.plate ? `Nr rej.: ${c.plate}` : ''}</F>

      {/* 21 Wystawiono w / data */}
      <F l={15.6} t={83.1} w={14} s={11}>{p.established_place}</F>
      <F l={32.7} t={83.1} w={14} s={11}>{fmt(p.established_date)}</F>
    </div>
  )
}

export function CmrPrintPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [doc, setDoc] = useState<any>(null)
  const [err, setErr] = useState('')
  const isPdf = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('pdf')

  useEffect(() => {
    cmrApi.get(id).then(setDoc).catch(e => setErr(e instanceof Error ? e.message : 'Błąd'))
  }, [id])

  useEffect(() => {
    if (doc && !isPdf) {
      const t = setTimeout(() => window.print(), 700)
      return () => clearTimeout(t)
    }
  }, [doc, isPdf])

  if (err) return <div className="p-8 text-red-700">{err}</div>
  if (!doc) return <div className="p-8 text-slate-500">Ładowanie CMR…</div>

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
        <a
          href={cmrApi.pdfUrl(id)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#fff', color: '#be123c', border: '1px solid #fecdd3', borderRadius: '4px', padding: '5px 12px', fontSize: '13px', cursor: 'pointer', textDecoration: 'none' }}
        >
          <Download size={14} /> Pobierz PDF
        </a>
      </div>

      {COPY_BG.map((bg, i) => (
        <CmrSheet key={i} doc={doc} bg={bg} />
      ))}
    </div>
  )
}
