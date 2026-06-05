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
function F({ l, t, w, s = 8, bold, center, right, children }: {
  l: number; t: number; w?: number; s?: number
  bold?: boolean; center?: boolean; right?: boolean; children?: React.ReactNode
}) {
  return (
    <div style={{
      position: 'absolute', left: `${l}%`, top: `${t}%`,
      width: w ? `${w}%` : undefined,
      fontSize: `${s}px`, fontWeight: bold ? 700 : 400, lineHeight: 1.15,
      textAlign: center ? 'center' : right ? 'right' : 'left',
      color: '#000', fontFamily: 'Arial, Helvetica, sans-serif',
    }}>{children}</div>
  )
}

function Addr({ d }: { d: any }) {
  if (!d) return null
  const cityLine = [d.postal_code, d.city].filter(Boolean).join(' ')
  return (
    <>
      {d.name && <div style={{ fontWeight: 700 }}>{d.name}</div>}
      {d.address && <div>{d.address}</div>}
      {cityLine && <div>{cityLine}</div>}
      {d.country && <div>{d.country}</div>}
    </>
  )
}

function CmrSheet({ doc, bg }: { doc: any; bg: string }) {
  const p = doc.payload || {}
  const att = p.attachments || {}
  const goods: any[] = p.goods || []
  const c = p.carrier || {}

  const ROW0 = 48.6      // top % pierwszego wiersza towaru
  const ROWH = 2.55      // wysokość wiersza w %

  return (
    <div className="cmr-page">
      <img className="cmr-bg" src={bg} alt="" />

      {/* Numer CMR (po „CMR No:") */}
      <F l={83} t={9.6} s={12} bold>{doc.number}</F>

      {/* 1 Nadawca */}
      <F l={6} t={9.3} w={20} s={7.5}><Addr d={p.sender} /></F>
      <F l={40.5} t={12.5} w={13} s={7.5}>{p.sender?.nip}</F>

      {/* 2 Odbiorca */}
      <F l={6} t={19.2} w={20} s={7.5}><Addr d={p.consignee} /></F>
      <F l={40.5} t={22.4} w={13} s={7.5}>{p.consignee?.nip}</F>

      {/* 3 Miejsce przeznaczenia */}
      <F l={6} t={28.6} w={42} s={7.5}>{p.delivery_place}</F>

      {/* 4 Miejsce i data załadowania */}
      <F l={6} t={36.4} w={30} s={7.5}>{p.load_place}</F>
      <F l={6} t={38.0} w={30} s={7.5}>{fmt(p.load_date)}</F>

      {/* 5 Załączone dokumenty */}
      <F l={6} t={42.2} w={42} s={7.5}>
        {att.hdi_number && <div>HDI {att.hdi_number}</div>}
        {att.invoice_no && <div>{att.invoice_no}</div>}
      </F>

      {/* 6–11 Towar (wiersze) */}
      {goods.map((g, i) => (
        <div key={i}>
          <F l={22} t={ROW0 + i * ROWH} w={9} s={7.5} center>{g.qty || ''}</F>
          <F l={45} t={ROW0 + i * ROWH} w={20} s={7.5}>{g.name}</F>
          <F l={74} t={ROW0 + i * ROWH} w={11} s={7.5} right>{g.kg ? `${g.kg}` : ''}</F>
        </div>
      ))}
      {/* Waga brutto razem (dół kolumny 11) */}
      <F l={74} t={57.2} w={11} s={8} right bold>{p.gross_kg ? `${p.gross_kg}` : ''}</F>

      {/* 13 Instrukcje nadawcy */}
      <F l={6} t={66.9} w={43} s={7.5}>{p.instructions}</F>

      {/* 14 Postanowienia dot. przewoźnego (Franco) — w wolnym miejscu obok etykiety */}
      <F l={31} t={77.3} w={18} s={7.5}>{p.franco}</F>

      {/* 16 Przewoźnik */}
      <F l={54} t={18.6} w={18} s={7.5}><Addr d={c} /></F>
      <F l={85} t={22.6} w={10} s={7.5}>{c.nip}</F>
      <F l={85} t={23.6} w={10} s={7.5}>{c.vat_eu}</F>
      <F l={54} t={25.4} w={20} s={7.5}>{c.plate ? `Nr rej.: ${c.plate}` : ''}</F>

      {/* 21 Wystawiono w / data */}
      <F l={22} t={84.1} w={14} s={7.5}>{p.established_place}</F>
      <F l={37} t={84.1} w={14} s={7.5}>{fmt(p.established_date)}</F>
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
