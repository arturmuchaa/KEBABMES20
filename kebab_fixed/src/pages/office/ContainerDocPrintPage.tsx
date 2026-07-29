/**
 * ContainerDocPrintPage — druk „WZ na POJEMNIKI" 1:1 z zakładowym drukiem.
 *
 * A4 POZIOMO, dwie identyczne kopie jedna pod drugą (po 105 mm) — kierowca
 * zabiera jedną, druga zostaje w zakładzie. Kolumna „Saldo" to saldo
 * NARASTAJĄCO po tym dokumencie (balance_after zamrożone przy wystawieniu),
 * więc ponowny wydruk po kolejnych ruchach daje ten sam papier.
 *
 * Dane sprzedawcy idą z dokumentu (snapshot get_company() z chwili
 * wystawienia) — MES działa u wielu klientów, więc nic tu nie jest wpisane
 * na sztywno.
 *
 * Samodzielna strona (wzór SanitaryCheckPrintPage):
 * /office/pojemniki/:id/druk — auto-print po załadowaniu (?pdf=1 wyłącza).
 */
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { containersApi, type ContainerDoc } from '@/lib/api'

function fmtD(iso: string): string {
  if (!iso) return ''
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

// A4 poziomo = 210 mm wysokości na dwie kopie po 104 mm (2 mm zapasu).
// Tabela NIE MOŻE przerosnąć pola treści (104 − 2×2 mm paddingu = 100 mm):
// tabela nie kurczy się poniżej naturalnej wysokości swojej treści, więc
// nadmiar wylewa się poza kopię i spycha drugą na kolejną stronę — tak było
// przy paddingu 5 mm (tabela 104,3 mm w polu 94 mm → PDF na 2 strony).
// Naturalna wysokość tej tabeli to ~98,7 mm. Zmieniając czcionki, paddingi
// komórek albo wiersze, ZWERYFIKUJ wydruk: PDF musi mieć JEDNĄ stronę.
const S = {
  copy: {
    height: '104mm', boxSizing: 'border-box' as const, padding: '2mm 5mm',
    background: '#fff', color: '#111',
    fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 10,
    breakInside: 'avoid' as const,
  },
  table: {
    width: '100%', height: '100%', borderCollapse: 'collapse' as const,
    tableLayout: 'fixed' as const,
  },
  cell: { border: '1px solid #111', padding: '1.5mm 2.5mm', verticalAlign: 'top' as const },
  lbl: { fontSize: 9, fontWeight: 700, textDecoration: 'underline' as const },
  val: { fontSize: 12, fontWeight: 700, marginTop: 2 },
  head: {
    border: '1px solid #111', padding: '1.5mm', textAlign: 'center' as const,
    fontWeight: 700, fontSize: 10, background: '#e8e8e8',
  },
  rowLbl: {
    border: '1px solid #111', padding: '1.5mm 2.5mm', fontWeight: 700,
    fontSize: 10, background: '#f2f2f2',
  },
  num: {
    border: '1px solid #111', padding: '1.5mm', textAlign: 'center' as const,
    fontSize: 14, fontWeight: 700,
  },
}

function Copy({ doc, mark }: { doc: ContainerDoc; mark: string }) {
  const s = doc.seller || ({} as ContainerDoc['seller'])
  const sellerAddr = [s.address, [s.postal_code, s.city].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ')
  return (
    <div style={S.copy}>
      <table style={S.table}>
        <colgroup>
          <col style={{ width: '26%' }} /><col style={{ width: '25%' }} />
          <col style={{ width: '25%' }} /><col style={{ width: '24%' }} />
        </colgroup>
        <tbody>
          <tr>
            <td style={{ ...S.cell, textAlign: 'center' }} rowSpan={2}>
              <div style={S.lbl}>Dostawca:</div>
              <img src="/logo-ksiezyc-print.png" alt="" style={{ height: '7mm', margin: '1mm auto' }} />
              <div style={{ fontSize: 11, fontWeight: 700 }}>{s.name || ''}</div>
              <div style={{ fontSize: 9 }}>{sellerAddr}</div>
              <div style={{ fontSize: 9 }}>{s.nip ? `NIP ${s.nip}` : ''}</div>
              <div style={{ fontSize: 9 }}>{s.phone ? `tel.: ${s.phone}` : ''}</div>
            </td>
            <td style={S.cell} colSpan={2}>
              <span style={{ fontSize: 11, fontWeight: 700 }}>WZ na POJEMNIKI NR: </span>
              <span style={{ fontSize: 13, fontWeight: 800 }}>{doc.number}</span>
              <span style={{ float: 'right', fontSize: 8, letterSpacing: 1 }}>{mark}</span>
              {doc.status === 'anulowany' && (
                <div style={{ fontSize: 11, fontWeight: 800, color: '#b00' }}>ANULOWANY</div>
              )}
            </td>
            <td style={S.cell} rowSpan={2}>
              <div style={S.lbl}>Odbiorca:</div>
              <div style={{ ...S.val, fontSize: 11 }}>{doc.partner?.name || ''}</div>
              <div style={{ fontSize: 9 }}>{doc.partner?.address || ''}</div>
              <div style={{ fontSize: 9 }}>{doc.partner?.nip ? `NIP ${doc.partner.nip}` : ''}</div>
            </td>
          </tr>
          <tr>
            <td style={S.cell}>
              <div style={S.lbl}>Data dostawy / odbioru:</div>
              <div style={S.val}>{fmtD(doc.docDate)}</div>
            </td>
            <td style={S.cell}>
              <div style={S.lbl}>Kierowca:</div>
              <div style={S.val}>{doc.driver || ''}</div>
            </td>
          </tr>
          <tr>
            <td style={S.cell}>
              <div style={S.lbl}>Środek transportu:</div>
              <div style={S.val}>{doc.vehicle || ''}</div>
            </td>
            <td style={S.head}>Dostawa / odbiór [szt.]</td>
            <td style={S.head}>Zwrot [szt.]</td>
            <td style={S.head}>Saldo</td>
          </tr>
          {doc.lines.map(l => (
            <tr key={l.assetType}>
              <td style={S.rowLbl}>
                {l.label}
                {l.assetType === 'pallet_other' && (
                  <div style={{ fontWeight: 400, fontSize: 8 }}>PCV/plastik/europaleta/drewno</div>
                )}
              </td>
              <td style={S.num}>{l.inQty || ''}</td>
              <td style={S.num}>{l.outQty || ''}</td>
              <td style={S.num}>{l.balance}</td>
            </tr>
          ))}
          <tr style={{ height: '12mm' }}>
            <td style={S.cell}><div style={S.lbl}>Podpis dostawcy:</div></td>
            <td style={S.cell} colSpan={2}>
              <div style={S.lbl}>Uwagi:</div>
              <div style={{ fontSize: 9, marginTop: 2 }}>{doc.notes || ''}</div>
            </td>
            <td style={S.cell}><div style={S.lbl}>Podpis odbiorcy:</div></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function ContainerDocPrintPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const [doc, setDoc] = useState<ContainerDoc | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    containersApi.doc(id).then(setDoc).catch(e => setErr(String(e?.message || e)))
  }, [id])

  useEffect(() => {
    // ?pdf=1 → renderer headless robi zrzut sam, bez dialogu drukowania.
    if (doc && params.get('pdf') !== '1') setTimeout(() => window.print(), 300)
  }, [doc, params])

  if (err) return <div style={{ padding: 24, fontFamily: 'Arial' }}>Błąd: {err}</div>
  if (!doc) return <div style={{ padding: 24, fontFamily: 'Arial' }}>Ładowanie…</div>

  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 0; }
        html, body { margin: 0; padding: 0; background: #fff; }
        @media screen { body { background: #eee; } }
      `}</style>
      <Copy doc={doc} mark="ORYGINAŁ" />
      <Copy doc={doc} mark="KOPIA" />
    </>
  )
}
