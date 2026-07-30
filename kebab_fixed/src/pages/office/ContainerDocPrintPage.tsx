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

// A4 PIONOWO, dwie kopie: oryginał u góry, kopia pod spodem.
//
// @page ma margines 5 mm, NIE zero: drukarki mają fizyczną strefę
// niezadrukowywalną przy krawędzi (~4-5 mm) i przy margin:0 ucinały logo
// oraz brzeg ramki. Pole zadruku to więc 200 × 287 mm, czyli 143,5 mm
// na kopię. Bierzemy 142 mm — 3 mm luzu, żeby zaokrąglenia sterownika
// drukarki nie wypchnęły dolnej ramki poza stronę.
// Padding kopii jest mały, bo margines strony już daje zapas.
//
// Tabela NIE MOŻE przerosnąć pola treści: nie kurczy się poniżej naturalnej
// wysokości treści, więc nadmiar wylewa się poza kopię i spycha drugą na
// kolejną stronę (tak było przy poziomie z paddingiem 5 mm — tabela 104,3 mm
// w polu 94 mm → PDF na 2 strony). W pionie zapasu jest dużo (~138 mm pola
// na ~99 mm treści), a height rozciąga wiersze na całą wysokość.
// Zmieniając czcionki, paddingi lub wiersze ZWERYFIKUJ wydruk renderem do
// PDF — musi wyjść JEDNA strona.
// Udziały wysokości wierszy zmierzone na ORYGINALNYM druku zakładowym
// (skan saldo pojmenikow.pdf, linie ramki: 40/107/182/246/296/344/402/551 px).
// Blok podpisów jest tam NAJWIĘKSZY (29%) — trzeba na nim pisać ręcznie —
// a nagłówek z kierowcą i datą zajmuje mniej, niż sugerowałby jego zawartość.
const ROW_H = {
  head1: '13%',   // Dostawca | WZ na POJEMNIKI NR | Odbiorca
  head2: '15%',   // Data dostawy / odbioru | Kierowca
  cols:  '12.5%', // Środek transportu | nagłówki kolumn
  e2:    '10%',
  h1:    '9.5%',
  other: '11%',
  sign:  '29%',   // Podpis dostawcy | Uwagi | Podpis odbiorcy
} as const

const S = {
  copy: {
    height: '142mm', boxSizing: 'border-box' as const, padding: '1.5mm 2mm',
    background: '#fff', color: '#111',
    fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 10,
    breakInside: 'avoid' as const,
  },
  table: {
    width: '100%', height: 'calc(100% - 7.5mm)', borderCollapse: 'collapse' as const,
    tableLayout: 'fixed' as const,
  },
  brand: {
    display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
    height: '7.5mm', paddingBottom: '1mm',
  } as const,
  cell: { border: '1px solid #111', padding: '1.2mm 2.5mm', verticalAlign: 'top' as const },
  lbl: { fontSize: 9, fontWeight: 700, textDecoration: 'underline' as const },
  val: { fontSize: 12, fontWeight: 700, marginTop: 2 },
  head: {
    border: '1px solid #111', padding: '1.2mm', textAlign: 'center' as const,
    fontWeight: 700, fontSize: 10, background: '#e8e8e8',
  },
  rowLbl: {
    border: '1px solid #111', padding: '1.2mm 2.5mm', fontWeight: 700,
    fontSize: 10, background: '#f2f2f2',
  },
  num: {
    border: '1px solid #111', padding: '1.2mm', textAlign: 'center' as const,
    fontSize: 14, fontWeight: 700,
  },
}

/** „Kto komu zalega" liczone z salda ZAMROŻONEGO na dokumencie.
 *  Dodatnie = nośniki kontrahenta stoją u wystawcy (to my zalegamy),
 *  ujemne = nasze stoją u kontrahenta. Zero = nic nie piszemy. */
function debtLine(doc: ContainerDoc): string {
  const bal = doc.balanceAfter || ({} as ContainerDoc['balanceAfter'])
  const label: Record<string, string> = {
    e2: 'poj. E2', pallet_h1: 'pal. H1', pallet_other: 'pal. innych',
  }
  const fmt = (sign: number) => (['e2', 'pallet_h1', 'pallet_other'] as const)
    .filter(a => Math.sign(bal[a] ?? 0) === sign)
    .map(a => `${Math.abs(bal[a] ?? 0)} ${label[a]}`)
    .join(', ')
  const owedByUs = fmt(1)
  const owedToUs = fmt(-1)
  const who = (n: string, what: string) => `Zalega ${n}: ${what}`
  const parts: string[] = []
  if (owedByUs) parts.push(who(doc.seller?.name || 'wystawca', owedByUs))
  if (owedToUs) parts.push(who(doc.partner?.name || 'odbiorca', owedToUs))
  return parts.join(' · ')
}

function Copy({ doc, mark }: { doc: ContainerDoc; mark: string }) {
  const pending = doc.status === 'oczekuje'
  const debt = debtLine(doc)
  const s = doc.seller || ({} as ContainerDoc['seller'])
  const sellerAddr = [s.address, [s.postal_code, s.city].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ')
  return (
    <div style={S.copy}>
      {/* Logo POZA ramką dokumentu — papier firmowy, nie element formularza. */}
      <div style={S.brand}>
        <img src="/logo-ksiezyc-znak.png" alt="" style={{ height: '6.5mm' }} />
        <span style={{ fontSize: 8, letterSpacing: 1, color: '#666' }}>{mark}</span>
      </div>
      <table style={S.table}>
        <colgroup>
          <col style={{ width: '28%' }} /><col style={{ width: '24%' }} />
          <col style={{ width: '24%' }} /><col style={{ width: '24%' }} />
        </colgroup>
        <tbody>
          <tr style={{ height: ROW_H.head1 }}>
            <td style={{ ...S.cell, textAlign: 'center' }} rowSpan={2}>
              <div style={S.lbl}>Dostawca:</div>
              <div style={{ fontSize: 11, fontWeight: 700, marginTop: 1 }}>{s.name || ''}</div>
              <div style={{ fontSize: 9 }}>{sellerAddr}</div>
              <div style={{ fontSize: 9 }}>{s.nip ? `NIP ${s.nip}` : ''}</div>
              <div style={{ fontSize: 9 }}>{s.phone ? `tel.: ${s.phone}` : ''}</div>
            </td>
            <td style={S.cell} colSpan={2}>
              <span style={{ fontSize: 11, fontWeight: 700 }}>WZ na POJEMNIKI NR: </span>
              <span style={{ fontSize: 13, fontWeight: 800 }}>{doc.number}</span>
              {doc.status === 'anulowany' && (
                <div style={{ fontSize: 11, fontWeight: 800, color: '#b00' }}>ANULOWANY</div>
              )}
              {pending && (
                <div style={{ fontSize: 8.5 }}>
                  Prosimy wpisać liczbę zwróconych nośników w kolumnie „Zwrot".
                </div>
              )}
            </td>
            <td style={S.cell} rowSpan={2}>
              <div style={S.lbl}>Odbiorca:</div>
              <div style={{ ...S.val, fontSize: 11 }}>{doc.partner?.name || ''}</div>
              <div style={{ fontSize: 9 }}>{doc.partner?.address || ''}</div>
              <div style={{ fontSize: 9 }}>{doc.partner?.nip ? `NIP ${doc.partner.nip}` : ''}</div>
            </td>
          </tr>
          <tr style={{ height: ROW_H.head2 }}>
            <td style={S.cell}>
              <div style={S.lbl}>Data dostawy / odbioru:</div>
              <div style={S.val}>{fmtD(doc.docDate)}</div>
            </td>
            <td style={S.cell}>
              <div style={S.lbl}>Kierowca:</div>
              <div style={S.val}>{doc.driver || ''}</div>
            </td>
          </tr>
          <tr style={{ height: ROW_H.cols }}>
            <td style={S.cell}>
              <div style={S.lbl}>Środek transportu:</div>
              <div style={S.val}>{doc.vehicle || ''}</div>
            </td>
            <td style={S.head}>Dostawa / odbiór [szt.]</td>
            <td style={S.head}>Zwrot [szt.]</td>
            <td style={S.head}>Saldo</td>
          </tr>
          {doc.lines.map(l => (
            <tr key={l.assetType} style={{
              height: l.assetType === 'e2' ? ROW_H.e2
                    : l.assetType === 'pallet_h1' ? ROW_H.h1 : ROW_H.other }}>
              <td style={S.rowLbl}>
                {l.label}
                {l.assetType === 'pallet_other' && (
                  <div style={{ fontWeight: 400, fontSize: 8 }}>PCV/plastik/europaleta/drewno</div>
                )}
              </td>
              <td style={S.num}>{l.inQty || ''}</td>
              {/* Dokument czekający na zwrot jedzie do kontrahenta z PUSTYMI
                  polami — wpisuje je długopisem przy odbiorze. Saldo też
                  zostaje puste, bo jeszcze go nie znamy. */}
              <td style={S.num}>{pending ? '' : (l.outQty || '')}</td>
              <td style={S.num}>{pending ? '' : l.balance}</td>
            </tr>
          ))}
          <tr style={{ height: ROW_H.sign }}>
            <td style={S.cell}><div style={S.lbl}>Podpis dostawcy:</div></td>
            <td style={S.cell} colSpan={2}>
              <div style={S.lbl}>Uwagi:</div>
              {doc.notes && <div style={{ fontSize: 9, marginTop: 2 }}>{doc.notes}</div>}
              {debt && (
                <div style={{ fontSize: 9.5, marginTop: 2, fontWeight: 700 }}>{debt}</div>
              )}
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
        @page { size: A4 portrait; margin: 5mm; }
        html, body { margin: 0; padding: 0; background: #fff; position: relative; }
        @media screen { body { background: #eee; } }
      `}</style>
      <Copy doc={doc} mark="ORYGINAŁ" />
      {/* Linia cięcia dokładnie w połowie kartki — kierowca zabiera jedną
          połówkę, druga zostaje u kontrahenta. */}
      <div style={{ position: 'absolute', top: '142.5mm', left: 0, right: 0,
                    borderTop: '1px dashed #999', height: 0 }} />
      <Copy doc={doc} mark="KOPIA" />
    </>
  )
}
