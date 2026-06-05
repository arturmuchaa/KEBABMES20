import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Printer, Download } from 'lucide-react'
import { cmrApi } from '@/lib/api'

const COPIES = [
  { label: 'Kopia dla nadawcy / Copy for sender / Kopie für Absender', color: '#c0152f' },
  { label: 'Kopia dla odbiorcy / Copy for consignee / Kopie für Empfänger', color: '#1d4ed8' },
  { label: 'Kopia dla przewoźnika / Copy for carrier / Kopie für Frachtführer', color: '#15803d' },
  { label: '4. egzemplarz / 4th copy / 4. Ausfertigung', color: '#111111' },
]

function fmt(date?: string) {
  if (!date) return ''
  // YYYY-MM-DD → DD.MM.YYYY
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : date
}

function AddrBlock({ data }: { data: any }) {
  if (!data) return null
  return (
    <>
      {data.name && <div style={{ fontWeight: 700 }}>{data.name}</div>}
      {data.address && <div>{data.address}</div>}
      {(data.postal_code || data.city) && <div>{[data.postal_code, data.city].filter(Boolean).join(' ')}</div>}
      {data.country && <div>{data.country}</div>}
      {data.nip && <div>NIP: {data.nip}</div>}
      {data.vat_eu && <div>VAT: {data.vat_eu}</div>}
      {data.plate && <div>Nr rej.: {data.plate}</div>}
    </>
  )
}

interface BoxProps {
  num: number | string
  label: React.ReactNode
  children?: React.ReactNode
  style?: React.CSSProperties
}

function Box({ num, label, children, style }: BoxProps) {
  return (
    <div className="cmr-box" style={style}>
      <div className="cmr-box-num">{num}</div>
      <div className="cmr-box-label">{label}</div>
      <div className="cmr-box-val">{children}</div>
    </div>
  )
}

function SigBox({ num, label }: { num: number; label: string }) {
  return (
    <div className="cmr-sigbox">
      <div className="cmr-sigbox-num">{num}</div>
      <div className="cmr-sigbox-inner"></div>
      <div className="cmr-sigbox-label">{label}</div>
    </div>
  )
}

function CmrSheet({ doc, color, label }: { doc: any; color: string; label: string }) {
  const p = doc.payload || {}
  const goods: any[] = p.goods || []
  const att = p.attachments || {}

  return (
    <div className="cmr-sheet" style={{ ['--cmr' as any]: color }}>
      {/* Header */}
      <div className="cmr-header">
        <div className="cmr-copy-label" style={{ color }}>{label}</div>
        <div className="cmr-title">
          MIĘDZYNARODOWY SAMOCHODOWY LIST PRZEWOZOWY<br />
          INTERNATIONAL CONSIGNMENT NOTE (CMR)<br />
          <span style={{ fontSize: '7.5px', fontWeight: 400 }}>INTERNATIONALER FRACHTBRIEF</span>
        </div>
        <div className="cmr-number" style={{ color }}>CMR Nr / No: <strong>{doc.number}</strong></div>
      </div>

      {/* Main layout: left column (boxes 1–9/14) + right column (boxes 16–21) */}
      <div className="cmr-body">
        {/* Left column */}
        <div className="cmr-left">
          <Box num={1} label="Nadawca / Sender / Absender (name, address, country)">
            <AddrBlock data={p.sender} />
          </Box>
          <Box num={2} label="Odbiorca / Consignee / Empfänger (name, address, country)">
            <AddrBlock data={p.consignee} />
          </Box>
          <Box num={3} label="Miejsce przeznaczenia / Place of delivery / Auslieferungsort (place, country)">
            {p.delivery_place}
          </Box>
          <Box num={4} label="Miejsce i data załadowania / Place and date of taking over / Ort und Tag der Übernahme">
            {p.load_place && <div>{p.load_place}</div>}
            {p.load_date && <div>{fmt(p.load_date)}</div>}
          </Box>
          <Box num={5} label="Załączone dokumenty / Documents attached / Beigefügte Dokumente">
            {att.hdi_number && <div>HDI {att.hdi_number}</div>}
            {att.invoice_no && <div>{att.invoice_no}</div>}
          </Box>

          {/* Goods table: boxes 6-9, 11 */}
          <div className="cmr-goods-area">
            <div className="cmr-goods-header">
              <div className="cmr-goods-col-label">
                <span className="cmr-box-num-inline">6-9</span>
                <span className="cmr-goods-th">Znaki i nr / Marks / Zeichen</span>
                <span className="cmr-goods-th">Ilość / Number / Anzahl</span>
                <span className="cmr-goods-th">Rodzaj opakowania / Method of packing / Verpackungsart</span>
                <span className="cmr-goods-th">Rodzaj towaru / Nature of goods / Bezeichnung</span>
              </div>
              <div className="cmr-goods-col-qty">
                <span className="cmr-box-num-inline">10</span>
                <span className="cmr-goods-th">Nr stat. / Stat. no. / Stat. Nr.</span>
              </div>
              <div className="cmr-goods-col-weight">
                <span className="cmr-box-num-inline">11</span>
                <span className="cmr-goods-th">Waga brutto kg / Gross weight kg / Bruttogewicht kg</span>
              </div>
              <div className="cmr-goods-col-cbm">
                <span className="cmr-box-num-inline">12</span>
                <span className="cmr-goods-th">Objętość m³ / Volume m³ / Raummenge m³</span>
              </div>
            </div>
            <div className="cmr-goods-rows">
              {goods.map((g: any, i: number) => (
                <div key={i} className="cmr-goods-row">
                  <div className="cmr-goods-col-label">
                    <span></span>
                    <span>{g.qty}</span>
                    <span></span>
                    <span style={{ fontWeight: 600 }}>{g.name}{g.auto ? ' *' : ''}</span>
                  </div>
                  <div className="cmr-goods-col-qty"></div>
                  <div className="cmr-goods-col-weight">{g.kg ? `${g.kg} kg` : ''}</div>
                  <div className="cmr-goods-col-cbm"></div>
                </div>
              ))}
              {/* Total row */}
              <div className="cmr-goods-row cmr-goods-total">
                <div className="cmr-goods-col-label" style={{ fontWeight: 700 }}>Razem / Total</div>
                <div className="cmr-goods-col-qty"></div>
                <div className="cmr-goods-col-weight" style={{ fontWeight: 700 }}>{p.gross_kg ? `${p.gross_kg} kg` : ''}</div>
                <div className="cmr-goods-col-cbm"></div>
              </div>
            </div>
          </div>

          <Box num={13} label="Instrukcje nadawcy / Sender's instructions / Anweisungen des Absenders">
            {p.instructions}
          </Box>
          <Box num={14} label="Postanowienia dotyczące przewoźnego / Instructions as to payment / Frachtzahlungsanweisungen">
            {p.franco}
          </Box>

          {/* Box 15 placeholder */}
          <Box num={15} label="Formalności celne / Customs formalities / Zollamtliche Vorschriften" />
        </div>

        {/* Right column */}
        <div className="cmr-right">
          <Box num={16} label="Przewoźnik / Carrier / Frachtführer (name, address, country)">
            <AddrBlock data={p.carrier} />
          </Box>
          <Box num={17} label="Następni przewoźnicy / Successive carriers / Nachfolgende Frachtführer (name, address, country)" />
          <Box num={18} label="Zastrzeżenia i uwagi przewoźnika / Carrier's reservations / Vorbehalte und Bemerkungen des Frachtführers" />
          <Box num={19} label="Do zapłaty przez / To be paid by / Zu zahlen von" />
          <Box num={20} label="Poświadczenie / Special agreements / Besondere Vereinbarungen" />
          <Box num={21} label="Wystawiono w / Established in / Ausgefertigt in / Data / Date / Datum">
            {p.established_place && <div>{p.established_place}</div>}
            {p.established_date && <div>{fmt(p.established_date)}</div>}
          </Box>

          {/* Freight charges table — box 20 area */}
          <div className="cmr-freight-area">
            <div className="cmr-freight-title" style={{ color }}>
              <span className="cmr-box-num-inline">20</span>
              Należności / Charges to pay / Franko
            </div>
            <table className="cmr-freight-table">
              <thead>
                <tr>
                  <th>Waluta / Currency</th>
                  <th>Kwota / Amount</th>
                  <th>Kwota / Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Przewoźne / Carriage / Fracht</td><td></td><td></td></tr>
                <tr><td>Zniżki / Reductions / Abzüge</td><td></td><td></td></tr>
                <tr><td>Pozostałe / Balance / Saldo</td><td></td><td></td></tr>
                <tr><td>Dopłaty / Supplements / Zuschläge</td><td></td><td></td></tr>
                <tr><td>Inne / Others / Sonstiges</td><td></td><td></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Signature row: 22 / 23 / 24 */}
      <div className="cmr-sigrow">
        <SigBox
          num={22}
          label="Podpis i stempel nadawcy / Signature and stamp of the sender / Unterschrift und Stempel des Absenders"
        />
        <SigBox
          num={23}
          label="Podpis i stempel przewoźnika / Signature and stamp of the carrier / Unterschrift und Stempel des Frachtführers"
        />
        <SigBox
          num={24}
          label="Przesyłkę otrzymano / Goods received / Gut erhalten — Podpis i stempel odbiorcy / Signature and stamp of the consignee"
        />
      </div>
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
      const t = setTimeout(() => window.print(), 600)
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
          @page { size: A4 portrait; margin: 8mm; }
          body { margin: 0; }
        }

        /* ── Sheet ── */
        .cmr-sheet {
          width: 194mm;
          margin: 0 auto;
          padding: 4px 6px;
          font-family: Arial, Helvetica, sans-serif;
          font-size: 8px;
          line-height: 1.3;
          color: #000;
          page-break-after: always;
          box-sizing: border-box;
        }
        .cmr-sheet:last-child {
          page-break-after: auto;
        }

        /* ── Header ── */
        .cmr-header {
          display: flex;
          align-items: flex-start;
          gap: 6px;
          margin-bottom: 4px;
          border-bottom: 1.5px solid var(--cmr);
          padding-bottom: 4px;
        }
        .cmr-copy-label {
          font-size: 7.5px;
          font-weight: 700;
          width: 30mm;
          flex-shrink: 0;
          line-height: 1.3;
        }
        .cmr-title {
          flex: 1;
          text-align: center;
          font-weight: 700;
          font-size: 8.5px;
          line-height: 1.4;
        }
        .cmr-number {
          font-size: 9px;
          font-weight: 700;
          width: 36mm;
          flex-shrink: 0;
          text-align: right;
          white-space: nowrap;
        }

        /* ── Body: two columns ── */
        .cmr-body {
          display: flex;
          gap: 0;
          border: 1px solid var(--cmr);
          margin-bottom: 2px;
        }
        .cmr-left {
          flex: 1 1 60%;
          border-right: 1px solid var(--cmr);
          display: flex;
          flex-direction: column;
        }
        .cmr-right {
          flex: 1 1 40%;
          display: flex;
          flex-direction: column;
        }

        /* ── Box ── */
        .cmr-box {
          border-bottom: 1px solid var(--cmr);
          padding: 2px 4px;
          min-height: 22px;
          position: relative;
        }
        .cmr-box:last-child { border-bottom: none; }
        .cmr-right .cmr-box:last-child { border-bottom: none; }
        .cmr-box-num {
          font-size: 7px;
          font-weight: 700;
          color: var(--cmr);
          float: left;
          margin-right: 3px;
          line-height: 1;
        }
        .cmr-box-label {
          font-size: 6.5px;
          color: var(--cmr);
          line-height: 1.2;
          margin-bottom: 1px;
          font-style: italic;
        }
        .cmr-box-val {
          font-size: 8px;
          line-height: 1.35;
          padding-left: 1px;
        }

        /* ── Goods area ── */
        .cmr-goods-area {
          border-bottom: 1px solid var(--cmr);
        }
        .cmr-goods-header,
        .cmr-goods-row {
          display: flex;
          border-bottom: 1px solid var(--cmr);
        }
        .cmr-goods-row:last-child { border-bottom: none; }
        .cmr-goods-header { background: #f8f8f8; }
        .cmr-goods-col-label { flex: 1 1 52%; padding: 2px 4px; border-right: 1px solid var(--cmr); }
        .cmr-goods-col-qty   { flex: 0 0 10%; padding: 2px 4px; border-right: 1px solid var(--cmr); text-align: center; }
        .cmr-goods-col-weight{ flex: 0 0 22%; padding: 2px 4px; border-right: 1px solid var(--cmr); text-align: right; }
        .cmr-goods-col-cbm   { flex: 0 0 16%; padding: 2px 4px; text-align: right; }
        .cmr-goods-header .cmr-goods-col-label {
          display: flex;
          gap: 0;
        }
        .cmr-goods-header .cmr-goods-col-label > span { flex: 1; }
        .cmr-goods-row .cmr-goods-col-label {
          display: flex;
          gap: 0;
        }
        .cmr-goods-row .cmr-goods-col-label > span { flex: 1; }
        .cmr-goods-th {
          font-size: 6px;
          color: var(--cmr);
          font-style: italic;
          line-height: 1.2;
        }
        .cmr-box-num-inline {
          font-size: 7px;
          font-weight: 700;
          color: var(--cmr);
          margin-right: 2px;
        }
        .cmr-goods-total {
          background: #f0f0f0;
          font-size: 7.5px;
        }
        .cmr-goods-total .cmr-goods-col-label { font-weight: 700; }

        /* ── Freight table ── */
        .cmr-freight-area {
          padding: 2px 4px;
          border-bottom: 1px solid var(--cmr);
          flex: 0 0 auto;
        }
        .cmr-freight-title {
          font-size: 6.5px;
          font-style: italic;
          margin-bottom: 2px;
        }
        .cmr-freight-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 6.5px;
        }
        .cmr-freight-table th,
        .cmr-freight-table td {
          border: 1px solid var(--cmr);
          padding: 1px 3px;
        }
        .cmr-freight-table th {
          background: #f4f4f4;
          color: var(--cmr);
          text-align: center;
        }

        /* ── Signature row ── */
        .cmr-sigrow {
          display: flex;
          border: 1px solid var(--cmr);
          border-top: none;
          height: 28mm;
        }
        .cmr-sigbox {
          flex: 1;
          border-right: 1px solid var(--cmr);
          display: flex;
          flex-direction: column;
          padding: 2px 4px;
          position: relative;
        }
        .cmr-sigbox:last-child { border-right: none; }
        .cmr-sigbox-num {
          font-size: 7px;
          font-weight: 700;
          color: var(--cmr);
          line-height: 1;
        }
        .cmr-sigbox-inner { flex: 1; }
        .cmr-sigbox-label {
          font-size: 6px;
          color: var(--cmr);
          line-height: 1.2;
          text-align: center;
          padding-top: 2px;
          border-top: 1px dashed var(--cmr);
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

      {COPIES.map((copy, i) => (
        <CmrSheet key={i} doc={doc} color={copy.color} label={copy.label} />
      ))}
    </div>
  )
}
